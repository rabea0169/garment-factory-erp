import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalesOrderStatus, ShipmentStatus } from '@prisma/client';
import { ShippingService } from './shipping.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';

import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('ShippingService — الشحنات (GF-0003)', () => {
  let service: ShippingService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let financial: { postJournalEntryInTx: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    financial = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({
        entryId: 'je-1',
        entryCode: 'JE-1',
        totalDebit: 0,
        totalCredit: 0,
        linesCount: 0,
        createdAt: new Date(),
      }),
    };
    service = new ShippingService(
      prisma as unknown as PrismaService,
      financial as unknown as FinancialPostingService,
    );
  });

  it('يجلب الشحنات مع أمر البيع والعميل', async () => {
    const shipments = [{ id: 'sh-1', salesOrder: { customer: {} } }];
    prisma.shipment.findMany.mockResolvedValue(shipments);
    prisma.shipment.count.mockResolvedValue(shipments.length);

    const result = await service.getShipments();

    expect(result.data).toEqual(shipments);
    expect(prisma.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { salesOrder: { include: { customer: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('ينشئ شحنة بكود SHP-* ويحفظ بياناتها (حالة PREPARING الافتراضية من المخطط)', async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
      code: 'SO-1',
    });
    prisma.shipment.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'sh-2', ...data }),
    );

    const result = await service.createShipment(
      {
        salesOrderId: 'so-1',
        shippingCost: 75,
        trackingNumber: 'TRK-99',
      },
      'actor-1',
    );

    if (!('code' in result)) throw new Error('Expected created shipment');
    expect(result.code).toMatch(/^SHP-\d{8}-[0-9A-F]{8}$/);
    expect(prisma.shipment.create).toHaveBeenCalledWith({
      data: {
        code: expect.stringMatching(/^SHP-\d{8}-[0-9A-F]{8}$/) as string,
        salesOrderId: 'so-1',
        shippingCompanyId: undefined,
        shippingCost: 75,
        trackingNumber: 'TRK-99',
        notes: undefined,
        idempotencyKeyId: undefined,
      },
    });
    // COMM-F11: no treasuryId + no accrueToPayable → no GL posting
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
  });

  // COMM-F11 / ACC-F03: GL posting for shipping cost. Three modes (cash, accrual, none).
  describe('COMM-F11 — ترحيل قيد تكلفة الشحن', () => {
    beforeEach(() => {
      prisma.salesOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        status: SalesOrderStatus.CONFIRMED,
        code: 'SO-1',
      });
      prisma.shipment.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'sh-2', ...data, code: 'SHP-1' }),
      );
      prisma.treasury.findUnique.mockResolvedValue({
        id: 't-1',
        isActive: true,
      });
      financial.postJournalEntryInTx.mockResolvedValue({
        entryId: 'je-1',
        entryCode: 'JE-1',
        totalDebit: 75,
        totalCredit: 75,
        linesCount: 1,
        createdAt: new Date(),
      });
    });

    it('(a) treasuryId + shippingCost > 0 → Dr Shipping Expense / Cr Cash + treasury delta', async () => {
      await service.createShipment(
        {
          salesOrderId: 'so-1',
          shippingCost: 75,
          treasuryId: 't-1',
        },
        'actor-1',
      );

      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const call = financial.postJournalEntryInTx.mock.calls[0] as [
        unknown,
        {
          postingKey: string;
          lines: { amount: number }[];
          treasuryUpdates?: { treasuryId: string; delta: number }[];
        },
        unknown,
      ];
      expect(call[1].postingKey).toBe('shipping-cost-cash:sh-2');
      expect(call[1].lines[0].amount).toBe(75);
      expect(call[1].treasuryUpdates).toEqual([
        { treasuryId: 't-1', delta: -75 },
      ]);
    });

    it('(b) accrueToPayable=true + shippingCost > 0 → Dr Shipping Expense / Cr AP (no treasury delta)', async () => {
      await service.createShipment(
        {
          salesOrderId: 'so-1',
          shippingCost: 75,
          shippingCompanyId: 'shipco-1',
          accrueToPayable: true,
        },
        'actor-1',
      );

      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const call = financial.postJournalEntryInTx.mock.calls[0] as [
        unknown,
        {
          postingKey: string;
          lines: { amount: number }[];
          treasuryUpdates?: { treasuryId: string; delta: number }[];
        },
        unknown,
      ];
      expect(call[1].postingKey).toBe('shipping-cost-accrual:sh-2');
      expect(call[1].lines[0].amount).toBe(75);
      expect(call[1].treasuryUpdates ?? []).toEqual([]);
    });

    it('(c) no treasuryId, no accrueToPayable → no GL posting', async () => {
      await service.createShipment(
        { salesOrderId: 'so-1', shippingCost: 75 },
        'actor-1',
      );
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('يرفض treasuryId + accrueToPayable معًا (400)', async () => {
      await expect(
        service.createShipment(
          {
            salesOrderId: 'so-1',
            shippingCost: 75,
            treasuryId: 't-1',
            accrueToPayable: true,
          },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('يرفض treasuryId غير نشط (404)', async () => {
      prisma.treasury.findUnique.mockResolvedValue({
        id: 't-1',
        isActive: false,
      });
      await expect(
        service.createShipment(
          {
            salesOrderId: 'so-1',
            shippingCost: 75,
            treasuryId: 't-1',
          },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('يمنع تكرار إنشاء الشحنة عند إعادة استخدام Idempotency-Key', async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.shipment.create.mockResolvedValue({
      id: 'sh-3',
      salesOrderId: 'so-1',
      shippingCost: 75,
    });

    await service.createShipment(
      { salesOrderId: 'so-1', shippingCost: 75 },
      'actor-1',
      'shipment-key-1',
    );

    expect(prisma.idempotencyKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: 'shipment-key-1',
          scope: 'shipping.shipment.create',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
    expect(prisma.idempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'shipment-key-1' } }) as Record<
        string,
        unknown
      >,
    );
  });

  it('يرفض إنشاء شحنة لأمر غير مؤكد', async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.DRAFT,
    });

    await expect(
      service.createShipment({ salesOrderId: 'so-1' }, 'actor-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });

  it('يسمح بانتقال PREPARING إلى SHIPPED دون تغيير المخزون (ADR-0017)', async () => {
    prisma.shipment.findUnique
      .mockResolvedValueOnce({
        id: 'sh-1',
        status: ShipmentStatus.PREPARING,
        code: 'SHP-1',
        salesOrder: {
          items: [{ id: 'soi-1', productVariantId: 'v-1', quantity: 2 }],
        },
      })
      .mockResolvedValue({
        id: 'sh-1',
        status: ShipmentStatus.SHIPPED,
      });
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.shipment.findUnique.mockResolvedValue({
      id: 'sh-1',
      status: ShipmentStatus.SHIPPED,
    });
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });

    await service.updateShipmentStatus(
      'sh-1',
      ShipmentStatus.SHIPPED,
      'actor-1',
    );

    const calls = prisma.shipment.updateMany.mock.calls as unknown as Array<
      [
        {
          where: { id: string; status: ShipmentStatus };
          data: { status: ShipmentStatus; shippedAt?: Date };
        },
      ]
    >;
    const request = calls[0][0];
    expect(request.where).toEqual({
      id: 'sh-1',
      status: ShipmentStatus.PREPARING,
    });
    expect(request.data.status).toBe(ShipmentStatus.SHIPPED);
    expect(request.data.shippedAt).toBeInstanceOf(Date);
    // تأكيد عدم استدعاء أي عمليات مخزنية أو مالية
    expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it('يرفض انتقالًا غير منطقي في حالة الشحنة', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      id: 'sh-1',
      status: ShipmentStatus.PREPARING,
    });

    await expect(
      service.updateShipmentStatus('sh-1', ShipmentStatus.DELIVERED, 'actor-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('يشترط إثبات التسليم ويسجل الفاعل عند DELIVERED', async () => {
    prisma.shipment.findUnique
      .mockResolvedValueOnce({
        id: 'sh-1',
        status: ShipmentStatus.IN_TRANSIT,
      })
      .mockResolvedValueOnce({
        id: 'sh-1',
        status: ShipmentStatus.IN_TRANSIT,
      })
      .mockResolvedValue({
        id: 'sh-1',
        status: ShipmentStatus.DELIVERED,
        proofOfDelivery: 'POD-1',
        deliveredById: 'actor-1',
      });

    await expect(
      service.updateShipmentStatus('sh-1', ShipmentStatus.DELIVERED, 'actor-1'),
    ).rejects.toThrow('إثبات التسليم مطلوب');

    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });

    const delivered = await service.updateShipmentStatus(
      'sh-1',
      ShipmentStatus.DELIVERED,
      'actor-1',
      'POD-1',
    );

    expect(delivered).toMatchObject({
      status: ShipmentStatus.DELIVERED,
      proofOfDelivery: 'POD-1',
      deliveredById: 'actor-1',
    });
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'actor-1',
        action: 'SHIPMENT_STATUS_CHANGED',
      }) as Record<string, unknown>,
    });
  });
});
