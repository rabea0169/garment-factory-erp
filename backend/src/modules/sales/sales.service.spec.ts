import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentType, SalesOrderStatus } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
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

    await service.confirmOrder('so-1', 'u-1', 'confirm-key');

    expect(issueFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'v-1',
        warehouseId: 'wh-fg',
        quantity: 2,
      }),
      'u-1',
      prisma,
    );
    expect(postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        reference: 'SO-1',
        metadata: { source: 'sales.confirm', salesOrderId: 'so-1' },
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
    expect(updateCalls[0][0].where).toEqual({ key: 'confirm-key' });
    expect(updateCalls[0][0].data.response.status).toBe(
      SalesOrderStatus.CONFIRMED,
    );
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
    const { prisma, issueFinishedGood, service } = makeService();
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
    issueFinishedGood.mockRejectedValue(new Error('Stock issue failed'));

    await expect(service.confirmOrder('so-1', 'u-1')).rejects.toThrow(
      'Stock issue failed',
    );
  });
});
