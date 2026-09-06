import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentType, SalesOrderStatus } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import * as crypto from 'node:crypto';

function makeService() {
  const prisma = createPrismaMock();
  const issueFinishedGood = jest.fn();
  const receiveFinishedGood = jest.fn();
  const bulkIssueFinishedGoods = jest.fn();
  const postJournalEntryInTx = jest.fn();
  const inventory = {
    issueFinishedGood,
    receiveFinishedGood,
    bulkIssueFinishedGoods,
  } as unknown as InventoryService;
  const financial = {
    postJournalEntryInTx,
  } as unknown as FinancialPostingService;
  return {
    prisma,
    inventory,
    financial,
    issueFinishedGood,
    receiveFinishedGood,
    bulkIssueFinishedGoods,
    postJournalEntryInTx,
    service: new SalesService(
      prisma as unknown as PrismaService,
      inventory,
      financial,
    ),
  };
}

describe('SalesService — Cluster 5 corrective coverage', () => {
  it('filters soft-deleted customers and returns paginated data', async () => {
    const { prisma, service } = makeService();
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.customer.count.mockResolvedValue(0);

    await service.getCustomers({ page: 1, limit: 20 });

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, deletedAt: null } }),
    );
    expect(prisma.customer.count).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null },
    });
  });

  it('persists contact email when creating a customer', async () => {
    const { prisma, service } = makeService();
    prisma.customer.create.mockResolvedValue({
      id: 'customer-1',
      code: 'CUS-0001',
      name: 'مصنع النور',
      phone: '+201001234567',
      email: 'sales@example.com',
      address: 'القاهرة',
    });

    await service.createCustomer({
      name: 'مصنع النور',
      phone: '+201001234567',
      email: 'sales@example.com',
      address: 'القاهرة',
    });

    const createCalls = prisma.customer.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const createCall = createCalls[0]?.[0];
    expect(createCall).toBeDefined();
    if (!createCall) throw new Error('customer.create was not called');

    expect(createCall.data).toEqual(
      expect.objectContaining({
        name: 'مصنع النور',
        phone: '+201001234567',
        email: 'sales@example.com',
        address: 'القاهرة',
      }),
    );
    expect(typeof createCall.data.code).toBe('string');
  });

  it('collects a customer payment through cash and receivables posting', async () => {
    const { prisma, postJournalEntryInTx, service } = makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.customer.findUnique.mockResolvedValue({
      id: 'customer-1',
      isActive: true,
      deletedAt: null,
      balance: 100,
    });
    prisma.customerPayment.create.mockResolvedValue({
      id: 'payment-1',
      customerId: 'customer-1',
      amount: 40,
    });

    await service.createCustomerPayment({
      customerId: 'customer-1',
      amount: 40,
      notes: 'دفعة نقدية',
      actorId: 'user-1',
    });

    expect(prisma.customerPayment.create).toHaveBeenCalledWith({
      data: {
        customerId: 'customer-1',
        salesOrderId: undefined,
        amount: 40,
        notes: 'دفعة نقدية',
      },
    });
    expect(postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        customerUpdates: [{ customerId: 'customer-1', delta: -40 }],
      }),
      'user-1',
    );
  });

  it('rejects a customer payment above the outstanding balance', async () => {
    const { prisma, service } = makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.customer.findUnique.mockResolvedValue({
      id: 'customer-1',
      isActive: true,
      deletedAt: null,
      balance: 25,
    });

    await expect(
      service.createCustomerPayment({
        customerId: 'customer-1',
        amount: 30,
        actorId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customerPayment.create).not.toHaveBeenCalled();
  });

  it('cancels a draft order with an optimistic status transition', async () => {
    const { prisma, service } = makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.salesOrder.findUnique
      .mockResolvedValueOnce({ id: 'so-1', status: SalesOrderStatus.DRAFT })
      .mockResolvedValueOnce({
        id: 'so-1',
        status: SalesOrderStatus.CANCELLED,
        items: [],
      });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CANCELLED,
      items: [],
    });

    const result = await service.cancelOrder('so-1', 'user-1');

    expect(result).toMatchObject({ status: SalesOrderStatus.CANCELLED });
    expect(prisma.salesOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'so-1', status: SalesOrderStatus.DRAFT },
      data: { status: SalesOrderStatus.CANCELLED },
    });
  });

  it('rejects cancelling an already confirmed order', async () => {
    const { prisma, service } = makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });

    await expect(service.cancelOrder('so-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('creates a sales return, restores finished stock, and reverses financial impact', async () => {
    const { prisma, receiveFinishedGood, postJournalEntryInTx, service } =
      makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      customerId: 'customer-1',
      status: SalesOrderStatus.CONFIRMED,
      vatRate: 0.14,
      paidAmount: 100,
      customer: { id: 'customer-1' },
      items: [
        {
          id: 'item-1',
          productVariantId: 'variant-1',
          quantity: 2,
          unitPrice: 50,
        },
      ],
    });
    prisma.salesReturnItem.findMany.mockResolvedValue([]);
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'warehouse-fg' });
    prisma.finishedGoodStock.findUnique.mockResolvedValue({ unitCost: 30 });
    prisma.salesReturn.create.mockResolvedValue({
      id: 'return-1',
      code: 'SRET-1',
      items: [],
    });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    receiveFinishedGood.mockResolvedValue({});

    const result = await service.createSalesReturn(
      'so-1',
      {
        actorId: 'user-1',
        reason: 'عيب تصنيع',
        items: [{ salesOrderItemId: 'item-1', quantity: 1 }],
      },
      'return-key',
    );

    expect(result).toMatchObject({ id: 'return-1' });
    expect(receiveFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'variant-1',
        warehouseId: 'warehouse-fg',
        quantity: 1,
        reference: 'RETURN-SO-1',
      }),
      'user-1',
      prisma,
    );
    expect(postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        reference: 'SRET-1',
        customerUpdates: undefined,
      }),
      'user-1',
    );
  });

  it('rejects a sales return above the remaining item quantity', async () => {
    const { prisma, receiveFinishedGood, service } = makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      customerId: 'customer-1',
      status: SalesOrderStatus.CONFIRMED,
      vatRate: 0,
      paidAmount: 0,
      customer: { id: 'customer-1' },
      items: [
        {
          id: 'item-1',
          productVariantId: 'variant-1',
          quantity: 2,
          unitPrice: 50,
        },
      ],
    });
    prisma.salesReturnItem.findMany.mockResolvedValue([
      { salesOrderItemId: 'item-1', quantity: 2 },
    ]);

    await expect(
      service.createSalesReturn('so-1', {
        actorId: 'user-1',
        items: [{ salesOrderItemId: 'item-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(receiveFinishedGood).not.toHaveBeenCalled();
  });

  it('calculates VAT on the server and rejects invalid discounts', async () => {
    const { prisma, service } = makeService();
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    prisma.productVariant.findMany.mockResolvedValue([
      {
        id: 'v-1',
        product: { retailPrice: 100, isActive: true, deletedAt: null },
      },
    ]);
    prisma.salesOrder.create.mockResolvedValue({ id: 'so-1' });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await service.createSalesOrder(
      {
        customerId: 'c-1',
        paymentType: PaymentType.CASH,
        discount: 10,
        items: [{ productVariantId: 'v-1', quantity: 2 }],
      },
      'u-1',
    );

    const createCalls = prisma.salesOrder.create.mock.calls as unknown as [
      [{ data: Record<string, unknown> }],
    ];
    const args = createCalls[0][0];
    expect(args.data).toEqual(
      expect.objectContaining({
        subtotal: 200,
        vatRate: 0.14,
        vatAmount: 26.6,
        totalAmount: 216.6,
      }),
    );
    await expect(
      service.createSalesOrder(
        {
          customerId: 'c-1',
          paymentType: PaymentType.CASH,
          discount: 201,
          items: [{ productVariantId: 'v-1', quantity: 2 }],
        },
        'u-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirms through FinishedGoodStock, posts revenue/VAT/COGS in one transaction', async () => {
    const { prisma, bulkIssueFinishedGoods, postJournalEntryInTx, service } =
      makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: PaymentType.CASH,
      subtotal: 190,
      vatAmount: 26.6,
      totalAmount: 216.6,
      customerId: 'c-1',
      customer: { id: 'c-1' },
      items: [{ id: 'item-1', productVariantId: 'v-1', quantity: 2 }],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    // PERF-F02: confirmOrder now calls bulkIssueFinishedGoods instead of per-item issueFinishedGood
    bulkIssueFinishedGoods.mockResolvedValue({
      movements: [
        {
          replayed: false,
          entryCode: 'SLE-x',
          type: 'ISSUE',
          rawMaterialId: '',
          warehouseId: 'wh-fg',
          quantityDelta: -2,
          balanceAfter: 98,
          unitCost: 40,
          totalValue: 80,
          costPerUnitAfter: null,
          createdAt: new Date().toISOString(),
        },
      ],
      totalValue: 80,
    });
    postJournalEntryInTx.mockResolvedValue({
      entryId: 'je-1',
    });

    await service.confirmOrder('so-1', 'u-1', 'confirm-key');

    // PERF-F02: bulk path receives the items list, warehouse, tx, and userId
    expect(bulkIssueFinishedGoods).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          productVariantId: 'v-1',
          quantity: 2,
          reference: 'SO-1',
        }),
      ],
      'wh-fg',
      prisma,
      'u-1',
    );
    expect(postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        reference: 'SO-1',
        metadata: expect.objectContaining({
          source: 'sales.confirm',
          salesOrderId: 'so-1',
          // SAL-3 (أ): بنود COGS تُخزّن في metadata القيد لقراءتها في المرتجع
          cogsLines: [{ variantId: 'v-1', quantity: 2, costPerUnit: 0 }],
        }) as Record<string, unknown>,
        customerUpdates: undefined,
      }),
      'u-1',
    );
    expect(prisma.finishedGood.updateMany).not.toHaveBeenCalled();
    type IdempotencyUpdateCall = [
      {
        where: { key: string };
        data: { response: { status: SalesOrderStatus } };
      },
    ];
    const updateCalls = prisma.idempotencyKey.update.mock
      .calls as unknown as IdempotencyUpdateCall[];
    // SAL-4 (ب): مفتاحان يُحدَّان — المشتق لسند CASH ثم مفتاح التأكيد الخارجي
    const confirmKeyUpdate = updateCalls.find(
      (call) => call[0].where.key === 'confirm-key',
    );
    expect(confirmKeyUpdate).toBeDefined();
    if (!confirmKeyUpdate) throw new Error('confirm-key update missing');
    expect(confirmKeyUpdate[0].data.response.status).toBe(
      SalesOrderStatus.CONFIRMED,
    );
    const cashKeyUpdate = updateCalls.find(
      (call) => call[0].where.key === 'sales-confirm-cash:so-1',
    );
    expect(cashKeyUpdate).toBeDefined();
  });

  it('does not confirm twice when the order status changes concurrently', async () => {
    const { prisma, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: PaymentType.CASH,
      subtotal: 10,
      vatAmount: 1.4,
      totalAmount: 11.4,
      customerId: 'c-1',
      customer: { id: 'c-1' },
      items: [],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await expect(service.confirmOrder('so-1', 'u-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('SalesService — Behavioral Tests (GF-AUDIT-001B)', () => {
  it('handles retry/idempotency: returns stored response for same key and hash', async () => {
    const { prisma, service } = makeService();
    const storedResponse = { id: 'so-1', status: SalesOrderStatus.CONFIRMED };

    // The service computes hash using: { operation: 'sales-order-confirm', orderId: 'so-1', userId: 'u-1' }
    const requestHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          operation: 'sales-order-confirm',
          orderId: 'so-1',
          userId: 'u-1',
        }),
      )
      .digest('hex');

    prisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'retry-key',
      scope: 'sales-order-confirm',
      requestHash: requestHash,
      response: storedResponse,
    });

    const result = await service.confirmOrder('so-1', 'u-1', 'retry-key');
    expect(result).toMatchObject(storedResponse);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('handles concurrency: throws ConflictException when status changed during transaction', async () => {
    const { prisma, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.DRAFT,
      items: [],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 0 }); // Simulate concurrent update
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await expect(service.confirmOrder('so-1', 'u-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('handles rollback: transaction failure reverts all changes (simulated)', async () => {
    const { prisma, bulkIssueFinishedGoods, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.DRAFT,
      items: [{ id: 'item-1', productVariantId: 'v-1', quantity: 2 }],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });

    // Simulate failure during stock issuance (now from bulk path)
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback(prisma);
      },
    );
    bulkIssueFinishedGoods.mockRejectedValue(new Error('Stock issue failed'));

    await expect(service.confirmOrder('so-1', 'u-1')).rejects.toThrow(
      'Stock issue failed',
    );
  });
});

