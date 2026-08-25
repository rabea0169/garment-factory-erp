import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentType, SalesOrderStatus, Prisma } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';
import {
  isIdempotencyUniqueViolation,
  computeRequestHash,
  tryReplayIdempotencyKey,
  createIdempotencyKey,
  storeIdempotencyResponse,
} from '../../core/common/idempotency.util';

/** نطاقات idempotency لمسارات الـ Sales — واحد لإنشاء أمر بيع، آخر للتأكيد. */
const IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE = 'sales-order-create';
const IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM = 'sales-order-confirm';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async getCustomers(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count(),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async createCustomer(data: {
    name: string;
    phone?: string;
    address?: string;
  }) {
    return this.prisma.customer.create({
      data: {
        ...data,
        // A7: كود عشوائي مشفّر بدل Date.now() — يمنع الاصطدامات وكشف التوقيت.
        code: generateDocumentCode(DocumentCodePrefix.CUSTOMER),
      },
    });
  }

  async getSalesOrders(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        skip,
        take: limit,
        // B1: include مختصر — نعرض فقط بيانات العميل الأدنى (id/name/code)
        // بدلاً من كائن العميل الكامل (الذي يحوي phone/address/balance/creditLimit
        // ومعلومات حساسة). تقليل حجم الـ response ومنع تسريب بيانات غير ضرورية.
        include: {
          customer: {
            select: { id: true, name: true, code: true },
          },
          items: {
            include: { variant: { include: { product: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.salesOrder.count(),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async createSalesOrder(
    data: {
      customerId: string;
      paymentType: PaymentType;
      discount: number;
      items: {
        productVariantId: string;
        quantity: number;
      }[];
    },
    userId: string,
    idempotencyKey?: string,
  ) {
    // A8: Idempotency-Key deduplication — إعادة التشغيل على نفس المفتاح/المحتوى،
    // 409 على نفس المفتاح بمحتوى مختلف. المفتاح يُلتزم داخل $transaction
    // كنقطة تسلسل: أي متزامن بنفس المفتاح يلتقط P2002 من DB.
    const requestPayload: Record<string, unknown> = {
      operation: IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE,
      userId,
      customerId: data.customerId,
      paymentType: data.paymentType,
      discount: data.discount,
      items: data.items.map((i) => ({
        productVariantId: i.productVariantId,
        quantity: i.quantity,
      })),
    };
    const requestHash = computeRequestHash(requestPayload);

    // (1) Replay — نفس المفتاح + نفس المحتوى → نفس الاستجابة بلا أثر جديد.
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE,
      requestHash,
    );
    if (replay)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return replay as unknown as Awaited<
        ReturnType<typeof SalesService.prototype.createSalesOrder>
      >;
    const variantIds = data.items.map((i) => i.productVariantId);

    // 1. Fetch variants to get actual prices from DB
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });

    if (variants.length !== variantIds.length) {
      throw new BadRequestException('One or more product variants not found');
    }

    // A5 (pre-check): تأكد من وفرة المخزون قبل إنشاء الأمر (fail-fast).
    // هذا الفحص استشاري فقط — الفحص atomic الحقيقي يحدث في confirmOrder
    // (لا يمكن ضمان atomicity عبر عدة طلبات HTTP). الهدف هنا منع إنشاء
    // أمر بيع لمستحيل من البداية (كمية أكبر بكثير من المتوفر).
    const availability = await Promise.all(
      data.items.map(async (item) => {
        const fg = await this.prisma.finishedGood.findFirst({
          where: { productVariantId: item.productVariantId },
          select: { quantity: true },
        });
        return {
          productVariantId: item.productVariantId,
          available: fg?.quantity ?? 0,
          requested: item.quantity,
        };
      }),
    );
    const insufficient = availability.filter((a) => a.available < a.requested);
    if (insufficient.length > 0) {
      const detail = insufficient
        .map(
          (a) =>
            `${a.productVariantId}: مطلوب ${a.requested}، متوفر ${a.available}`,
        )
        .join('; ');
      throw new BadRequestException(
        `مخزون غير كافٍ قبل إنشاء الأمر — ${detail}. يُنصح بمراجعة المخزون أو تقليل الكمية.`,
      );
    }

    let totalAmount = 0;
    const orderItemsData = data.items.map((item) => {
      const variant = variants.find((v) => v.id === item.productVariantId);
      // We will use wholesalePrice or retailPrice. For now, default to retailPrice
      const unitPrice = Number(variant!.product.retailPrice);
      const itemTotal = unitPrice * item.quantity;
      totalAmount += itemTotal;

      return {
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        unitPrice: unitPrice,
        totalPrice: itemTotal,
      };
    });

    totalAmount -= data.discount;
    if (totalAmount < 0) totalAmount = 0;

    // 2. Create the order as DRAFT — داخل $transaction لتخزين idempotency key
    // بنفس اللحظة التزام أمر البيع. هذا يضمن:
    // - إذا نجح الأمر + المفتاح معًا → إعادة الطلب بنفس المفتاح تُرجع نفس الاستجابة.
    // - إذا فشل أي منهما → كلاهما يُرجع (لا مفتاح بلا أمر).
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // (2) إنشاء سجل idempotency داخل الـ tx (نقطة التسلسل).
        // أي متزامن بنفس المفتاح يصطدم في P2002 من DB على unique key.
        await createIdempotencyKey(
          tx,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE,
          requestHash,
        );

        const created = await tx.salesOrder.create({
          data: {
            // A7: كود عشوائي مشفّر YYYYMMDD-XXXXXXXX بدل Date.now().
            code: generateDocumentCode(DocumentCodePrefix.SALES_ORDER),
            customerId: data.customerId,
            userId,
            paymentType: data.paymentType,
            totalAmount,
            discount: data.discount,
            status: SalesOrderStatus.DRAFT,
            items: {
              create: orderItemsData,
            },
          },
          include: { items: true },
        });

        // (3) تخزين الاستجابة على المفتاح — داخل نفس الـ tx.
        await storeIdempotencyResponse(tx, idempotencyKey, created);

        return created;
      });
      return result;
    } catch (err) {
      // (4) سباق idempotency: عملية أخرى بنفس المفتاح التزمت قبلك — استرجع استجابتها.
      if (isIdempotencyUniqueViolation(err) && idempotencyKey) {
        const replay = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE,
          requestHash,
        );
        if (replay)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return replay as unknown as Awaited<
            ReturnType<typeof SalesService.prototype.createSalesOrder>
          >;
        throw new ConflictException(
          'العملية بنفس المفتاح قيد التنفيذ أو فشلت قبل الاكتمال — أعد المحاولة بعد لحظات',
        );
      }
      throw err;
    }
  }

  async confirmOrder(orderId: string, userId: string, idempotencyKey?: string) {
    // A8: Idempotency-Key على التأكيد — التأكيد يفعل صرفًا ماليًا (decrement + SLE)،
    // فإعادة تشغيله بنفس المفتاح يجب أن تكون آمنة. الـ payload يحوي orderId+userId فقط
    // (لا يحوي الكميات لأنها تُقرأ من الأمر الموجود مسبقًا).
    const requestHash = computeRequestHash({
      operation: IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM,
      orderId,
      userId,
    });

    // (1) Replay — نفس المفتاح → نفس الاستجابة (نفس أمر البيع بعد التأكيد).
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM,
      requestHash,
    );
    if (replay)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return replay as unknown as Awaited<
        ReturnType<typeof SalesService.prototype.confirmOrder>
      >;
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new BadRequestException('Can only confirm DRAFT orders');
    }

    const fgWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-FG' },
    });
    if (!fgWarehouse)
      throw new BadRequestException('Default FG warehouse not found');

    try {
      return await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // A8: إنشاء سجل idempotency داخل نفس tx كنقطة تسلسل قبل أي تأثير.
          // المتزامن بنفس المفتاح يصطدم في P2002 من DB → يلتقطه الكاتش الخارجي.
          await createIdempotencyKey(
            tx,
            idempotencyKey,
            IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM,
            requestHash,
          );

          // 1. Mark order as CONFIRMED
          const updatedOrder = await tx.salesOrder.update({
            where: { id: orderId },
            data: { status: SalesOrderStatus.CONFIRMED },
          });

          // 2. Issue items from Inventory (Finished Goods)
          // A5: الطريقة atomic — نستخدم updateMany WHERE quantity >= N
          // بدلاً من findFirst+update (الذي يسمح بـ race condition بين طلبين متزامنين).
          // إذا count === 0، يعني أن مخزون آخر لحظة غير كافٍ (race-loser) — نرمي ConflictException.
          for (const item of order.items) {
            const fgRecord = await tx.finishedGood.findFirst({
              where: { productVariantId: item.productVariantId },
            });
            if (!fgRecord) {
              throw new BadRequestException(
                `لا يوجد سجل مخزون نهائي للمنتج ${item.productVariantId}`,
              );
            }

            // A5: الـ atomic decrement — WHERE quantity >= item.quantity
            // يضمن أن المستخدم الذي "يفوز" بالـ update هو الذي يرى الكمية الكافية.
            // المتزامن الآخر يرى count=0 (لأن الكمية نقصت) ويرمي ConflictException.
            const updateResult = await tx.finishedGood.updateMany({
              where: {
                id: fgRecord.id,
                quantity: { gte: item.quantity },
              },
              data: {
                quantity: { decrement: item.quantity },
              },
            });

            if (updateResult.count === 0) {
              // Race-loser — مستخدم آخر أخذ المخزون بين pre-check و update.
              throw new ConflictException(
                `فشل صرف ${item.quantity} من المنتج ${item.productVariantId} — المخزون الحالي غير كافٍ. يُرجى إعادة المراجعة.`,
              );
            }

            // A5: الكمية الجديدة محسوبة بعد الـ atomic update — نقرأها مرة أخرى.
            const updatedFg = await tx.finishedGood.findUnique({
              where: { id: fgRecord.id },
              select: { quantity: true },
            });
            const newBalance = updatedFg?.quantity ?? 0;

            await tx.stockLedgerEntry.create({
              data: {
                // A7: كود عشوائي مشفّر
                entryCode: generateDocumentCode(
                  DocumentCodePrefix.STOCK_LEDGER_ENTRY,
                ),
                type: 'ISSUE', // StockMovementType.ISSUE
                warehouseId: fgWarehouse.id,
                productVariantId: item.productVariantId,
                quantityDelta: -item.quantity,
                balanceAfter: newBalance,
                reference: updatedOrder.code,
                notes: `صرف فاتورة مبيعات ${updatedOrder.code}`,
                createdById: userId,
              },
            });
          }

          // A8: تخزين الاستجابة على المفتاح — داخل نفس tx (لا تُخزَّن إلا عند النجاح).
          await storeIdempotencyResponse(tx, idempotencyKey, updatedOrder);

          return updatedOrder;
        },
      );
    } catch (err) {
      // A8: سباق idempotency — عملية أخرى بنفس المفتاح التزمت قبلك.
      if (isIdempotencyUniqueViolation(err) && idempotencyKey) {
        const replay = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM,
          requestHash,
        );
        if (replay)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return replay as unknown as Awaited<
            ReturnType<typeof SalesService.prototype.confirmOrder>
          >;
        throw new ConflictException(
          'العملية بنفس المفتاح قيد التنفيذ أو فشلت قبل الاكتمال — أعد المحاولة بعد لحظات',
        );
      }
      throw err;
    }
  }
}
