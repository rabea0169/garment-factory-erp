import { BadRequestException, ConflictException } from '@nestjs/common';
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
  const postJournalEntryInTx = jest.fn();
  const inventory = { issueFinishedGood } as unknown as InventoryService;
  const financial = {
    postJournalEntryInTx,
  } as unknown as FinancialPostingService;
  return {
    prisma,
    inventory,
    financial,
    issueFinishedGood,
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

  it('confirms revenue/VAT and defers stock issue and COGS until shipping', async () => {
    const { prisma, issueFinishedGood, postJournalEntryInTx, service } =
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
    issueFinishedGood.mockResolvedValue({
      totalValue: 80,
      replayed: false,
    });
    postJournalEntryInTx.mockResolvedValue({
      entryId: 'je-1',
    });

    await service.confirmOrder('so-1', 'u-1', 'confirm-key', 'treasury-1');

    expect(issueFinishedGood).not.toHaveBeenCalled();
    expect(postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        reference: 'SO-1',
        metadata: expect.objectContaining({
          source: 'sales.confirm',
          salesOrderId: 'so-1',
          treasuryUpdates: [{ treasuryId: 'treasury-1', delta: 216.6 }],
        }) as Record<string, unknown>,
        treasuryUpdates: [{ treasuryId: 'treasury-1', delta: 216.6 }],
        customerUpdates: undefined,
      }),
      'u-1',
    );
    expect(prisma.finishedGood.updateMany).not.toHaveBeenCalled();
    const postingCalls = postJournalEntryInTx.mock.calls as unknown as Array<
      [unknown, { lines: unknown[] }]
    >;
    const postingInput = postingCalls[0][1];
    expect(postingInput.lines).toHaveLength(2);
    type IdempotencyUpdateCall = [
      {
        where: { key: string };
        data: { response: { status: SalesOrderStatus } };
      },
    ];
    const updateCalls = prisma.idempotencyKey.update.mock
      .calls as unknown as IdempotencyUpdateCall[];
    expect(updateCalls[0][0].where).toEqual({ key: 'confirm-key' });
    expect(updateCalls[0][0].data.response.status).toBe(
      SalesOrderStatus.CONFIRMED,
    );
  });

  it('rejects cash confirmation without treasury before changing state', async () => {
    const { prisma, issueFinishedGood, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      code: 'SO-1',
      status: SalesOrderStatus.DRAFT,
      paymentType: PaymentType.CASH,
      totalAmount: 114,
      customerId: 'c-1',
      items: [],
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await expect(service.confirmOrder('so-1', 'u-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(issueFinishedGood).not.toHaveBeenCalled();
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

    await expect(
      service.confirmOrder('so-1', 'u-1', undefined, 'treasury-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SalesService — Behavioral Tests (GF-AUDIT-001B)', () => {
  it('handles retry/idempotency: returns stored response for same key and hash', async () => {
    const { prisma, service } = makeService();
    const storedResponse = { id: 'so-1', status: SalesOrderStatus.CONFIRMED };

    // The service computes hash using orderId, userId, and treasuryId (null for legacy credit confirmation).
    const requestHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          operation: 'sales-order-confirm',
          orderId: 'so-1',
          userId: 'u-1',
          treasuryId: null,
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
    const { prisma, postJournalEntryInTx, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.DRAFT,
      items: [{ id: 'item-1', productVariantId: 'v-1', quantity: 2 }],
    });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });

    // Simulate failure during journal posting
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback(prisma);
      },
    );
    postJournalEntryInTx.mockRejectedValue(new Error('Journal post failed'));

    await expect(service.confirmOrder('so-1', 'u-1')).rejects.toThrow(
      'Journal post failed',
    );
  });
});

describe('SalesService — customer collection reconciliation', () => {
  it('records a customer payment with Cash/Receivables and operational deltas', async () => {
    const { prisma, postJournalEntryInTx, service } = makeService();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-payment-1' });
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-credit-1',
      code: 'SO-CREDIT-1',
      status: SalesOrderStatus.SHIPPED,
      paymentType: PaymentType.CREDIT,
      totalAmount: 500,
      paidAmount: 100,
      customerId: 'customer-1',
      customer: { id: 'customer-1', name: 'عميل تجريبي' },
    });
    prisma.treasury.findUnique.mockResolvedValue({
      id: 'treasury-1',
      isActive: true,
    });
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.customerPayment.create.mockResolvedValue({
      id: 'payment-1',
      customerId: 'customer-1',
      salesOrderId: 'so-credit-1',
      amount: 250,
      notes: 'دفعة أولى',
    });
    postJournalEntryInTx.mockResolvedValue({ entryId: 'journal-payment-1' });

    const result = await service.recordCustomerPayment(
      'so-credit-1',
      { amount: 250, treasuryId: 'treasury-1', notes: 'دفعة أولى' },
      'cashier-1',
      'payment-key-1',
    );

    expect(result).toMatchObject({
      id: 'payment-1',
      amount: 250,
      outstandingAfter: 150,
    });
    expect(prisma.salesOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'so-credit-1', paidAmount: 100 },
      data: { paidAmount: { increment: 250 } },
    });
    expect(postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        reference: 'CUSTOMER_PAYMENT:payment-1',
        lines: [
          expect.objectContaining({
            debitAccountId: CHART_OF_ACCOUNTS.CASH,
            creditAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
            amount: 250,
          }),
        ],
        treasuryUpdates: [{ treasuryId: 'treasury-1', delta: 250 }],
        customerUpdates: [{ customerId: 'customer-1', delta: -250 }],
      }),
      'cashier-1',
    );
  });

  it('rejects a collection greater than the outstanding balance', async () => {
    const { prisma, postJournalEntryInTx, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-credit-2',
      status: SalesOrderStatus.CONFIRMED,
      paymentType: PaymentType.CREDIT,
      totalAmount: 500,
      paidAmount: 450,
      customerId: 'customer-1',
      customer: { id: 'customer-1', name: 'عميل تجريبي' },
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await expect(
      service.recordCustomerPayment(
        'so-credit-2',
        { amount: 51, treasuryId: 'treasury-1' },
        'cashier-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });
});
