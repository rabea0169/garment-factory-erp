import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesOrderStatus, ShipmentStatus } from '@prisma/client';
import { ShippingService } from './shipping.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';

import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { computeRequestHash } from '../../core/common/idempotency.util';

describe('ShippingService — الشحنات (GF-0003)', () => {
  let service: ShippingService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let financial: {
    postJournalEntryInTx: jest.Mock;
    reverseJournalEntryInTx: jest.Mock;
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    // SHP-3 (GF-IMP-W2): salesReturn.findFirst غير موجودة في prisma-mock
    // المشترك — توسعة محلية (نمط W1-C) بدل تعديل مساعد مشترك بين الوكلاء.
    (prisma.salesReturn as unknown as { findFirst: jest.Mock }).findFirst =
      jest.fn();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    // SHP-1: افتراضات المسار السعيد داخل المعاملة — لا شحنة نشطة قائمة
    // لنفس أمر البيع، وقلب الحالة إلى SHIPPED يمسّ صفًا واحدًا.
    prisma.shipment.count.mockResolvedValue(0);
    prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
    financial = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({
        entryId: 'je-1',
        entryCode: 'JE-1',
        totalDebit: 0,
        totalCredit: 0,
        linesCount: 0,
        createdAt: new Date(),
      }),
      // SHP-3 (أ): عكس داخل معاملة خارجية (InTx)
      reverseJournalEntryInTx: jest.fn().mockResolvedValue({
        entryId: 'je-rev-1',
        entryCode: 'JE-REV-1',
        totalDebit: 0,
        totalCredit: 0,
        linesCount: 0,
        createdAt: new Date(),
        reversedEntryId: 'je-cost-1',
        reversedEntryCode: 'JE-COST-1',
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
    expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  // SHP-1 (P0): أمر البيع يصبح SHIPPED عند الشحن + منع الشحن المزدوج.
  describe('SHP-1 — قلب حالة أمر البيع ومنع الشحن المزدوج', () => {
    beforeEach(() => {
      prisma.salesOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        status: SalesOrderStatus.CONFIRMED,
        code: 'SO-1',
      });
      prisma.shipment.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'sh-2', ...data, code: 'SHP-1' }),
      );
    });

    it('يقلب حالة أمر البيع إلى SHIPPED داخل نفس معاملة إنشاء الشحنة', async () => {
      await service.createShipment(
        { salesOrderId: 'so-1', shippingCost: 0 },
        'actor-1',
      );

      expect(prisma.salesOrder.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.salesOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'so-1',
          status: SalesOrderStatus.CONFIRMED,
        },
        data: { status: SalesOrderStatus.SHIPPED },
      });
      // القفل يحدث قبل الإنشاء: SELECT ... FOR UPDATE على sales_orders
      const lockSqls = (
        prisma.$queryRaw.mock.calls as unknown as [Prisma.Sql][]
      ).map((call) => call[0]);
      const salesOrderLock = lockSqls.find(
        (sql) =>
          sql.sql.includes('FROM sales_orders') &&
          sql.sql.includes('FOR UPDATE'),
      );
      if (!salesOrderLock) {
        throw new Error('Expected a sales_orders FOR UPDATE lock query');
      }
      expect(salesOrderLock.values).toEqual(['so-1']);
      const lockInvocationOrder =
        prisma.$queryRaw.mock.invocationCallOrder[
          lockSqls.indexOf(salesOrderLock)
        ];
      const createInvocationOrder =
        prisma.shipment.create.mock.invocationCallOrder[0];
      expect(lockInvocationOrder).toBeLessThan(createInvocationOrder);
    });

    it('يرفض إنشاء شحنة ثانية نشطة لنفس أمر البيع (409)', async () => {
      prisma.shipment.count.mockResolvedValue(1);

      await expect(
        service.createShipment(
          { salesOrderId: 'so-1', shippingCost: 0 },
          'actor-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.shipment.count).toHaveBeenCalledWith({
        where: {
          salesOrderId: 'so-1',
          status: {
            in: [ShipmentStatus.PREPARING, ShipmentStatus.IN_TRANSIT],
          },
        },
      });
      expect(prisma.shipment.create).not.toHaveBeenCalled();
      expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
    });

    it('يرفض إنشاء شحنة إذا لم يعد الأمر مؤكدًا عند إعادة قراءته داخل المعاملة (409)', async () => {
      // الفحص الأولي (خارج المعاملة) يرى CONFIRMED، ثم تتغير الحالة قبل
      // القفل — إعادة القراءة داخل المعاملة هي مصدر الحقيقة.
      prisma.salesOrder.findUnique
        .mockResolvedValueOnce({
          id: 'so-1',
          status: SalesOrderStatus.CONFIRMED,
          code: 'SO-1',
        })
        .mockResolvedValue({
          id: 'so-1',
          status: SalesOrderStatus.CANCELLED,
          code: 'SO-1',
        });

      await expect(
        service.createShipment(
          { salesOrderId: 'so-1', shippingCost: 0 },
          'actor-1',
        ),
      ).rejects.toThrow('أمر البيع لم يعد مؤكدًا');
      expect(prisma.shipment.create).not.toHaveBeenCalled();
      expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
    });

    it('يرفض الالتزام إذا قلّب updateMany صفر صفوف (تغيّر متزامن بعد القفل)', async () => {
      prisma.salesOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.createShipment(
          { salesOrderId: 'so-1', shippingCost: 0 },
          'actor-1',
        ),
      ).rejects.toThrow('أمر البيع لم يعد مؤكدًا');
      expect(prisma.shipment.create).toHaveBeenCalledTimes(1);
    });
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

  // SHP-3 (P1 — GF-IMP-W2): حالة RETURNED تعكس آثار التسليم — لا تُقبل
  // إلا بوجود مرتجع بيع مقترن بأمر البيع.
  describe('SHP-3 — بوابة RETURNED تتطلب مرتجع بيع مقترنًا', () => {
    const salesReturnMock = () =>
      prisma.salesReturn as unknown as { findFirst: jest.Mock };

    it('IN_TRANSIT → RETURNED بلا مرتجع بيع → 409 برسالة عربية', async () => {
      prisma.shipment.findUnique
        .mockResolvedValueOnce({
          id: 'sh-1',
          status: ShipmentStatus.IN_TRANSIT,
          salesOrderId: 'so-1',
          salesOrder: { items: [] },
        })
        .mockResolvedValue({ id: 'sh-1', status: ShipmentStatus.RETURNED });
      salesReturnMock().findFirst.mockResolvedValue(null);

      await expect(
        service.updateShipmentStatus(
          'sh-1',
          ShipmentStatus.RETURNED,
          'actor-1',
        ),
      ).rejects.toThrow('أنشئ مرتجع البيع');
      expect(salesReturnMock().findFirst).toHaveBeenCalledWith({
        where: { salesOrderId: 'so-1' },
        select: { id: true },
      });
      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('IN_TRANSIT → RETURNED مع مرتجع بيع مقترن → ينجح ويسجل التدقيق', async () => {
      prisma.shipment.findUnique
        .mockResolvedValueOnce({
          id: 'sh-1',
          status: ShipmentStatus.IN_TRANSIT,
          salesOrderId: 'so-1',
          salesOrder: { items: [] },
        })
        .mockResolvedValue({ id: 'sh-1', status: ShipmentStatus.RETURNED });
      salesReturnMock().findFirst.mockResolvedValue({ id: 'return-1' });
      prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
      prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });

      const result = await service.updateShipmentStatus(
        'sh-1',
        ShipmentStatus.RETURNED,
        'actor-1',
      );

      expect(result).toMatchObject({
        id: 'sh-1',
        status: ShipmentStatus.RETURNED,
      });
      expect(prisma.shipment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sh-1', status: ShipmentStatus.IN_TRANSIT },
          data: expect.objectContaining({
            status: ShipmentStatus.RETURNED,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      );
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'actor-1',
          action: 'SHIPMENT_STATUS_CHANGED',
          details: expect.objectContaining({
            to: ShipmentStatus.RETURNED,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      });
    });

    it('DELIVERED → RETURNED بلا مرتجع → 409 (نفس البوابة)', async () => {
      prisma.shipment.findUnique
        .mockResolvedValueOnce({
          id: 'sh-1',
          status: ShipmentStatus.DELIVERED,
          salesOrderId: 'so-1',
          salesOrder: { items: [] },
        })
        .mockResolvedValue({ id: 'sh-1', status: ShipmentStatus.RETURNED });
      salesReturnMock().findFirst.mockResolvedValue(null);

      await expect(
        service.updateShipmentStatus(
          'sh-1',
          ShipmentStatus.RETURNED,
          'actor-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
    });
  });

  // SHP-3 (أ) (P1 — GF-IMP-W2): إلغاء شحنة PREPARING مكتمل — عكس قيد
  // تكلفة الشحن داخل نفس المعاملة + إعادة أمر البيع إلى CONFIRMED (CAS).
  describe('SHP-3 (أ) — إلغاء شحنة PREPARING (عكس القيد وإعادة الأمر)', () => {
    it('PREPARING → CANCELLED يعكس قيد التكلفة ويعيد الأمر إلى CONFIRMED ويسجل التدقيق', async () => {
      prisma.shipment.findUnique
        .mockResolvedValueOnce({
          id: 'sh-1',
          code: 'SHP-1',
          status: ShipmentStatus.PREPARING,
          salesOrderId: 'so-1',
          salesOrder: { items: [] },
        })
        .mockResolvedValueOnce({
          id: 'sh-1',
          status: ShipmentStatus.CANCELLED,
        });
      prisma.journalEntry.findFirst.mockResolvedValue({
        id: 'je-cost-1',
        code: 'JE-COST-1',
        isReversed: false,
      });
      prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.shipment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.updateShipmentStatus(
        'sh-1',
        ShipmentStatus.CANCELLED,
        'actor-1',
      );

      // مطابقة تامة (أدق من objectContaining) — بنية where كاملة كما بناها
      // الإلغاء: البحث بأحد مفتاحي postingKey الثابتين
      expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith({
        where: {
          postingKey: {
            in: ['shipping-cost-cash:sh-1', 'shipping-cost-accrual:sh-1'],
          },
        },
        select: { id: true, isReversed: true, code: true },
      });
      expect(financial.reverseJournalEntryInTx).toHaveBeenCalledWith(
        expect.anything(),
        'je-cost-1',
        'actor-1',
        expect.stringContaining('SHP-1'),
      );
      expect(prisma.salesOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'so-1', status: SalesOrderStatus.SHIPPED },
          data: { status: SalesOrderStatus.CONFIRMED },
        }),
      );
      expect(result.status).toBe(ShipmentStatus.CANCELLED);
      expect(prisma.activityLog.create).toHaveBeenCalled();
    });

    it('قيد تكلفة معكوس مسبقًا → 409 (حالة غير متسقة تتطلب مراجعة)', async () => {
      prisma.shipment.findUnique.mockResolvedValue({
        id: 'sh-1',
        code: 'SHP-1',
        status: ShipmentStatus.PREPARING,
        salesOrderId: 'so-1',
        salesOrder: { items: [] },
      });
      prisma.journalEntry.findFirst.mockResolvedValue({
        id: 'je-cost-1',
        code: 'JE-COST-1',
        isReversed: true,
      });

      await expect(
        service.updateShipmentStatus(
          'sh-1',
          ShipmentStatus.CANCELLED,
          'actor-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(financial.reverseJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('قيد غائب (تكلفة صفر) → الإلغاء ينجح بلا عكس ويعيد الأمر إلى CONFIRMED', async () => {
      prisma.shipment.findUnique
        .mockResolvedValueOnce({
          id: 'sh-1',
          code: 'SHP-1',
          status: ShipmentStatus.PREPARING,
          salesOrderId: 'so-1',
          salesOrder: { items: [] },
        })
        .mockResolvedValueOnce({
          id: 'sh-1',
          status: ShipmentStatus.CANCELLED,
        });
      prisma.journalEntry.findFirst.mockResolvedValue(null);
      prisma.salesOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.shipment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.updateShipmentStatus(
        'sh-1',
        ShipmentStatus.CANCELLED,
        'actor-1',
      );
      expect(financial.reverseJournalEntryInTx).not.toHaveBeenCalled();
      expect(result.status).toBe(ShipmentStatus.CANCELLED);
    });

    it('أمر البيع لم يعد SHIPPED → 409 بلا تغيير حالة الشحنة', async () => {
      prisma.shipment.findUnique.mockResolvedValue({
        id: 'sh-1',
        code: 'SHP-1',
        status: ShipmentStatus.PREPARING,
        salesOrderId: 'so-1',
        salesOrder: { items: [] },
      });
      prisma.journalEntry.findFirst.mockResolvedValue(null);
      prisma.salesOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateShipmentStatus(
          'sh-1',
          ShipmentStatus.CANCELLED,
          'actor-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
    });

    it('يرفض IN_TRANSIT → CANCELLED (400) — ليس في مصفوفة الانتقالات', async () => {
      prisma.shipment.findUnique.mockResolvedValue({
        id: 'sh-1',
        status: ShipmentStatus.IN_TRANSIT,
      });

      await expect(
        service.updateShipmentStatus(
          'sh-1',
          ShipmentStatus.CANCELLED,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
    });
  });

  // SHP-3 (أ): القرار المرافق — الشحنة الملغاة ليست نشطة فلا تحجب إنشاء
  // شحنة جديدة (الفهرس الجزئي يستثنيها أصلًا). الشحنة الملغاة تُحاكى هنا
  // مباشرة في القاعدة (لا مسار يصلها حاليًا) للتحقق من تعريف «النشطة».
  describe('SHP-3 (أ) — الشحنة الملغاة لا تمنع إنشاء شحنة جديدة', () => {
    it('فحص الشحنة النشطة يستثني CANCELLED (PREPARING/IN_TRANSIT فقط)', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        status: SalesOrderStatus.CONFIRMED,
        code: 'SO-1',
      });
      // لا شحنات نشطة — تاريخ الأمر شحنات ملغاة فقط (محاكاة قاعدة)
      prisma.shipment.count.mockResolvedValue(0);
      prisma.shipment.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'sh-new', ...data }),
      );

      const result = await service.createShipment(
        { salesOrderId: 'so-1', shippingCost: 0 },
        'actor-1',
      );

      expect(prisma.shipment.create).toHaveBeenCalledTimes(1);
      // تعريف «النشطة» في الفحص لا يشمل CANCELLED إطلاقًا
      const countCalls = prisma.shipment.count.mock.calls as unknown as Array<
        [{ where: { salesOrderId: string; status: { in: ShipmentStatus[] } } }]
      >;
      const countCall = countCalls[0][0];
      expect(countCall.where.salesOrderId).toBe('so-1');
      expect(countCall.where.status.in).toEqual([
        ShipmentStatus.PREPARING,
        ShipmentStatus.IN_TRANSIT,
      ]);
      expect(countCall.where.status.in).not.toContain(ShipmentStatus.CANCELLED);
      if (!('code' in result)) throw new Error('Expected created shipment');
    });
  });

  // SHP-4 (P1 — GF-IMP-W2): توحيد الاستجابة الأولى مع استجابة إعادة التشغيل.
  describe('SHP-4 — الاستجابة الأولى وإعادة التشغيل متطابقتان', () => {
    it('shippingCost رقمي في الأولى، وإعادة التشغيل تعيد نفس الشكل والقيم', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        status: SalesOrderStatus.CONFIRMED,
        code: 'SO-1',
      });
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
      // محاكاة Prisma الحقيقي: shippingCost يعود Decimal (يتسلسل نصًا)
      prisma.shipment.create.mockResolvedValue({
        id: 'sh-4',
        code: 'SHP-4',
        salesOrderId: 'so-1',
        shippingCost: '75.5',
      });

      const first = await service.createShipment(
        { salesOrderId: 'so-1', shippingCost: 75.5 },
        'actor-1',
        'ship-key-4',
      );

      // الاستجابة الأولى منسّقة (رقمية) لا كائن Prisma خام
      expect(typeof (first as { shippingCost: unknown }).shippingCost).toBe(
        'number',
      );
      expect((first as { shippingCost: number }).shippingCost).toBe(75.5);

      // الاستجابة المخزنة على المفتاح هي نفسها
      const updateCalls = prisma.idempotencyKey.update.mock
        .calls as unknown as Array<
        [{ where: { key: string }; data: { response: unknown } }]
      >;
      const stored = updateCalls[0][0].data.response;
      expect(stored).toEqual(first);

      // إعادة التشغيل بنفس المفتاح والمحتوى → replay مطابق للشكل والقيم
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'ship-key-4',
        scope: 'shipping.shipment.create',
        requestHash: computeRequestHash({
          operation: 'shipping.shipment.create',
          actorId: 'actor-1',
          salesOrderId: 'so-1',
          shippingCompanyId: null,
          shippingCost: 75.5,
          trackingNumber: null,
          notes: null,
          treasuryId: null,
          accrueToPayable: false,
        }),
        response: stored,
      });
      const replay = await service.createShipment(
        { salesOrderId: 'so-1', shippingCost: 75.5 },
        'actor-1',
        'ship-key-4',
      );

      expect(replay).toEqual({ ...(first as object), replayed: true });
      expect(prisma.shipment.create).toHaveBeenCalledTimes(1);
    });
  });
});
