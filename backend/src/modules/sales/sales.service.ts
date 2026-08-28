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
const IDEMPOTENCY_SCOPE_CUSTOMER_PAYMENT_CREATE = 'customer-payment-create';
const IDEMPOTENCY_SCOPE_SALES_ORDER_CANCEL = 'sales-order-cancel';
const IDEMPOTENCY_SCOPE_SALES_RETURN_CREATE = 'sales-return-create';

type CustomerPaymentInput = {
  customerId: string;
  salesOrderId?: string;
  amount: number;
  notes?: string;
  actorId: string;
};

type SalesReturnInput = {
  items: { salesOrderItemId: string; quantity: number }[];
  reason?: string;
  actorId: string;
};

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
    email?: string;
    creditLimit?: number;
    creditTermsDays?: number;
  }) {
    return this.prisma.customer.create({
      data: {
        name: data.name,
        phone: data.phone,
        address: data.address,
        email: data.email,
        // Wave 6 — COMM-F07: pass through the optional credit limit / terms.
        // Prisma accepts `undefined` (skip the field) and `null` (explicitly
        // store NULL). The DTO sends `number | undefined`; either is fine.
        creditLimit: data.creditLimit,
        creditTermsDays: data.creditTermsDays ?? 0,
        code: generateDocumentCode(DocumentCodePrefix.CUSTOMER),
      },
    });
  }

  /**
   * Wave 6 — COMM-F07: update an existing customer's general contact info.
   * `balance`, `code`, `creditLimit`, `creditTermsDays` are NOT editable here
   * — credit fields go through `updateCustomerCredit` so they can be audited
   * distinctly, and balance is governed by the financial posting service.
   */
  async updateCustomer(
    id: string,
    data: {
      name?: string;
      phone?: string;
      address?: string;
      email?: string;
      notes?: string;
    },
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('العميل غير موجود');
    }
    if (existing.deletedAt) {
      throw new BadRequestException('لا يمكن تعديل عميل محذوف — استرجعه أولًا');
    }
    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  /**
   * Wave 6 — COMM-F07: adjust the credit limit / terms on an existing customer.
   *
   * Accepts null for creditLimit to mean "remove the limit" (unlimited). This
   * is a privileged action (GENERAL_MANAGER only — enforced at the controller)
   * because it directly affects the factory's credit exposure.
   *
   * The write is logged via ActivityLog so credit-limit changes are auditable
   * even if the customer record itself is later edited.
   */
  async updateCustomerCredit(
    id: string,
    input: {
      creditLimit?: number | null;
      creditTermsDays?: number;
    },
    actorId: string,
  ) {
    const existing = await this.prisma.customer.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('العميل غير موجود');
    }
    if (existing.deletedAt) {
      throw new BadRequestException(
        'لا يمكن تعديل حد ائتماني لعميل محذوف — استرجعه أولًا',
      );
    }

    // Build update payload — only fields that are actually present.
    const data: { creditLimit?: number | null; creditTermsDays?: number } = {};
    if (input.creditLimit !== undefined) {
      // Prisma treats `null` as "store NULL" (= unlimited). Allow it.
      data.creditLimit = input.creditLimit;
    }
    if (input.creditTermsDays !== undefined) {
      data.creditTermsDays = input.creditTermsDays;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id },
        data,
      });
      await tx.activityLog.create({
        data: {
          action: 'CUSTOMER_CREDIT_LIMIT_UPDATED',
          module: 'SALES',
          userId: actorId,
          details: {
            entityType: 'Customer',
            entityId: id,
            previous: {
              creditLimit: existing.creditLimit?.toString?.() ?? null,
              creditTermsDays: existing.creditTermsDays,
            },
            next: {
              creditLimit: customer.creditLimit?.toString?.() ?? null,
              creditTermsDays: customer.creditTermsDays,
            },
          },
        },
      });
      return customer;
    });
    return updated;
  }

  async createCustomerPayment(
    input: CustomerPaymentInput,
    idempotencyKey?: string,
  ) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException('قيمة الدفعة يجب أن تكون أكبر من صفر');
    }

    const requestHash = computeRequestHash({
      operation: IDEMPOTENCY_SCOPE_CUSTOMER_PAYMENT_CREATE,
      customerId: input.customerId,
      salesOrderId: input.salesOrderId ?? null,
      amount: input.amount,
      notes: input.notes ?? null,
      actorId: input.actorId,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      IDEMPOTENCY_SCOPE_CUSTOMER_PAYMENT_CREATE,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(
          tx,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_CUSTOMER_PAYMENT_CREATE,
          requestHash,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM customers WHERE id = ${input.customerId} FOR UPDATE`,
        );

        const customer = await tx.customer.findUnique({
          where: { id: input.customerId },
          select: { id: true, isActive: true, deletedAt: true, balance: true },
        });
        if (!customer || !customer.isActive || customer.deletedAt) {
          throw new NotFoundException('العميل غير موجود أو غير نشط');
        }

        let order: {
          id: string;
          customerId: string;
          status: SalesOrderStatus;
          totalAmount: Prisma.Decimal;
          paidAmount: Prisma.Decimal;
        } | null = null;
        if (input.salesOrderId) {
          order = await tx.salesOrder.findUnique({
            where: { id: input.salesOrderId },
            select: {
              id: true,
              customerId: true,
              status: true,
              totalAmount: true,
              paidAmount: true,
            },
          });
          if (!order || order.customerId !== input.customerId) {
            throw new NotFoundException('أمر البيع غير موجود لهذا العميل');
          }
          if (
            order.status !== SalesOrderStatus.CONFIRMED &&
            order.status !== SalesOrderStatus.SHIPPED
          ) {
            throw new BadRequestException(
              'لا يمكن تحصيل دفعة إلا لأمر بيع مؤكد أو مشحون',
            );
          }
        }

        const outstanding = order
          ? Number(order.totalAmount) - Number(order.paidAmount)
          : Number(customer.balance);
        if (input.amount > outstanding + 0.0001) {
          throw new BadRequestException(
            `قيمة الدفعة تتجاوز المتبقي (${round2(outstanding)})`,
          );
        }

        if (order) {
          const updated = await tx.salesOrder.updateMany({
            where: { id: order.id, paidAmount: order.paidAmount },
            data: { paidAmount: { increment: input.amount } },
          });
          if (updated.count !== 1) {
            throw new ConflictException('تم تحديث دفعة أمر البيع بالتزامن');
          }
        }

        const payment = await tx.customerPayment.create({
          data: {
            customerId: input.customerId,
            salesOrderId: input.salesOrderId,
            amount: input.amount,
            notes: input.notes?.trim() || undefined,
          },
        });
        await this.financial.postJournalEntryInTx(
          tx,
          {
            description: `تحصيل من العميل ${input.customerId}`,
            reference: input.salesOrderId ?? payment.id,
            postingKey: `customer-payment:${payment.id}`,
            isAuto: true,
            lines: [
              {
                debitAccountId: CHART_OF_ACCOUNTS.CASH,
                creditAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
                amount: input.amount,
                description: 'تحصيل ذمم مدينة',
              },
            ],
            userId: input.actorId,
            customerUpdates: [
              { customerId: input.customerId, delta: -input.amount },
            ],
            metadata: {
              source: 'sales.customer-payment',
              customerPaymentId: payment.id,
              customerId: input.customerId,
              salesOrderId: input.salesOrderId ?? null,
            },
          },
          input.actorId,
        );
        await storeIdempotencyResponse(tx, idempotencyKey, payment);
        // SEC-F02: audit trail for every cash receipt.
        await tx.activityLog.create({
          data: {
            userId: input.actorId,
            action: 'CUSTOMER_PAYMENT_CREATED',
            module: 'SALES',
            details: {
              customerPaymentId: payment.id,
              customerId: input.customerId,
              salesOrderId: input.salesOrderId ?? null,
              amount: input.amount,
            },
          },
        });
        return payment;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_CUSTOMER_PAYMENT_CREATE,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  async createSalesReturn(
    orderId: string,
    input: SalesReturnInput,
    idempotencyKey?: string,
  ) {
    if (
      !input.items.length ||
      input.items.some(
        (item) => !Number.isInteger(item.quantity) || item.quantity <= 0,
      )
    ) {
      throw new BadRequestException('كل بند مرتجع يجب أن يحتوي على كمية موجبة');
    }
    if (
      new Set(input.items.map((item) => item.salesOrderItemId)).size !==
      input.items.length
    ) {
      throw new BadRequestException('لا يجوز تكرار بند أمر البيع في المرتجع');
    }

    const requestHash = computeRequestHash({
      operation: IDEMPOTENCY_SCOPE_SALES_RETURN_CREATE,
      orderId,
      items: input.items,
      reason: input.reason ?? null,
      actorId: input.actorId,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      IDEMPOTENCY_SCOPE_SALES_RETURN_CREATE,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const idempotencyKeyId = await createIdempotencyKey(
          tx,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_RETURN_CREATE,
          requestHash,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM sales_orders WHERE id = ${orderId} FOR UPDATE`,
        );
        const order = await tx.salesOrder.findUnique({
          where: { id: orderId },
          include: { items: true, customer: true },
        });
        if (!order) throw new NotFoundException('أمر البيع غير موجود');
        if (
          order.status !== SalesOrderStatus.CONFIRMED &&
          order.status !== SalesOrderStatus.SHIPPED
        ) {
          throw new BadRequestException(
            'لا يمكن إرجاع إلا أمر بيع مؤكد أو مشحون',
          );
        }

        const previousReturns = await tx.salesReturnItem.findMany({
          where: { salesOrderItem: { salesOrderId: orderId } },
          select: { salesOrderItemId: true, quantity: true },
        });
        const returnedByItem = new Map<string, number>();
        for (const returned of previousReturns) {
          returnedByItem.set(
            returned.salesOrderItemId,
            (returnedByItem.get(returned.salesOrderItemId) ?? 0) +
              returned.quantity,
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

        let merchandiseAmount = 0;
        let cogsAmount = 0;
        const returnItems: {
          salesOrderItemId: string;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
        }[] = [];
        for (const requested of input.items) {
          const orderItem = order.items.find(
            (item) => item.id === requested.salesOrderItemId,
          );
          if (!orderItem) {
            throw new NotFoundException('بند أمر البيع غير موجود');
          }
          const alreadyReturned = returnedByItem.get(orderItem.id) ?? 0;
          if (requested.quantity > orderItem.quantity - alreadyReturned) {
            throw new BadRequestException(
              `الكمية المرتجعة تتجاوز المتاح للبند ${orderItem.id}`,
            );
          }
          const stock = await tx.finishedGoodStock.findUnique({
            where: {
              warehouseId_productVariantId: {
                warehouseId: fgWarehouse.id,
                productVariantId: orderItem.productVariantId,
              },
            },
            select: { unitCost: true },
          });
          const unitCost = Number(stock?.unitCost ?? 0);
          await this.inventoryService.receiveFinishedGood(
            {
              productVariantId: orderItem.productVariantId,
              warehouseId: fgWarehouse.id,
              quantity: requested.quantity,
              unitCost,
              reference: `RETURN-${order.code}`,
              notes: `مرتجع مبيعات ${order.code}`,
            },
            input.actorId,
            tx,
          );
          const totalPrice = round2(
            Number(orderItem.unitPrice) * requested.quantity,
          );
          merchandiseAmount += totalPrice;
          cogsAmount += round2(unitCost * requested.quantity);
          returnItems.push({
            salesOrderItemId: orderItem.id,
            quantity: requested.quantity,
            unitPrice: Number(orderItem.unitPrice),
            totalPrice,
          });
        }

        const vatAmount = round2(
          merchandiseAmount * Number(order.vatRate ?? 0),
        );
        const refundAmount = round2(merchandiseAmount + vatAmount);
        const cashRefund = Math.min(Number(order.paidAmount), refundAmount);
        const receivableReduction = round2(refundAmount - cashRefund);
        const returnData = {
          code: generateDocumentCode(DocumentCodePrefix.SALES_RETURN),
          salesOrderId: order.id,
          customerId: order.customerId,
          userId: input.actorId,
          totalAmount: refundAmount,
          reason: input.reason?.trim() || undefined,
          idempotencyKeyId,
          items: { create: returnItems },
        };
        const created = await tx.salesReturn.create({
          data: returnData,
          include: { items: true },
        });

        if (cashRefund > 0) {
          const paymentUpdate = await tx.salesOrder.updateMany({
            where: { id: order.id, paidAmount: order.paidAmount },
            data: { paidAmount: { decrement: cashRefund } },
          });
          if (paymentUpdate.count !== 1) {
            throw new ConflictException('تم تحديث دفعة الأمر بالتزامن');
          }
        }

        const lines = [
          ...(merchandiseAmount > 0
            ? [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.SALES_REVENUE,
                  creditAccountId:
                    receivableReduction > 0
                      ? CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE
                      : CHART_OF_ACCOUNTS.CASH,
                  amount: merchandiseAmount,
                  description: `عكس إيراد المرتجع ${order.code}`,
                },
              ]
            : []),
          ...(vatAmount > 0
            ? [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.VAT_PAYABLE,
                  creditAccountId:
                    receivableReduction > 0
                      ? CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE
                      : CHART_OF_ACCOUNTS.CASH,
                  amount: vatAmount,
                  description: `عكس ضريبة المرتجع ${order.code}`,
                },
              ]
            : []),
          ...(cogsAmount > 0
            ? [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.INVENTORY,
                  creditAccountId: CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
                  amount: cogsAmount,
                  description: `عكس تكلفة المرتجع ${order.code}`,
                },
              ]
            : []),
        ];
        await this.financial.postJournalEntryInTx(
          tx,
          {
            description: `ترحيل مرتجع ${order.code}`,
            reference: created.code,
            postingKey: `sales-return:${created.id}`,
            isAuto: true,
            lines,
            userId: input.actorId,
            customerUpdates:
              receivableReduction > 0
                ? [
                    {
                      customerId: order.customerId,
                      delta: -receivableReduction,
                    },
                  ]
                : undefined,
            metadata: {
              source: 'sales.return',
              salesReturnId: created.id,
              salesOrderId: order.id,
            },
          },
          input.actorId,
        );
        await storeIdempotencyResponse(tx, idempotencyKey, created);
        return created;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_RETURN_CREATE,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  async cancelOrder(orderId: string, userId: string, idempotencyKey?: string) {
    const requestHash = computeRequestHash({
      operation: IDEMPOTENCY_SCOPE_SALES_ORDER_CANCEL,
      orderId,
      userId,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      IDEMPOTENCY_SCOPE_SALES_ORDER_CANCEL,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(
          tx,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_ORDER_CANCEL,
          requestHash,
        );
        const order = await tx.salesOrder.findUnique({
          where: { id: orderId },
          select: { id: true, status: true },
        });
        if (!order) throw new NotFoundException('أمر البيع غير موجود');
        if (order.status !== SalesOrderStatus.DRAFT) {
          throw new BadRequestException(
            'لا يمكن إلغاء إلا أمر بيع مسودة قبل التأكيد',
          );
        }
        const transition = await tx.salesOrder.updateMany({
          where: { id: orderId, status: SalesOrderStatus.DRAFT },
          data: { status: SalesOrderStatus.CANCELLED },
        });
        if (transition.count !== 1) {
          throw new ConflictException('تم تغيير أمر البيع بالتزامن');
        }
        const cancelled = await tx.salesOrder.findUniqueOrThrow({
          where: { id: orderId },
          include: { items: true },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, cancelled);
        return cancelled;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_SALES_ORDER_CANCEL,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
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
        // SEC-F02: record an audit trail entry for every financial write.
        await tx.activityLog.create({
          data: {
            userId,
            action: 'SALES_ORDER_CREATED',
            module: 'SALES',
            details: {
              salesOrderId: created.id,
              code: created.code,
              customerId: data.customerId,
              totalAmount,
              itemsCount: data.items.length,
            },
          },
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

  async confirmOrder(orderId: string, userId: string, idempotencyKey?: string) {
    const requestHash = computeRequestHash({
      operation: IDEMPOTENCY_SCOPE_SALES_ORDER_CONFIRM,
      orderId,
      userId,
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

        // Wave 6 — COMM-F07: credit ceiling check.
        // For CREDIT orders, project the customer's outstanding AR (balance)
        // plus the new order's total against their creditLimit.
        // Semantics:
        //   * creditLimit = NULL  → unlimited (historical behavior, no check)
        //   * creditLimit = 0     → no credit allowed at all (any CREDIT order is rejected)
        //   * creditLimit > 0     → cap at this number (current AR + new order ≤ limit)
        // We use the customer record that was eager-loaded above (order.customer)
        // so no extra DB round trip is needed inside the tx. The check happens
        // BEFORE the status transition so a failed check leaves the order in DRAFT.
        if (order.paymentType === PaymentType.CREDIT) {
          const customer = order.customer;
          if (customer) {
            const limit = customer.creditLimit;
            const limitNum =
              limit !== null && limit !== undefined ? Number(limit) : null;
            if (limitNum !== null) {
              const currentBalance = Number(customer.balance ?? 0);
              const orderTotal = Number(order.totalAmount ?? 0);
              const projected = currentBalance + orderTotal;
              if (limitNum === 0) {
                throw new BadRequestException(
                  `لا يُسمح ببيع آجل لهذا العميل — الحد الائتماني = 0 ` +
                    `(الرصيد ${currentBalance} + الطلب ${orderTotal} > 0)`,
                );
              }
              if (limitNum > 0 && projected > limitNum + 0.01) {
                throw new BadRequestException(
                  `تجاوز الحد الائتماني للعميل: الرصيد الحالي ${currentBalance} ` +
                    `+ قيمة الطلب ${orderTotal} = ${projected} > الحد ${limitNum}`,
                );
              }
            }
          }
        }

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
        if (order.items.length > 0) {
          // PERF-F02: bulk-issue finished goods in 3 queries instead of 3N.
          // The old code did `for (const item of order.items) await issueFinishedGood(...)`,
          // which on a 10-item order ran 31 sequential round-trips inside the tx.
          // The bulk path: 1 findMany + N parallel updateMany + 1 createMany ≈ 12.
          const bulkResult = await this.inventoryService.bulkIssueFinishedGoods(
            order.items.map((item) => ({
              productVariantId: item.productVariantId,
              quantity: item.quantity,
              reference: order.code,
              notes: `صرف فاتورة مبيعات ${order.code}`,
            })),
            fgWarehouse.id,
            tx,
            userId,
          );
          totalCogs = bulkResult.totalValue;
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