describe('SalesService — Wave 6: COMM-F07 customer credit limit', () => {
  // Helper that wires the standard mock dance for a CREDIT-order confirmOrder
  // path. Caller can override the customer record (esp. creditLimit + balance)
  // to exercise different enforcement scenarios.
  function makeCreditOrderSetup(opts: {
    creditLimit: number | null;
    balance?: number;
    orderTotal?: number;
    bulkIssueSucceeds?: boolean;
  }) {
    const { prisma, bulkIssueFinishedGoods, postJournalEntryInTx, service } =
      makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: PaymentType.CREDIT,
      subtotal: opts.orderTotal ?? 200,
      vatAmount: 0,
      totalAmount: opts.orderTotal ?? 200,
      customerId: 'c-1',
      customer: {
        id: 'c-1',
        // Return creditLimit either as a Decimal-compatible number or null.
        // Prisma Decimal comes back as a special object; in unit tests we
        // use a plain number and Number() coerces it.
        balance: opts.balance ?? 0,
        creditLimit: opts.creditLimit,
        creditTermsDays: 0,
      },
      items: [{ id: 'item-1', productVariantId: 'v-1', quantity: 1 }],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    if (opts.bulkIssueSucceeds !== false) {
      bulkIssueFinishedGoods.mockResolvedValue({
        movements: [],
        totalValue: 50,
      });
    }
    postJournalEntryInTx.mockResolvedValue({ entryId: 'je-1' });
    return { prisma, bulkIssueFinishedGoods, postJournalEntryInTx, service };
  }

  it('rejects a CREDIT order when balance + total > creditLimit', async () => {
    // balance 5000 + order 200 = 5200 > limit 5000 → reject
    const { service, bulkIssueFinishedGoods, postJournalEntryInTx } =
      makeCreditOrderSetup({
        creditLimit: 5000,
        balance: 5000,
        orderTotal: 200,
      });

    await expect(
      service.confirmOrder('so-1', 'u-1', 'confirm-key'),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Failed before status transition — no stock issued, no GL posted.
    expect(bulkIssueFinishedGoods).not.toHaveBeenCalled();
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('allows a CREDIT order when balance + total <= creditLimit', async () => {
    // balance 4000 + order 200 = 4200 ≤ limit 5000 → allow
    const { service, bulkIssueFinishedGoods, postJournalEntryInTx } =
      makeCreditOrderSetup({
        creditLimit: 5000,
        balance: 4000,
        orderTotal: 200,
      });

    await service.confirmOrder('so-1', 'u-1', 'confirm-key');

    expect(bulkIssueFinishedGoods).toHaveBeenCalledTimes(1);
    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
  });

  it('rejects ALL CREDIT orders when creditLimit = 0 (explicit no-credit)', async () => {
    const { service, bulkIssueFinishedGoods } = makeCreditOrderSetup({
      creditLimit: 0,
      balance: 0,
      orderTotal: 100,
    });

    await expect(
      service.confirmOrder('so-1', 'u-1', 'confirm-key'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bulkIssueFinishedGoods).not.toHaveBeenCalled();
  });

  it('allows unlimited CREDIT orders when creditLimit = null (legacy behavior)', async () => {
    // creditLimit null + huge balance + huge order → still allowed
    const { service, bulkIssueFinishedGoods, postJournalEntryInTx } =
      makeCreditOrderSetup({
        creditLimit: null,
        balance: 1_000_000,
        orderTotal: 1_000_000,
      });

    await service.confirmOrder('so-1', 'u-1', 'confirm-key');

    expect(bulkIssueFinishedGoods).toHaveBeenCalledTimes(1);
    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
  });

  it('does NOT run the credit check on CASH orders (paid now)', async () => {
    // Even an absurd creditLimit = 1 with balance 0 and order 200 should not
    // trip on a CASH order — the check only applies to PaymentType.CREDIT.
    const { prisma, bulkIssueFinishedGoods, postJournalEntryInTx, service } =
      makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: PaymentType.CASH,
      subtotal: 200,
      vatAmount: 0,
      totalAmount: 200,
      customerId: 'c-1',
      customer: {
        id: 'c-1',
        balance: 0,
        creditLimit: 1, // absurdly low — would block if check ran on CASH
        creditTermsDays: 0,
      },
      items: [{ id: 'item-1', productVariantId: 'v-1', quantity: 1 }],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    bulkIssueFinishedGoods.mockResolvedValue({ movements: [], totalValue: 50 });
    postJournalEntryInTx.mockResolvedValue({ entryId: 'je-1' });

    await service.confirmOrder('so-1', 'u-1', 'confirm-key');

    expect(bulkIssueFinishedGoods).toHaveBeenCalledTimes(1);
    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
  });

  it('persists creditLimit + creditTermsDays when creating a customer', async () => {
    const { prisma, service } = makeService();
    prisma.customer.create.mockResolvedValue({
      id: 'c-1',
      code: 'CUS-0001',
      name: 'عميل بمحدودية',
      creditLimit: 50000,
      creditTermsDays: 30,
    });

    await service.createCustomer({
      name: 'عميل بمحدودية',
      creditLimit: 50000,
      creditTermsDays: 30,
    });

    const createCalls = prisma.customer.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const call = createCalls[0]?.[0];
    expect(call).toBeDefined();
    if (!call) throw new Error('customer.create was not called');
    expect(call.data).toEqual(
      expect.objectContaining({
        name: 'عميل بمحدودية',
        creditLimit: 50000,
        creditTermsDays: 30,
      }),
    );
  });

  it('updateCustomerCredit: adjusts limit + logs ActivityLog in same tx', async () => {
    const { prisma, service } = makeService();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'c-1',
      creditLimit: 5000,
      creditTermsDays: 0,
      deletedAt: null,
    });
    prisma.customer.update.mockResolvedValue({
      id: 'c-1',
      creditLimit: 15000,
      creditTermsDays: 45,
    });
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    const result = await service.updateCustomerCredit(
      'c-1',
      { creditLimit: 15000, creditTermsDays: 45 },
      'user-gm',
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'c-1',
        creditLimit: 15000,
        creditTermsDays: 45,
      }),
    );
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { creditLimit: 15000, creditTermsDays: 45 },
    });
    // ActivityLog carries the before/after snapshot for audit trail.
    expect(prisma.activityLog.create).toHaveBeenCalledTimes(1);
    type ActivityLogCreateCall = [{ data: Record<string, unknown> }];
    const logCall = prisma.activityLog.create.mock
      .calls[0] as unknown as ActivityLogCreateCall;
    const data = logCall[0].data;
    expect(data.action).toBe('CUSTOMER_CREDIT_LIMIT_UPDATED');
    expect(data.module).toBe('SALES');
    expect(data.userId).toBe('user-gm');
    const details = data.details as Record<string, unknown>;
    expect(details.entityType).toBe('Customer');
    expect(details.entityId).toBe('c-1');
    const previous = details.previous as Record<string, unknown>;
    expect(previous.creditTermsDays).toBe(0);
    const next = details.next as Record<string, unknown>;
    expect(next.creditTermsDays).toBe(45);
  });

  it('updateCustomerCredit: setting creditLimit=null removes the limit (unlimited)', async () => {
    const { prisma, service } = makeService();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'c-1',
      creditLimit: 5000,
      creditTermsDays: 0,
      deletedAt: null,
    });
    prisma.customer.update.mockResolvedValue({
      id: 'c-1',
      creditLimit: null,
      creditTermsDays: 0,
    });
    prisma.activityLog.create.mockResolvedValue({ id: 'log-2' });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await service.updateCustomerCredit('c-1', { creditLimit: null }, 'user-gm');

    // Prisma should see `null` as "store NULL".
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { creditLimit: null },
    });
  });

  it('updateCustomerCredit: rejects when customer is soft-deleted', async () => {
    const { prisma, service } = makeService();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'c-1',
      creditLimit: null,
      creditTermsDays: 0,
      deletedAt: new Date('2026-01-01'),
    });

    await expect(
      service.updateCustomerCredit('c-1', { creditLimit: 10000 }, 'user-gm'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('updateCustomerCredit: 404 when customer does not exist', async () => {
    const { prisma, service } = makeService();
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(
      service.updateCustomerCredit(
        'c-missing',
        { creditLimit: 10000 },
        'user-gm',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('updateCustomer: rejects when customer is soft-deleted', async () => {
    const { prisma, service } = makeService();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'c-1',
      name: 'قديم',
      deletedAt: new Date('2026-01-01'),
    });

    await expect(
      service.updateCustomer('c-1', { name: 'جديد' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});

// ===== GF-IMP-W2 — عدالة تجارية المبيعات (SAL-2 / SAL-3 / SAL-4) =====

describe('SalesService — GF-IMP-W2: SAL-2 سجلات التدقيق', () => {
  function setupConfirm(opts?: { paymentType?: PaymentType }) {
    const { prisma, bulkIssueFinishedGoods, postJournalEntryInTx, service } =
      makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: opts?.paymentType ?? PaymentType.CASH,
      subtotal: 190,
      vatAmount: 26.6,
      totalAmount: 216.6,
      customerId: 'c-1',
      userId: 'creator-1',
      customer: { id: 'c-1' },
      items: [{ id: 'item-1', productVariantId: 'v-1', quantity: 2 }],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    bulkIssueFinishedGoods.mockResolvedValue({
      movements: [],
      totalValue: 80,
    });
    postJournalEntryInTx.mockResolvedValue({ entryId: 'je-1' });
    return { prisma, service };
  }

  it('SAL-2: يكتب ActivityLog SALES_ORDER_CONFIRMED بمعرف الأمر والمجاميع داخل المعاملة', async () => {
    const { prisma, service } = setupConfirm();

    await service.confirmOrder('so-1', 'u-1', 'confirm-key');

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u-1',
        action: 'SALES_ORDER_CONFIRMED',
        module: 'SALES',
        details: expect.objectContaining({
          salesOrderId: 'so-1',
          totalAmount: 216.6,
          vatAmount: 26.6,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    });
  });

  it('SAL-2: يكتب ActivityLog SALES_ORDER_CANCELLED بمعرف الأمر والإجمالي', async () => {
    const { prisma, service } = makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.DRAFT,
      code: 'SO-1',
      totalAmount: 216.6,
      paidAmount: 0,
    });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CANCELLED,
      items: [],
    });

    await service.cancelOrder('so-1', 'user-1');

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'SALES_ORDER_CANCELLED',
        module: 'SALES',
        details: expect.objectContaining({
          salesOrderId: 'so-1',
          totalAmount: 216.6,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    });
  });

  it('SAL-2: يكتب ActivityLog RETURN_CREATED بمعرف المرتجع وrefundAmount', async () => {
    const { prisma, service } = makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      customerId: 'customer-1',
      status: SalesOrderStatus.CONFIRMED,
      vatRate: 0.14,
      paidAmount: 0,
      customer: { id: 'customer-1' },
      items: [
        {
          id: 'item-1',
          productVariantId: 'variant-1',
          quantity: 2,
          unitPrice: 50,
        },
      ],
    });
    prisma.salesReturnItem.findMany.mockResolvedValue([]);
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'warehouse-fg' });
    prisma.finishedGoodStock.findUnique.mockResolvedValue({ unitCost: 30 });
    prisma.salesReturn.create.mockResolvedValue({
      id: 'return-1',
      code: 'SRET-1',
      items: [],
    });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.createSalesReturn('so-1', {
      actorId: 'user-1',
      items: [{ salesOrderItemId: 'item-1', quantity: 1 }],
    });

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'RETURN_CREATED',
        module: 'SALES',
        details: expect.objectContaining({
          salesReturnId: 'return-1',
          salesOrderId: 'so-1',
          refundAmount: 57,
          vatAmount: 7,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    });
  });
});

