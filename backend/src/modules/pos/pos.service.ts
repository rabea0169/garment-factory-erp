import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentType,
  Prisma,
  SalesOrderStatus,
  UserRole,
  WarehouseType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { round2 } from '../../core/common/money.util';
import {
  DocumentCodePrefix,
  generateDocumentCode,
} from '../../core/common/codes.util';
import { buildReceiptQrPayload } from '../../core/common/qr-tlv.util';
import { FactorySettingsService } from '../system/factory-settings.service';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import {
  CHART_OF_ACCOUNTS,
  EGYPT_VAT_RATE,
  computeVat,
} from '../../core/financial/chart-of-accounts';
import { PosPriceLevel, QuickSaleDto } from './dto/quick-sale.dto';

/** نطاق مفتاح الاندماجية للبيع السريع من نقطة البيع. */
const IDEMPOTENCY_SCOPE_POS_QUICK_SALE = 'pos-quick-sale';

/** نطاق سند القبض النقدي المشتق (حارس ثانٍ داخل المعاملة). */
const IDEMPOTENCY_SCOPE_POS_CASH = 'pos-cash';

/** كود عميل النقدي الثابت (walk-in) — يُنشأ مرة واحدة ثم يُعاد استخدامه. */
const WALK_IN_CUSTOMER_CODE = 'WALK-IN';
const WALK_IN_CUSTOMER_NAME = 'عميل نقدي — نقطة البيع';

