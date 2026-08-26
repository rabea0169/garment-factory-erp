import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentType,
  Prisma,
  SalesOrderStatus,
  WarehouseType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import {
  CHART_OF_ACCOUNTS,
  EGYPT_VAT_RATE,
  computeVat,
} from '../../core/financial/chart-of-accounts';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  DocumentCodePrefix,
  generateDocumentCode,
} from '../../core/common/codes.util';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';

const IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE = 'sales-order-create';
const IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM = 'sales-order-confirm';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly financial: FinancialPostingService,
  ) {}

  async getCustomers(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const where = { isActive: true, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
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
        code: generateDocumentCode(DocumentCodePrefix.CUSTOMER),
      },
    });
  }

  async getSalesOrders(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const where: Prisma.SalesOrderWhereInput = {
      customer: { deletedAt: null },
    };
    const [data, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where,
        include: {
          customer: { select: { id: true, name: true, code: true } },
          items: { include: { variant: { include: { product: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return new PaginatedResult(data, total, page, limit);
  }

  async createSalesOrder(
    data: {
      customerId: string;
      paymentType: PaymentType;
      discount: number;
      items: { productVariantId: string; quantity: number }[];
    },
    userId: string,
    idempotencyKey?: string,
  ) {
    if (
      !data.items.length ||
      data.items.some(
        (item) => !Number.isInteger(item.quantity) || item.quantity <= 0,
      )
    ) {
      throw new BadRequestException(
        'كل بند بيع يجب أن يحتوي على كمية صحيحة موجبة',
      );
    }
    const variantIds = data.items.map((item) => item.productVariantId);
    if (new Set(variantIds).size !== variantIds.length) {
      throw new BadRequestException('لا يجوز تكرار المنتج داخل أمر البيع');
    }
    const requestHash = computeRequestHash({
      operation: IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE,
      userId,
      customerId: data.customerId,
      paymentType: data.paymentType,
      discount: data.discount,
      items: data.items,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE,
      requestHash,
    );
    if (replay) return replay;

    const customer = await this.prisma.customer.findFirst({
      where: { id: data.customerId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود أو غير نشط');

    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
        isActive: true,
        product: { isActive: true, deletedAt: null },
      },
      include: { product: true },
    });
    if (variants.length !== variantIds.length) {
      throw new BadRequestException('يوجد منتج أو صنف غير موجود أو غير نشط');
    }

    let subtotal = 0;
    const orderItemsData = data.items.map((item) => {
      const variant = variants.find(
        (value) => value.id === item.productVariantId,
      )!;
      const unitPrice = Number(variant.product.retailPrice);
      const totalPrice = round2(unitPrice * item.quantity);
      subtotal += totalPrice;
      return {
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
      };
    });
    const { vatAmount, totalAmount } = computeVat(subtotal, data.discount);
    if (data.discount < 0 || data.discount > subtotal) {
      throw new BadRequestException('الخصم يجب أن يكون بين صفر وإجمالي البنود');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(
          tx,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE,
          requestHash,
        );
        const created = await tx.salesOrder.create({
          data: {
            code: generateDocumentCode(DocumentCodePrefix.SALES_ORDER),
            customerId: data.customerId,
            userId,
            paymentType: data.paymentType,
            subtotal,
            vatRate: EGYPT_VAT_RATE,
            vatAmount,
            totalAmount,
            discount: data.discount,
            status: SalesOrderStatus.DRAFT,
            items: { create: orderItemsData },
          },
          include: { items: true },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, created);
        return created;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_ORDER_CREATE,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  async confirmOrder(
    orderId: string,
    userId: string,
    idempotencyKey?: string,
    treasuryId?: string,
  ) {
    const requestHash = computeRequestHash({
      operation: IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM,
      orderId,
      userId,
      treasuryId: treasuryId ?? null,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(
          tx,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM,
          requestHash,
        );
        const order = await tx.salesOrder.findUnique({
          where: { id: orderId },
          include: { items: true, customer: true },
        });
        if (!order) throw new NotFoundException('أمر البيع غير موجود');
        if (order.paymentType === PaymentType.CASH && !treasuryId) {
          throw new BadRequestException(
            'معرف الخزينة مطلوب لتأكيد البيع النقدي',
          );
        }
        if (order.paymentType !== PaymentType.CASH && treasuryId) {
          throw new BadRequestException('لا يجوز تحديد خزينة للبيع الآجل');
        }
        if (order.status !== SalesOrderStatus.DRAFT) {
          throw new BadRequestException(
            'لا يمكن تأكيد إلا أمر بيع بحالة DRAFT',
          );
        }
        const fgWarehouse = await tx.warehouse.findFirst({
          where: {
            code: 'WH-FG',
            type: WarehouseType.FINISHED_GOODS,
            isActive: true,
          },
        });
        if (!fgWarehouse)
          throw new BadRequestException(
            'مخزن المنتج التام الافتراضي غير موجود',
          );

        const transition = await tx.salesOrder.updateMany({
          where: { id: orderId, status: SalesOrderStatus.DRAFT },
          data: {
            status: SalesOrderStatus.CONFIRMED,
            paidAmount:
              order.paymentType === PaymentType.CASH ? order.totalAmount : 0,
          },
        });
        if (transition.count !== 1)
          throw new ConflictException('تم تغيير أمر البيع بالتزامن');

        let totalCogs = 0;
        for (const item of order.items) {
          const movement = await this.inventoryService.issueFinishedGood(
            {
              productVariantId: item.productVariantId,
              warehouseId: fgWarehouse.id,
              quantity: item.quantity,
              reference: order.code,
              notes: `صرف فاتورة مبيعات ${order.code}`,
              idempotencyKey: `sales.confirm:${order.id}:${item.id}`,
            },
            userId,
            tx,
          );
          totalCogs += movement.totalValue ?? 0;
        }

        const debitAccount =
          order.paymentType === PaymentType.CASH
            ? CHART_OF_ACCOUNTS.CASH
            : CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE;
        const lines: {
          debitAccountId: string;
          creditAccountId: string;
          amount: number;
          description: string;
        }[] = [
          {
            debitAccountId: debitAccount,
            creditAccountId: CHART_OF_ACCOUNTS.SALES_REVENUE,
            amount: round2(
              Number(order.subtotal) - Number(order.discount ?? 0),
            ),
            description: `إيراد بيع ${order.code}`,
          },
        ];
        if (Number(order.vatAmount) > 0) {
          lines.push({
            debitAccountId: debitAccount,
            creditAccountId: CHART_OF_ACCOUNTS.VAT_PAYABLE,
            amount: Number(order.vatAmount),
            description: `ضريبة قيمة مضافة ${order.code}`,
          });
        }
        if (totalCogs > 0) {
          lines.push({
            debitAccountId: CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
            creditAccountId: CHART_OF_ACCOUNTS.INVENTORY,
            amount: round2(totalCogs),
            description: `تكلفة بضاعة مباعة ${order.code}`,
          });
        }
        const treasuryUpdates =
          order.paymentType === PaymentType.CASH
            ? [{ treasuryId: treasuryId!, delta: Number(order.totalAmount) }]
            : undefined;

        await this.financial.postJournalEntryInTx(
          tx,
          {
            description: `ترحيل بيع ${order.code}`,
            reference: order.code,
            postingKey: `sales-confirm:${order.id}`,
            isAuto: true,
            lines,
            userId,
            metadata: {
              source: 'sales.confirm',
              salesOrderId: order.id,
              ...(treasuryUpdates ? { treasuryUpdates } : {}),
              ...(order.paymentType === PaymentType.CASH
                ? {}
                : {
                    customerUpdates: [
                      {
                        customerId: order.customerId,
                        delta: Number(order.totalAmount),
                      },
                    ],
                  }),
            },
            treasuryUpdates,
            customerUpdates:
              order.paymentType === PaymentType.CASH
                ? undefined
                : [
                    {
                      customerId: order.customerId,
                      delta: Number(order.totalAmount),
                    },
                  ],
          },
          userId,
        );

        const confirmedOrder = await tx.salesOrder.findUniqueOrThrow({
          where: { id: orderId },
          include: { items: true },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, confirmedOrder);
        return confirmedOrder;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