describe('SalesService — GF-IMP-W2: SAL-3 حسابات المرتجع', () => {
  function setupReturn(orderOverrides: Record<string, unknown>) {
    const { prisma, receiveFinishedGood, postJournalEntryInTx, service } =
      makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      customerId: 'customer-1',
      status: SalesOrderStatus.CONFIRMED,
      vatRate: 0.14,
      paidAmount: 0,
      customer: { id: 'customer-1' },
      items: [
        {
          id: 'item-1',
          productVariantId: 'variant-1',
          quantity: 2,
          unitPrice: 50,
        },
      ],
      ...orderOverrides,
    });
    prisma.salesReturnItem.findMany.mockResolvedValue([]);
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'warehouse-fg' });
    prisma.finishedGoodStock.findUnique.mockResolvedValue({ unitCost: 30 });
    prisma.salesReturn.create.mockResolvedValue({
      id: 'return-1',
      code: 'SRET-1',
      items: [],
    });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    receiveFinishedGood.mockResolvedValue({});
    postJournalEntryInTx.mockResolvedValue({ entryId: 'je-1' });
    return { prisma, receiveFinishedGood, postJournalEntryInTx, service };
  }

  it('SAL-3 (ب): مرتجع لأمر عليه خصم يعيد الضريبة بنسبة الخصم نفسها', async () => {
    // subtotal 100، خصم 20 → الصافي 80% من البضاعة؛ إرجاع بضاعة بقيمة 50
    // → وعاء الضريبة 40 → VAT = 5.6 (لا 7 كما كان على القيمة الإجمالية).
    const { prisma, postJournalEntryInTx, service } = setupReturn({
      subtotal: 100,
      discount: 20,
    });

    await service.createSalesReturn('so-1', {
      actorId: 'user-1',
      items: [{ salesOrderItemId: 'item-1', quantity: 1 }],
    });

    expect(postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        lines: expect.arrayContaining([
          expect.objectContaining({
            debitAccountId: CHART_OF_ACCOUNTS.VAT_PAYABLE,
            amount: 5.6,
          }),
        ]) as Array<Record<string, unknown>>,
      }),
      'user-1',
    );
    // refundAmount = merchandise 50 + vat 5.6 = 55.6
    expect(prisma.salesReturn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 55.6,
        }) as Record<string, unknown>,
      }),
    );
  });

  it('SAL-3 (أ): مرتجع بعد نفاد المخزون يستخدم تكلفة metadata لا صفرًا', async () => {
    const { prisma, receiveFinishedGood, postJournalEntryInTx, service } =
      setupReturn({ vatRate: 0 });
    // قيد التأكيد خزّن تكلفة 40 للـ variant وقت البيع
    prisma.journalEntry.findUnique.mockResolvedValue({
      metadata: {
        source: 'sales.confirm',
        salesOrderId: 'so-1',
        cogsLines: [{ variantId: 'variant-1', quantity: 2, costPerUnit: 40 }],
      },
    });
    // المخزون نفد تمامًا (لا صف رصيد أصلًا) — التكلفة الحالية غير متاحة
    prisma.finishedGoodStock.findUnique.mockResolvedValue(null);

    await service.createSalesReturn('so-1', {
      actorId: 'user-1',
      items: [{ salesOrderItemId: 'item-1', quantity: 1 }],
    });

    expect(receiveFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({ unitCost: 40, quantity: 1 }),
      'user-1',
      prisma,
    );
    expect(postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        lines: expect.arrayContaining([
          expect.objectContaining({
            debitAccountId: CHART_OF_ACCOUNTS.INVENTORY,
            creditAccountId: CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
            amount: 40,
          }),
        ]) as Array<Record<string, unknown>>,
      }),
      'user-1',
    );
  });

  it('SAL-3 (أ): fallback عند غياب metadata — التكلفة الحالية لا صفر', async () => {
    const { prisma, receiveFinishedGood, service } = setupReturn({
      vatRate: 0,
    });
    // لا قيد تأكيد قديم بـ cogsLines (أمر قبل الإصلاح) + رصيد حالي 30
    prisma.journalEntry.findUnique.mockResolvedValue(null);

    await service.createSalesReturn('so-1', {
      actorId: 'user-1',
      items: [{ salesOrderItemId: 'item-1', quantity: 1 }],
    });

    expect(receiveFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({ unitCost: 30 }),
      'user-1',
      prisma,
    );
  });
});