/**
 * SELIM-ERP W2 — خدمة نقطة البيع (تقلد POS.tsx + /api/pos في Selim ERP).
 *
 * البيع السريع = **معاملة واحدة ذرية** تدمج إنشاء أمر البيع + تأكيده:
 * إنشاء أمر CONFIRMED مباشرة (بيع نقدي فوري لا يمر بمسودة/اعتماد —
 * لذا لا ينطبق عليه فصل واجبات SAL-4: لا اعتماد ذاتي لأنه لا يوجد
 * خطوة اعتماد أصلًا) + صرف المخزون + قيد GL (إيراد/ضريبة/COGS) +
 * سند قبض آلي + سجل تدقيق + مفتاح idempotency واحد للطلب كله.
 *
 * إعادة استخدام أكبر قدر من منطق التأكيد نفسه (bulkIssueFinishedGoods،
 * CHART_OF_ACCOUNTS، computeVat) — بلا نسخ منطق المخزون.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly financial: FinancialPostingService,
    private readonly factorySettings: FactorySettingsService,
  ) {}

  /**
   * حل الباركود: يبحث في باركود التوليفة ثم باركود المنتج (أول توليفة
   * نشطة) — يرجع التفاصيل اللازمة للسلة (الأسعار بالك levels + المتاح).
   */
  async resolveBarcode(code: string) {
    const trimmed = (code ?? '').trim();
    if (!trimmed) throw new BadRequestException('الباركود مطلوب');

    // باركود توليفة مباشر.
    const variant = await this.prisma.productVariant.findFirst({
      where: { barcode: trimmed, isActive: true },
      include: {
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            retailPrice: true,
            wholesalePrice: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });
    if (variant && variant.product.isActive && !variant.product.deletedAt) {
      return this.toLookupResult(variant);
    }

    // باركود على مستوى المنتج — أول توليفة نشطة له.
    const product = await this.prisma.product.findFirst({
      where: { barcode: trimmed, isActive: true, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        retailPrice: true,
        wholesalePrice: true,
        variants: {
          where: { isActive: true },
          take: 1,
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!product || product.variants.length === 0) {
      throw new NotFoundException('لا يوجد صنف بهذا الباركود');
    }
    return this.toLookupResult({
      id: product.variants[0].id,
      productId: product.id,
      size: product.variants[0].size,
      color: product.variants[0].color,
      barcode: product.variants[0].barcode,
      product: {
        id: product.id,
        code: product.code,
        name: product.name,
        retailPrice: product.retailPrice,
        wholesalePrice: product.wholesalePrice,
      },
    });
  }

  /** بيع سريع ذري — راجع تعليق الصنف للتصميم الكامل. */
  async quickSale(dto: QuickSaleDto, userId: string, idempotencyKey?: string) {
    if (
      !dto.items.length ||
      dto.items.some(
        (item) => !Number.isInteger(item.quantity) || item.quantity <= 0,
      )
    ) {
      throw new BadRequestException(
        'كل بند بيع يجب أن يحتوي على كمية صحيحة موجبة',
      );
    }
    const variantIds = dto.items.map((item) => item.productVariantId);
    if (new Set(variantIds).size !== variantIds.length) {
      throw new BadRequestException(
        'لا يجوز تكرار الصنف داخل فاتورة نقطة البيع',
      );
    }
    const priceLevel = dto.priceLevel ?? PosPriceLevel.RETAIL;

    const requestHash = computeRequestHash({
      operation: IDEMPOTENCY_SCOPE_POS_QUICK_SALE,
      userId,
      customerId: dto.customerId ?? null,
      discount: dto.discount ?? 0,
      priceLevel,
      items: dto.items,
      notes: dto.notes ?? '',
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      IDEMPOTENCY_SCOPE_POS_QUICK_SALE,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(
          tx,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_POS_QUICK_SALE,
          requestHash,
        );

        // العميل: مسجل أو walk-in (upsert آمن ضد الإنشاء المتزامن).
        const customerId = await this.resolveCustomerId(dto.customerId, tx);

        const variants = await tx.productVariant.findMany({
          where: {
            id: { in: variantIds },
            isActive: true,
            product: { isActive: true, deletedAt: null },
          },
          include: { product: true },
        });
        if (variants.length !== variantIds.length) {
          throw new BadRequestException(
            'يوجد صنف غير موجود أو غير نشط في السلة',
          );
        }

        const fgWarehouse = await tx.warehouse.findFirst({
          where: {
            code: 'WH-FG',
            type: WarehouseType.FINISHED_GOODS,
            isActive: true,
          },
        });
        if (!fgWarehouse) {
          throw new BadRequestException(
            'مخزن المنتج التام الافتراضي غير موجود',
          );
        }

        // الأسعار خادميًا حسب مستوى السعر — العميل لا يرسل أسعارًا.
        let subtotal = 0;
        const orderItemsData = dto.items.map((item) => {
          const variant = variants.find((v) => v.id === item.productVariantId)!;
          const unitPrice =
            priceLevel === PosPriceLevel.WHOLESALE
              ? Number(variant.product.wholesalePrice)
              : Number(variant.product.retailPrice);
          const totalPrice = round2(unitPrice * item.quantity);
          subtotal += totalPrice;
          return {
            productVariantId: item.productVariantId,
            quantity: item.quantity,
            unitPrice,
            totalPrice,
          };
        });
        const discount = dto.discount ?? 0;
        if (discount < 0 || discount > subtotal) {
          throw new BadRequestException(
            'الخصم يجب أن يكون بين صفر وإجمالي البنود',
          );
        }
        const { vatAmount, totalAmount } = computeVat(subtotal, discount);

        // POS-<date>-<rand>: نفس مولد أكواد أوامر البيع (هي أوامر بيع).
        const code = generateDocumentCode(DocumentCodePrefix.SALES_ORDER);
        const order = await tx.salesOrder.create({
          data: {
            code,
            customerId,
            userId,
            paymentType: PaymentType.CASH,
            subtotal,
            vatRate: EGYPT_VAT_RATE,
            vatAmount,
            totalAmount,
            discount,
            paidAmount: totalAmount,
            status: SalesOrderStatus.CONFIRMED,
            notes: dto.notes,
            items: { create: orderItemsData },
          },
        });

        // صرف المخزون + التقاط COGS من نفس الأرصدة (نمط confirmOrder).
        let totalCogs = 0;
        const cogsByVariant = new Map<string, number>();
        if (orderItemsData.length > 0) {
          const cogsStocks =
            (await tx.finishedGoodStock.findMany({
              where: {
                warehouseId: fgWarehouse.id,
                productVariantId: { in: variantIds },
              },
              select: { productVariantId: true, unitCost: true },
            })) ?? [];
          for (const stock of cogsStocks) {
            cogsByVariant.set(stock.productVariantId, Number(stock.unitCost));
          }
          const bulkResult = await this.inventory.bulkIssueFinishedGoods(
            orderItemsData.map((item) => ({
              productVariantId: item.productVariantId,
              quantity: item.quantity,
              reference: code,
              notes: `صرف فاتورة نقطة بيع ${code}`,
            })),
            fgWarehouse.id,
            tx,
            userId,
          );
          totalCogs = bulkResult.totalValue;
        }

        // قيد GL: Dr CASH / Cr إيراد + ضريبة + COGS (نفس بنود التأكيد).
        const lines: {
          debitAccountId: string;
          creditAccountId: string;
          amount: number;
          description: string;
        }[] = [
          {
            debitAccountId: CHART_OF_ACCOUNTS.CASH,
            creditAccountId: CHART_OF_ACCOUNTS.SALES_REVENUE,
            amount: round2(subtotal - discount),
            description: `إيراد بيع نقطة بيع ${code}`,
          },
        ];
        if (vatAmount > 0) {
          lines.push({
            debitAccountId: CHART_OF_ACCOUNTS.CASH,
            creditAccountId: CHART_OF_ACCOUNTS.VAT_PAYABLE,
            amount: vatAmount,
            description: `ضريبة قيمة مضافة ${code}`,
          });
        }
        if (totalCogs > 0) {
          lines.push({
            debitAccountId: CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
            creditAccountId: CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK,
            amount: round2(totalCogs),
            description: `تكلفة بضاعة مباعة ${code}`,
          });
        }
        await this.financial.postJournalEntryInTx(
          tx,
          {
            description: `ترحيل بيع نقطة بيع ${code}`,
            reference: code,
            postingKey: `pos-sale:${order.id}`,
            isAuto: true,
            lines,
            userId,
            metadata: {
              source: 'pos.quickSale',
              salesOrderId: order.id,
              priceLevel,
              cogsLines: orderItemsData.map((item) => ({
                variantId: item.productVariantId,
                quantity: item.quantity,
                costPerUnit: cogsByVariant.get(item.productVariantId) ?? 0,
              })),
            },
          },
          userId,
        );

        // سند قبض نقدي آلي بمفتاح مشتق ثابت (نمط sales-confirm-cash).
        const cashPaymentKey = `pos-cash:${order.id}`;
        const cashRequestHash = computeRequestHash({
          operation: IDEMPOTENCY_SCOPE_POS_CASH,
          orderId: order.id,
          amount: totalAmount,
        });
        await createIdempotencyKey(
          tx,
          cashPaymentKey,
          IDEMPOTENCY_SCOPE_POS_CASH,
          cashRequestHash,
        );
        const cashPayment = await tx.customerPayment.create({
          data: {
            customerId,
            salesOrderId: order.id,
            amount: totalAmount,
            notes: `سند قبض آلي لنقطة البيع — أمر ${code}`,
          },
        });
        await storeIdempotencyResponse(tx, cashPaymentKey, {
          customerPaymentId: cashPayment?.id,
          salesOrderId: order.id,
          amount: totalAmount,
        });

        await tx.activityLog.create({
          data: {
            userId,
            action: 'POS_SALE_COMPLETED',
            module: 'SALES',
            details: {
              salesOrderId: order.id,
              code,
              customerId,
              priceLevel,
              totalAmount,
              vatAmount,
              cogsTotal: round2(totalCogs),
              itemsCount: orderItemsData.length,
              notes: dto.notes ?? null,
            },
          },
        });

        const receipt = await this.buildReceipt(order.id, tx);
        const response = { ...receipt, source: 'pos' };
        await storeIdempotencyResponse(tx, idempotencyKey, response);
        return response;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_POS_QUICK_SALE,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  /** عميل النقدي walk-in أو العميل المسجل — داخل معاملة البيع. */
  private async resolveCustomerId(
    customerId: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    if (customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('العميل غير موجود أو غير نشط');
      return customer.id;
    }
    const walkIn = await tx.customer.upsert({
      where: { code: WALK_IN_CUSTOMER_CODE },
      update: {},
      create: {
        code: WALK_IN_CUSTOMER_CODE,
        name: WALK_IN_CUSTOMER_NAME,
        notes: 'عميل نقدي افتراضي لنقطة البيع (Selim POS walk-in)',
      },
      select: { id: true },
    });
    return walkIn.id;
  }

  /** بناء حِمل الإيصار: أمر البيع + البنود بأسماء المنتجات + QR. */
  private async buildReceipt(orderId: string, tx: Prisma.TransactionClient) {
    // SELIM-ERP W3: بيانات التسجيل من إعدادات المصنع (الأسبقية على env).
    const settings = await this.factorySettings.getSettings();
    const order = await tx.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        customer: { select: { name: true, code: true } },
        items: {
          include: {
            variant: {
              include: { product: { select: { name: true, code: true } } },
            },
          },
        },
      },
    });
    const items = order.items.map((item) => ({
      name: item.variant.product.name,
      size: item.variant.size,
      color: item.variant.color,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      total: Number(item.totalPrice),
    }));
    return {
      orderId: order.id,
      code: order.code,
      customerName: order.customer.name,
      customerCode: order.customer.code,
      items,
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      vatRate: Number(order.vatRate),
      vatAmount: Number(order.vatAmount),
      total: Number(order.totalAmount),
      paid: Number(order.paidAmount),
      createdAt: order.createdAt.toISOString(),
      // QR الطباعة: TLV (ETA) عند توفر بيانات التسجيل، أو نص عادي.
      qrPayload: buildReceiptQrPayload({
        code: order.code,
        total: Number(order.totalAmount),
        vatAmount: Number(order.vatAmount),
        createdAt: order.createdAt,
        // SELIM-ERP W3: بيانات التسجيل من إعدادات المصنع (الأسبقية على env).
        sellerName: settings.factoryName,
        vatNumber: settings.taxNumber ?? undefined,
        enableInvoiceQr: settings.enableInvoiceQr,
      }),
    };
  }

  /** تحويل نتيجة البحث إلى شكل موحد لسلة نقطة البيع. */
  private toLookupResult(variant: {
    id: string;
    productId: string;
    size: string;
    color: string;
    barcode: string | null;
    product: {
      id: string;
      code: string;
      name: string;
      retailPrice: unknown;
      wholesalePrice: unknown;
      isActive?: boolean;
      deletedAt?: Date | null;
    };
  }) {
    const base = {
      variantId: variant.id,
      productId: variant.productId,
      code: variant.product.code,
      name: variant.product.name,
      size: variant.size,
      color: variant.color,
      barcode: variant.barcode ?? variant.product.code,
      retailPrice: Number(variant.product.retailPrice),
      wholesalePrice: Number(variant.product.wholesalePrice),
    };
    return base;
  }

  /**
   * كتالوج نقطة البيع — توليفات نشطة بأسعارها + المتاح في مخزن المنتج
   * التام. يُخزن في الجوال (CacheService) للعمل بلا اتصال: اختيار سريع
   * من الشبكة/بحث محلي بالاسم أو الباركود.
   */
  async getCatalog(limit?: string, search?: string) {
    const take = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const q = (search ?? '').trim();
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        retailPrice: true,
        wholesalePrice: true,
        variants: {
          where: { isActive: true },
          select: { id: true, size: true, color: true, barcode: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    // مجموع المتاح لكل توليفة في WH-FG (فقط ما له رصيد).
    const fgWarehouse = await this.prisma.warehouse.findFirst({
      where: {
        code: 'WH-FG',
        type: WarehouseType.FINISHED_GOODS,
        isActive: true,
      },
      select: { id: true },
    });
    const stockByVariant = new Map<string, number>();
    if (fgWarehouse) {
      const stocks = await this.prisma.finishedGoodStock.groupBy({
        by: ['productVariantId'],
        where: { warehouseId: fgWarehouse.id, quantity: { gt: 0 } },
        _sum: { quantity: true },
      });
      for (const row of stocks) {
        stockByVariant.set(
          row.productVariantId,
          Number(row._sum.quantity ?? 0),
        );
      }
    }

    const items = products.flatMap((product) =>
      product.variants.map((variant) => ({
        variantId: variant.id,
        productId: product.id,
        code: product.code,
        name: product.name,
        size: variant.size,
        color: variant.color,
        barcode: variant.barcode ?? product.code,
        retailPrice: Number(product.retailPrice),
        wholesalePrice: Number(product.wholesalePrice),
        availableQty: stockByVariant.get(variant.id) ?? 0,
      })),
    );
    return {
      items,
      count: items.length,
      generatedAt: new Date().toISOString(),
    };
  }
}

/** أدوار نقطة البيع — نفس أدوار قراءة المبيعات + الكاشير (صاحب الصندوق). */
export const POS_ROLES = [
  UserRole.CASHIER,
  UserRole.GENERAL_MANAGER,
  UserRole.SUPER_ADMIN,
];