describe('SalesService — GF-IMP-W2: SAL-4 فصل الواجبات وسند البيع الفوري', () => {
  it('SAL-4 (أ): منشئ الأمر لا يستطيع اعتماده (409)', async () => {
    const { prisma, bulkIssueFinishedGoods, postJournalEntryInTx, service } =
      makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: PaymentType.CREDIT,
      totalAmount: 100,
      customerId: 'c-1',
      userId: 'u-1',
      customer: { id: 'c-1' },
      items: [{ id: 'item-1', productVariantId: 'v-1', quantity: 1 }],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await expect(service.confirmOrder('so-1', 'u-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    // فشل قبل أي أثر: لا قلب حالة، لا صرف مخزون، لا قيد
    expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(bulkIssueFinishedGoods).not.toHaveBeenCalled();
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('SAL-4 (أ): مستخدم آخر غير المنشئ يعتمد الأمر بنجاح', async () => {
    const { prisma, bulkIssueFinishedGoods, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: PaymentType.CREDIT,
      subtotal: 100,
      totalAmount: 100,
      customerId: 'c-1',
      userId: 'creator-1',
      customer: { id: 'c-1', balance: 0, creditLimit: null },
      items: [{ id: 'item-1', productVariantId: 'v-1', quantity: 1 }],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    bulkIssueFinishedGoods.mockResolvedValue({ movements: [], totalValue: 0 });

    await expect(
      service.confirmOrder('so-1', 'approver-1', 'confirm-key'),
    ).resolves.toMatchObject({ id: 'so-1' });
  });

  it('SAL-4 (ب): تأكيد أمر CASH ينشئ CustomerPayment بالمبلغ الإجمالي ومفتاحًا مشتقًا ثابتًا', async () => {
    const { prisma, bulkIssueFinishedGoods, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    bulkIssueFinishedGoods.mockResolvedValue({ movements: [], totalValue: 80 });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: PaymentType.CASH,
      subtotal: 190,
      vatAmount: 26.6,
      totalAmount: 216.6,
      customerId: 'c-1',
      userId: 'creator-1',
      customer: { id: 'c-1' },
      items: [{ id: 'item-1', productVariantId: 'v-1', quantity: 2 }],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await service.confirmOrder('so-1', 'u-2', 'confirm-key');

    expect(prisma.customerPayment.create).toHaveBeenCalledWith({
      data: {
        customerId: 'c-1',
        salesOrderId: 'so-1',
        amount: 216.6,
        notes: expect.stringContaining('سند قبض') as string,
      },
    });
    expect(prisma.idempotencyKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'sales-confirm-cash:so-1',
        scope: 'sales-confirm-cash',
      }) as Record<string, unknown>,
      select: { id: true },
    });
  });

  it('SAL-4 (ب): تأكيد أمر CREDIT لا ينشئ سند قبض', async () => {
    const { prisma, bulkIssueFinishedGoods, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: PaymentType.CREDIT,
      subtotal: 100,
      totalAmount: 100,
      customerId: 'c-1',
      userId: 'creator-1',
      customer: { id: 'c-1', balance: 0, creditLimit: null },
      items: [],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    bulkIssueFinishedGoods.mockResolvedValue({ movements: [], totalValue: 0 });

    await service.confirmOrder('so-1', 'u-2', 'confirm-key');

    expect(prisma.customerPayment.create).not.toHaveBeenCalled();
  });
});
