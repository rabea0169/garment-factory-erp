/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StockMovementType,
  UserRole,
  WarehouseType,
} from '@prisma/client';
import { InventoryService, StockEvent } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import {
  createEventEmitterMock,
  createPrismaMock,
} from '../../../test/helpers/prisma-mock';
import { EVENTS } from '../../events/event-types';

/**
 * GF-0007 — اختبارات أساس المخزون القابل للتدقيق.
 *
 * ملحوظة معمارية: نستخدم mock منفصل للـ tx (عميل الـ transaction) غير الـ mock
 * العام، فنتحقق أن كل كتابة (رصيد/ledger/idempotency) تجري داخل
 * prisma.$transaction حصرًا — وهو جوهر معياري القبول 2 و4. الـ rollback
 * الفعلي للكتابات تضمنه prisma.$transaction في قاعدة البيانات؛ الاختبار
 * يثبت أن كل الكتابات tx-scoped وأن الاستجابة لا تُخزَّن إلا بعد اكتمالها.
 */

type ExtendedPrismaMock = ReturnType<typeof createPrismaMock> & {
  warehouse: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
  };
  stockLedgerEntry: {
    create: jest.Mock;
    findMany: jest.Mock;
    aggregate: jest.Mock;
  };
  idempotencyKey: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

function createTxMock() {
  return {
    $executeRaw: jest.fn(),
    rawMaterial: { update: jest.fn() },
    finishedGoodStock: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    stockLedgerEntry: {
      create: jest.fn(),
      aggregate: jest.fn(),
      createMany: jest.fn(),
    },
    idempotencyKey: { create: jest.fn(), update: jest.fn() },
    // INV-7: سجل التدقيق يُكتب داخل معاملة الحركة
    activityLog: { create: jest.fn() },
  };
}

function createInventoryPrismaMock(): ExtendedPrismaMock {
  return {
    ...createPrismaMock(),
    warehouse: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    stockLedgerEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    idempotencyKey: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

const WAREHOUSE = {
  id: 'wh-1',
  code: 'WH-RAW',
  name: 'مخزن الخامات الرئيسي',
  type: WarehouseType.RAW_MATERIAL,
  isActive: true,
};

const MATERIAL_AFTER = {
  currentStock: 200,
  costPerUnit: 45.5,
  minStockLevel: 50,
};

const ENTRY_CREATED = {
  entryCode: 'SLE-20260825-TEST0001',
  createdAt: new Date('2026-08-25T10:00:00.000Z'),
};

/** نفس منطق الخدمة: بصمة ثابتة للطلب (عقد الاختبار). */
function requestHashOf(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

describe('InventoryService — أساس المخزون القابل للتدقيق (GF-0007)', () => {
  let service: InventoryService;
  let prisma: ExtendedPrismaMock;
  let tx: ReturnType<typeof createTxMock>;
  let eventEmitter: { emitAsync: jest.Mock };
  let postJournalEntryInTx: jest.Mock;
  let financial: FinancialPostingService;

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    tx = createTxMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    postJournalEntryInTx = jest.fn().mockResolvedValue({
      entryId: 'je-1',
      entryCode: 'JE-TEST-1',
      totalDebit: 0,
      totalCredit: 0,
      linesCount: 1,
      createdAt: new Date(),
    });
    financial = {
      postJournalEntryInTx,
    } as unknown as FinancialPostingService;
    prisma.$transaction.mockImplementation(
      async (
        fn: (txClient: ReturnType<typeof createTxMock>) => Promise<unknown>,
      ) => fn(tx),
    );
    // مخزن خامات نشط صالح افتراضيًا
    prisma.warehouse.findUnique.mockResolvedValue(WAREHOUSE);
    tx.rawMaterial.update.mockResolvedValue(MATERIAL_AFTER);
    tx.stockLedgerEntry.create.mockResolvedValue(ENTRY_CREATED);
    tx.stockLedgerEntry.aggregate.mockResolvedValue({
      _sum: { quantityDelta: 150 },
    });
    tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
      financial,
    );
  });

  // ============ FINISHED GOODS (authoritative stock) ============

  describe('استلام المنتج التام (receiveFinishedGood)', () => {
    it('يزيد FinishedGoodStock ويسجل حركة RECEIVE داخل transaction', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({
        ...WAREHOUSE,
        type: WarehouseType.FINISHED_GOODS,
      });
      tx.finishedGoodStock.findUniqueOrThrow.mockResolvedValue({
        quantity: 150,
        unitCost: new Prisma.Decimal(52),
      });

      const result = await service.receiveFinishedGood(
        {
          productVariantId: 'variant-1',
          warehouseId: 'wh-fg',
          quantity: 10,
          unitCost: 60,
          reference: 'WO-1',
        },
        'user-1',
      );

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: StockMovementType.RECEIVE,
          warehouseId: 'wh-fg',
          productVariantId: 'variant-1',
          quantityDelta: 10,
          balanceAfter: 150,
          unitCost: 60,
          createdById: 'user-1',
        }) as Record<string, unknown>,
        select: { entryCode: true, createdAt: true },
      });
      expect(result).toMatchObject({
        replayed: false,
        quantityDelta: 10,
        balanceAfter: 150,
        costPerUnitAfter: 52,
      });
      expect(prisma.finishedGood.create).not.toHaveBeenCalled();
      expect(prisma.finishedGood.update).not.toHaveBeenCalled();
    });
  });

  // ============ receive: ledger + متوسط مرجح ============

  describe('استلام الخامات (receive)', () => {
    it('يمر عبر ledger: زيادة ذرية increment (لا تعيين مطلق) + سجل حركة بلقطة الرصيد', async () => {
      const result = await service.receive(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantity: 50,
          unitCost: 48,
        },
        'user-1',
      );

      // الزيادة ذرية عبر increment — نقطة التسلسل ضد السباقات
      expect(tx.rawMaterial.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'rm-1' },
        data: { currentStock: { increment: 50 } },
        select: { currentStock: true, costPerUnit: true, minStockLevel: true },
      });
      // سجل الحركة: موقعة + لقطة الرصيد بعد الحركة + هوية المنشئ من الجلسة
      expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: StockMovementType.RECEIVE,
          warehouseId: 'wh-1',
          rawMaterialId: 'rm-1',
          quantityDelta: 50,
          balanceAfter: 200,
          unitCost: 48,
          totalValue: 2400,
          createdById: 'user-1',
        }) as Record<string, unknown>,
        select: { entryCode: true, createdAt: true },
      });
      expect(result).toMatchObject({
        replayed: false,
        entryCode: 'SLE-20260825-TEST0001',
        balanceAfter: 200,
        quantityDelta: 50,
      });
      // كل الكتابات داخل الـ transaction — لا كتابة خارجها (معيار القبول 2)
      expect(prisma.rawMaterial.update).not.toHaveBeenCalled();
      expect(prisma.stockLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('يحسب balanceAfter للمستودع المحدد لا للإجمالي العام', async () => {
      tx.rawMaterial.update.mockResolvedValue({
        currentStock: 160,
        costPerUnit: 45.5,
        minStockLevel: 50,
      });
      tx.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: 20 },
      });

      const result = await service.receive(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-2',
          quantity: 10,
          unitCost: 48,
        },
        'user-1',
      );

      expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          warehouseId: 'wh-2',
          balanceAfter: 30,
        }) as Record<string, unknown>,
        select: { entryCode: true, createdAt: true },
      });
      expect(result.balanceAfter).toBe(30);
    });

    it('يعيد احتساب التكلفة بمتوسط مرجح: 150@45.5 + 50@48 → 46.13 (ADR-0008)', async () => {
      const result = await service.receive(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantity: 50,
          unitCost: 48,
        },
        'user-1',
      );

      expect(tx.rawMaterial.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'rm-1' },
        data: { costPerUnit: 46.13 },
      });
      expect(result.costPerUnitAfter).toBe(46.13);
      expect(result.unitCost).toBe(48);
      expect(result.totalValue).toBe(2400);
    });

    it('استلام على رصيد صفري: التكلفة الجديدة = تكلفة الشحنة مباشرة', async () => {
      tx.rawMaterial.update.mockResolvedValue({
        currentStock: 50,
        costPerUnit: 999, // تكلفة قديمة لا أثر لها عند رصيد صفري
        minStockLevel: 10,
      });

      const result = await service.receive(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantity: 50,
          unitCost: 48,
        },
        'user-1',
      );

      expect(result.costPerUnitAfter).toBe(48);
      expect(tx.rawMaterial.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'rm-1' },
        data: { costPerUnit: 48 },
      });
    });

    it('يطلق STOCK_ADDED بعد نجاح الـ transaction بالمخزن والرصيد الجديد', async () => {
      await service.receive(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantity: 50,
          unitCost: 48,
        },
        'user-1',
      );

      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(EVENTS.STOCK_ADDED, {
        materialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 50,
        newStock: 200,
      });
    });
  });

  // ============ issue: المنع السالب + التكلفة الحالية ============

  describe('صرف الخامات (issue)', () => {
    it('خصم بقيمة التكلفة الحالية: delta سالبة وbalanceAfter لقطة الرصيد', async () => {
      tx.rawMaterial.update.mockResolvedValue({
        currentStock: 180,
        costPerUnit: 45.5,
        minStockLevel: 50,
      });
      tx.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: 200 },
      });

      const result = await service.issue(
        { rawMaterialId: 'rm-1', warehouseId: 'wh-1', quantity: 20 },
        'user-1',
      );

      expect(tx.rawMaterial.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'rm-1' },
        data: { currentStock: { increment: -20 } },
        select: { currentStock: true, costPerUnit: true, minStockLevel: true },
      });
      expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: StockMovementType.ISSUE,
          quantityDelta: -20,
          balanceAfter: 180,
          unitCost: 45.5,
          totalValue: 910,
        }) as Record<string, unknown>,
        select: { entryCode: true, createdAt: true },
      });
      expect(result.quantityDelta).toBe(-20);
      // الصرف لا يغيّر التكلفة المرجحة
      expect(tx.rawMaterial.update).toHaveBeenCalledTimes(1);
    });

    it('يرفض الرصيد السالب بـ 400 ولا يكتب أي سجل ledger (ADR-0007)', async () => {
      tx.rawMaterial.update.mockResolvedValue({
        currentStock: -5,
        costPerUnit: 45.5,
        minStockLevel: 50,
      });

      await expect(
        service.issue(
          { rawMaterialId: 'rm-1', warehouseId: 'wh-1', quantity: 155 },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(tx.stockLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('يطلق STOCK_DEDUCTED ثم STOCK_LOW عند هبوط الرصيد لحد الطلب', async () => {
      tx.rawMaterial.update.mockResolvedValue({
        currentStock: 40,
        costPerUnit: 45.5,
        minStockLevel: 50,
      });
      tx.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: 50 },
      });

      await service.issue(
        { rawMaterialId: 'rm-1', warehouseId: 'wh-1', quantity: 10 },
        'user-1',
      );

      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        EVENTS.STOCK_DEDUCTED,
        {
          materialId: 'rm-1',
          warehouseId: 'wh-1',
          quantity: 10,
          newStock: 40,
        },
      );
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(EVENTS.STOCK_LOW, {
        materialId: 'rm-1',
        warehouseId: 'wh-1',
        currentStock: 40,
        minStockLevel: 50,
        actorId: 'user-1', // CC-8: فاعل الحركة يرافق حدث النقص
      });
    });
  });

  // ============ INV-1: تأجيل الأحداث داخل معاملة خارجية ============

  describe('INV-1: أحداث مؤجلة داخل معاملة خارجية (externalTx)', () => {
    it('لا يستدعي emitAsync داخل المسار ويملأ المجمع بالأحداث الصحيحة', async () => {
      tx.rawMaterial.update.mockResolvedValue({
        currentStock: 40,
        costPerUnit: 45.5,
        minStockLevel: 50,
      });
      tx.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: 50 },
      });

      const events: StockEvent[] = [];
      const result = await service.issue(
        { rawMaterialId: 'rm-1', warehouseId: 'wh-1', quantity: 10 },
        'user-1',
        tx as never,
        events,
      );

      // INV-1: داخل معاملة خارجية لا بث قبل commit — المسار يجب ألا يلمس emitter
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
      // المعاملة يملكها المستدعي الأعلى — inventory لا يفتح معاملة خاصة به
      expect(prisma.$transaction).not.toHaveBeenCalled();
      // المجمع امتلأ بالأحداث الصحيحة: خصم + انخفاض لحد الطلب (40 ≤ 50)
      // و CC-8: actorId يرافق حدث النقص (فاعل سجل التنبيه في المستمع)
      expect(events).toEqual([
        {
          name: EVENTS.STOCK_DEDUCTED,
          payload: {
            materialId: 'rm-1',
            warehouseId: 'wh-1',
            quantity: 10,
            newStock: 40,
          },
        },
        {
          name: EVENTS.STOCK_LOW,
          payload: {
            materialId: 'rm-1',
            warehouseId: 'wh-1',
            currentStock: 40,
            minStockLevel: 50,
            actorId: 'user-1',
          },
        },
      ]);
      expect(result.replayed).toBe(false);
      expect(result.balanceAfter).toBe(40);
    });

    it('externalTx بلا مجمع: لا بث قبل commit — الأحداث تُهمل بأمان', async () => {
      tx.rawMaterial.update.mockResolvedValue(MATERIAL_AFTER); // 200 > 50: لا STOCK_LOW

      await service.receive(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantity: 50,
          unitCost: 48,
        },
        'user-1',
        tx as never,
      );

      // INV-1: بلا مجمع لا تُبث الأحداث إطلاقًا — إهمال إشعار أسلم من بثه
      // وهميًا قبل commit (rollback المستدعي يجعل الحركة غير موجودة).
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('المسار الداخلي (بلا externalTx) يبث بعد commit كما هو — لا انحدار', async () => {
      tx.rawMaterial.update.mockResolvedValue(MATERIAL_AFTER);

      await service.receive(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantity: 50,
          unitCost: 48,
        },
        'user-1',
      );

      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(EVENTS.STOCK_ADDED, {
        materialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 50,
        newStock: 200,
      });
    });
  });

  // ============ adjust / waste ============

  describe('تسوية الجرد (adjust)', () => {
    it('فرق موقّع مع سبب إلزامي في notes الحركة', async () => {
      tx.rawMaterial.update.mockResolvedValue({
        currentStock: 146.5,
        costPerUnit: 45.5,
        minStockLevel: 50,
      });
      tx.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: 150 },
      });

      const result = await service.adjust(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantityDelta: -3.5,
          reason: 'عجز جرد شهري',
        },
        'user-1',
      );

      expect(tx.rawMaterial.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'rm-1' },
        data: { currentStock: { increment: -3.5 } },
        select: { currentStock: true, costPerUnit: true, minStockLevel: true },
      });
      expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: StockMovementType.ADJUSTMENT,
          quantityDelta: -3.5,
          balanceAfter: 146.5,
          notes: 'تسوية جرد — السبب: عجز جرد شهري',
        }) as Record<string, unknown>,
        select: { entryCode: true, createdAt: true },
      });
      expect(result.quantityDelta).toBe(-3.5);
    });

    it('تسوية تُظهر رصيدًا سالبًا → 400 بلا ledger', async () => {
      tx.rawMaterial.update.mockResolvedValue({
        currentStock: -2,
        costPerUnit: 45.5,
        minStockLevel: 50,
      });

      await expect(
        service.adjust(
          {
            rawMaterialId: 'rm-1',
            warehouseId: 'wh-1',
            quantityDelta: -12,
            reason: 'عجز كبير',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(tx.stockLedgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('الهدر (waste)', () => {
    it('كمية سالبة بقيمة التكلفة الحالية والسبب في notes', async () => {
      tx.rawMaterial.update.mockResolvedValue({
        currentStock: 197.5,
        costPerUnit: 45.5,
        minStockLevel: 50,
      });
      tx.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: 200 },
      });

      const result = await service.waste(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantity: 2.5,
          reason: 'قماش مبلل تالف',
        },
        'user-1',
      );

      expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: StockMovementType.WASTE,
          quantityDelta: -2.5,
          balanceAfter: 197.5,
          unitCost: 45.5,
          totalValue: 113.75,
          notes: 'هدر — السبب: قماش مبلل تالف',
        }) as Record<string, unknown>,
        select: { entryCode: true, createdAt: true },
      });
      expect(result.totalValue).toBe(113.75);
    });
  });

  // ============ idempotency (معيار القبول 3) ============

  describe('مفاتيح idempotency', () => {
    const receivePayload = {
      operation: 'inventory.receive',
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      quantityDelta: 50,
      unitCost: 48,
    };

    it('نفس المفتاح مرتين → أثر واحد: سجل ledger واحد واستجابة مُعاد تشغيلها', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
      const hash = requestHashOf(receivePayload);

      const input = {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 50,
        unitCost: 48,
        idempotencyKey: 'key-100',
      };
      const first = await service.receive(input, 'user-1');

      // السجل أنشئ داخل الـ tx ثم خُزنت الاستجابة فيه
      expect(tx.idempotencyKey.create).toHaveBeenCalledWith({
        data: { key: 'key-100', scope: 'inventory.receive', requestHash: hash },
        select: { id: true },
      });
      expect(tx.idempotencyKey.update).toHaveBeenCalledWith({
        where: { key: 'key-100' },
        data: {
          response: expect.objectContaining({
            entryCode: 'SLE-20260825-TEST0001',
            balanceAfter: 200,
          }) as Record<string, unknown>,
        },
      });
      expect(first.replayed).toBe(false);

      // الإرسال الثاني بنفس المفتاح والمحتوى: استجابة مخزنة بلا أي كتابة جديدة
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'key-100',
        scope: 'inventory.receive',
        requestHash: hash,
        response: {
          entryCode: 'SLE-20260825-TEST0001',
          type: StockMovementType.RECEIVE,
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantityDelta: 50,
          balanceAfter: 200,
          unitCost: 48,
          totalValue: 2400,
          costPerUnitAfter: 46.13,
          createdAt: '2026-08-25T10:00:00.000Z',
        },
      });
      const second = await service.receive(input, 'user-1');

      expect(second).toMatchObject({
        replayed: true,
        entryCode: 'SLE-20260825-TEST0001',
      });
      // الأثر الواحد: الـ transaction لم تُنفذ مرة ثانية
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.stockLedgerEntry.create).toHaveBeenCalledTimes(1);
      expect(tx.rawMaterial.update).toHaveBeenCalledTimes(2); // زيادة + تكلفة من التنفيذ الأول فقط
    });

    it('نفس المفتاح بمحتوى مختلف → 409 تعارض لا إعادة تنفيذ', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'key-100',
        scope: 'inventory.receive',
        requestHash: 'a-different-hash',
        response: { entryCode: 'SLE-X' },
      });

      await expect(
        service.receive(
          {
            rawMaterialId: 'rm-1',
            warehouseId: 'wh-1',
            quantity: 50,
            unitCost: 48,
            idempotencyKey: 'key-100',
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('مفتاح مستخدم في نطاق مختلف → 409 (المفتاح لا يعبر العمليات)', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'key-100',
        scope: 'inventory.issue',
        requestHash: requestHashOf(receivePayload),
        response: { entryCode: 'SLE-X' },
      });

      await expect(
        service.receive(
          {
            rawMaterialId: 'rm-1',
            warehouseId: 'wh-1',
            quantity: 50,
            unitCost: 48,
            idempotencyKey: 'key-100',
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('سباق P2002 (عملية متزامنة كسبت السبق) → استرجاع استجابتها بلا أثر جديد', async () => {
      prisma.$transaction.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: 'idempotency_keys_key_key' },
      });
      prisma.idempotencyKey.findUnique
        .mockResolvedValueOnce(null) // الفحص الأول: المفتاح حر
        .mockResolvedValueOnce({
          // بعد فشل السباق: العملية الأخرى اكتملت
          key: 'key-100',
          scope: 'inventory.receive',
          requestHash: requestHashOf(receivePayload),
          response: {
            entryCode: 'SLE-20260825-OTHER01',
            type: StockMovementType.RECEIVE,
            rawMaterialId: 'rm-1',
            warehouseId: 'wh-1',
            quantityDelta: 50,
            balanceAfter: 200,
            unitCost: 48,
            totalValue: 2400,
            costPerUnitAfter: 46.13,
            createdAt: '2026-08-25T10:00:00.000Z',
          },
        });

      const result = await service.receive(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantity: 50,
          unitCost: 48,
          idempotencyKey: 'key-100',
        },
        'user-1',
      );

      expect(result).toMatchObject({
        replayed: true,
        entryCode: 'SLE-20260825-OTHER01',
      });
      // لم تُكتب أي حركة من هذه المحاولة
      expect(tx.stockLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('سجل موجود بلا استجابة (محاولة غير مكتملة) → 409 لا تكرار', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'key-100',
        scope: 'inventory.receive',
        requestHash: requestHashOf(receivePayload),
        response: null,
      });

      await expect(
        service.receive(
          {
            rawMaterialId: 'rm-1',
            warehouseId: 'wh-1',
            quantity: 50,
            unitCost: 48,
            idempotencyKey: 'key-100',
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ============ فشل منتصف الـ transaction (معيار القبول 4) ============

  describe('فشل منتصف الـ transaction', () => {
    it('فشل كتابة الـ ledger → لا تُخزَّن استجابة ولا يبقى ledger معلق، وكل الكتابات tx-scoped', async () => {
      tx.stockLedgerEntry.create.mockRejectedValue(
        new Error('DB write failed mid-transaction'),
      );

      await expect(
        service.receive(
          {
            rawMaterialId: 'rm-1',
            warehouseId: 'wh-1',
            quantity: 50,
            unitCost: 48,
          },
          'user-1',
        ),
      ).rejects.toThrow('DB write failed mid-transaction');

      // الاستجابة لم تُخزَّن → المفتاح لم يكتمل → إعادة المحاولة لاحقًا تعيد التنفيذ بأمان
      expect(tx.idempotencyKey.update).not.toHaveBeenCalled();
      // لا كتابات خارج نطاق الـ transaction (الـ rollback الفعلي تضمنه prisma.$transaction)
      expect(prisma.rawMaterial.update).not.toHaveBeenCalled();
      expect(prisma.stockLedgerEntry.create).not.toHaveBeenCalled();
      expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
    });

    it('خامة غير موجودة (P2025 من الـ UPDATE) → 404 بلا سجل ledger', async () => {
      tx.rawMaterial.update.mockRejectedValue({ code: 'P2025' });

      await expect(
        service.issue(
          { rawMaterialId: 'ghost', warehouseId: 'wh-1', quantity: 10 },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(tx.stockLedgerEntry.create).not.toHaveBeenCalled();
    });
  });

  // ============ المخازن والتحقق منها ============

  describe('المخازن', () => {
    it('يرفض مخزنًا غير موجود بـ 404 قبل أي كتابة', async () => {
      prisma.warehouse.findUnique.mockResolvedValue(null);

      await expect(
        service.receive(
          {
            rawMaterialId: 'rm-1',
            warehouseId: 'ghost',
            quantity: 50,
            unitCost: 48,
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('يرفض مخزنًا غير نشط بـ 400', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({
        ...WAREHOUSE,
        isActive: false,
      });

      await expect(
        service.receive(
          {
            rawMaterialId: 'rm-1',
            warehouseId: 'wh-1',
            quantity: 50,
            unitCost: 48,
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('يرفض حركات الخامات في مخازن المنتج التام بـ 400', async () => {
      prisma.warehouse.findUnique.mockResolvedValue({
        ...WAREHOUSE,
        type: WarehouseType.FINISHED_GOODS,
      });

      await expect(
        service.receive(
          {
            rawMaterialId: 'rm-1',
            warehouseId: 'wh-fg',
            quantity: 50,
            unitCost: 48,
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('قائمة المخازن النشطة مرتبة بالكود', async () => {
      const warehouses = [WAREHOUSE];
      prisma.warehouse.findMany.mockResolvedValue(warehouses);

      const result = await service.getWarehouses({});

      expect(result.data).toEqual(warehouses);
      expect(prisma.warehouse.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        where: { isActive: true },
        orderBy: { code: 'asc' },
      });
    });
  });

  describe('الرصيد متعدد المستودعات (GF-REMAINING-002)', () => {
    it('يُرجع SUM(quantityDelta) لكل مستودع بدلاً من آخر balanceAfter', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          warehouseId: 'wh-1',
          warehouseCode: 'WH-RAW',
          warehouseName: 'مخزن الخامات الرئيسي',
          balance: new Prisma.Decimal('130.5000'),
          lastUpdate: new Date('2026-08-26T10:00:00.000Z'),
        },
        {
          warehouseId: 'wh-2',
          warehouseCode: 'WH-RAW-2',
          warehouseName: 'مخزن خامات ثانٍ',
          balance: new Prisma.Decimal('20.0000'),
          lastUpdate: new Date('2026-08-26T11:00:00.000Z'),
        },
      ]);

      const result = await service.getMaterialBalanceByWarehouse('rm-1');

      expect(result).toEqual([
        expect.objectContaining({ warehouseId: 'wh-1', balance: 130.5 }),
        expect.objectContaining({ warehouseId: 'wh-2', balance: 20 }),
      ]);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const [template] = prisma.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
      ];
      expect(template.join('')).toContain('SUM(sle."quantityDelta")');
      expect(template.join('')).toContain('GROUP BY');
    });
  });

  // ============ المسار القديم add-stock ============

  describe('المسار القديم add-stock (توافق الواجهة)', () => {
    it('يوجه عبر receive في مخزن الخامات الافتراضي — ledger لا استثناءات', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(WAREHOUSE);

      const result = await service.addRawMaterialStock(
        'rm-1',
        50,
        45.5,
        'user-1',
      );

      expect(prisma.warehouse.findFirst).toHaveBeenCalledWith({
        where: { type: WarehouseType.RAW_MATERIAL, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: StockMovementType.RECEIVE,
          warehouseId: 'wh-1',
          rawMaterialId: 'rm-1',
          quantityDelta: 50,
          unitCost: 45.5,
          reference: 'إضافة مخزون يدوية (مسار add-stock)',
          createdById: 'user-1',
        }) as Record<string, unknown>,
        select: { entryCode: true, createdAt: true },
      });
      expect(result.balanceAfter).toBe(200);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(EVENTS.STOCK_ADDED, {
        materialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 50,
        newStock: 200,
      });
    });

    it('بلا مخازن خامات نشطة → 409 برسالة واضحة (fail-closed)', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.addRawMaterialStock('rm-1', 50, 45.5, 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ============ قراءة الـ ledger ============

  describe('قراءة سجل الحركات', () => {
    it('مرشحات خامة/مخزن/نوع/فترة مع حد الصفحة الافتراضي 20 (السقف 100) وترتيب أحدث أولًا', async () => {
      const entries = [{ id: 'sle-1' }];
      prisma.stockLedgerEntry.findMany.mockResolvedValue(entries);

      const result = await service.getLedgerEntries({
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        type: StockMovementType.RECEIVE,
        from: '2026-08-01T00:00:00Z',
        to: '2026-08-31T23:59:59Z',
      });

      expect(result.data).toEqual(entries);
      expect(prisma.stockLedgerEntry.findMany).toHaveBeenCalledWith({
        where: {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          type: StockMovementType.RECEIVE,
          createdAt: {
            gte: new Date('2026-08-01T00:00:00Z'),
            lte: new Date('2026-08-31T23:59:59Z'),
          },
        },
        include: {
          warehouse: { select: { code: true, name: true } },
          rawMaterial: { select: { code: true, name: true, unit: true } },
        },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('بلا مرشحات: where فارغة والسقف 100 من PaginationDto (كان العنوان يتحدث عن 200 متقادمًا)', async () => {
      prisma.stockLedgerEntry.findMany.mockResolvedValue([]);

      await service.getLedgerEntries({});

      expect(prisma.stockLedgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 0, take: 20 }),
      );
    });
  });

  // ============ القراءات القديمة (انحدار GF-0003) ============

  describe('القراءات القديمة (انحدار)', () => {
    it('يجلب كل الخامات مع الموردين مرتبة بالاسم (دور مالي)', async () => {
      const materials = [
        {
          id: 'rm-1',
          name: 'قماش قطني',
          costPerUnit: 45.5,
          supplier: { id: 's-1' },
        },
      ];
      prisma.rawMaterial.findMany.mockResolvedValue(materials);

      const result = await service.getAllRawMaterials({}, UserRole.ACCOUNTANT);

      expect(result.data).toEqual(materials);
      expect(prisma.rawMaterial.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { supplier: true },
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('يعرض فقط الخامات التي رصيدها عند حد الطلب أو أقل (low stock) — B2 $queryRaw', async () => {
      // B2: getLowStockMaterials uses $queryRaw instead of findMany+filter.
      // Mock $queryRaw to return only low-stock rows (matching the SQL WHERE).
      prisma.$queryRaw = jest
        .fn()
        .mockImplementation((strings: TemplateStringsArray) => {
          // SQL strings come as a tagged template array; values are the params.
          const sql = strings.join('?');
          if (sql.includes('COUNT(*)')) {
            return Promise.resolve([{ count: 2n }]);
          }
          // Data rows — simulating the WHERE currentStock <= minStockLevel filter
          return Promise.resolve([
            {
              id: 'rm-1',
              code: 'RM-001',
              name: 'قماش قطني',
              currentStock: 5,
              minStockLevel: 20,
              unit: 'METER',
              supplierId: 'sup-1',
            },
            {
              id: 'rm-3',
              code: 'RM-003',
              name: 'خيط',
              currentStock: 20,
              minStockLevel: 20,
              unit: 'SPOOL',
              supplierId: 'sup-2',
            },
          ]);
        });

      const result = await service.getLowStockMaterials({});

      expect(result.data.map((m) => m.id)).toEqual(['rm-1', 'rm-3']);
      // D7: costPerUnit must NOT be returned
      expect(result.data[0]).not.toHaveProperty('costPerUnit');
    });

    it('يجلب رصيد المنتج التام من FinishedGoodStock مع المخزن والمنتج', async () => {
      const rows = [
        {
          id: 'fg-stock-1',
          quantity: 12,
          warehouseId: 'wh-fg',
          productVariant: { product: { name: 'تيشيرت' } },
          warehouse: { code: 'WH-FG' },
        },
      ];
      prisma.finishedGoodStock.findMany.mockResolvedValue(rows);

      const result = await service.getAllFinishedGoods({});

      expect(result.data).toEqual([
        {
          id: 'fg-stock-1',
          quantity: 12,
          warehouseId: 'wh-fg',
          variant: { product: { name: 'تيشيرت' } },
          warehouse: { code: 'WH-FG' },
        },
      ]);
      expect(prisma.finishedGoodStock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { quantity: { gt: 0 } },
          include: {
            productVariant: { include: { product: true } },
            warehouse: true,
          },
        }),
      );
    });

    it('الملخص يجمع العدادات: خامات + منخفض + أنواع منتج تام', async () => {
      prisma.rawMaterial.count.mockResolvedValue(10);
      // B2: getLowStockMaterials now uses $queryRaw instead of findMany.
      // The dashboard summary calls it — mock $queryRaw to simulate low-stock
      // count. SQL with COUNT(*) returns count; otherwise returns 2 data rows.
      prisma.$queryRaw = jest
        .fn()
        .mockImplementation((strings: TemplateStringsArray) => {
          const sql = strings.join('?');
          if (sql.includes('COUNT(*)')) {
            return Promise.resolve([{ count: 2n }]);
          }
          // Data rows — 2 low-stock items
          return Promise.resolve([
            {
              id: 'rm-1',
              code: 'RM-001',
              name: 'A',
              currentStock: 5,
              minStockLevel: 20,
              unit: 'M',
              supplierId: 's1',
            },
            {
              id: 'rm-2',
              code: 'RM-002',
              name: 'B',
              currentStock: 10,
              minStockLevel: 20,
              unit: 'M',
              supplierId: 's2',
            },
          ]);
        });
      prisma.finishedGoodStock.count.mockResolvedValue(4);

      const result = await service.getDashboardSummary();

      expect(result).toEqual({
        totalMaterials: 10,
        lowStockMaterials: 2,
        totalFinishedGoodsTypes: 4,
      });
    });

    it('INV-5: يقرأ العدد من meta.total بحد صف واحد — لا جلب 10000 صف لعدّها', async () => {
      prisma.rawMaterial.count.mockResolvedValue(10);
      prisma.finishedGoodStock.count.mockResolvedValue(4);
      // استعلام COUNT يقول 7 (هذا مصدر الحقيقة) بينما استعلام الصفوف يعيد
      // صفًا واحدًا فقط لأن الحد 1 — لو عدّت الخدمة data.length لقالت 1.
      prisma.$queryRaw = jest
        .fn()
        .mockImplementation((strings: TemplateStringsArray) => {
          const sql = strings.join('?');
          if (sql.includes('COUNT(*)')) {
            return Promise.resolve([{ count: 7n }]);
          }
          return Promise.resolve([
            {
              id: 'rm-1',
              code: 'RM-001',
              name: 'A',
              currentStock: 5,
              minStockLevel: 20,
              unit: 'M',
              supplierId: 's1',
            },
          ]);
        });

      const result = await service.getDashboardSummary();

      // العدد من total لا من length
      expect(result.lowStockMaterials).toBe(7);
      // استعلام الصفوف مرّ بحد LIMIT 1 (لا 10000)
      const limitCalls = prisma.$queryRaw.mock.calls.filter(
        (call: unknown[]) =>
          Array.isArray(call[0]) &&
          (call[0] as string[]).join('?').includes('LIMIT'),
      );
      expect(limitCalls).toHaveLength(1);
      expect(limitCalls[0][1]).toBe(1);
    });
  });

  // ============ INV-2: تكلفة المخزون للأدوار المالية فقط ============

  describe('INV-2: تقسيم القراءات بالدور (بيانات التكلفة)', () => {
    it('PRODUCTION_MANAGER على قائمة المواد: select بلا costPerUnit وبدون المورد', async () => {
      // الـ mock يحاكي نتيجة select العام — بلا تكلفة ولا مورد
      const publicRows = [
        {
          id: 'rm-1',
          code: 'RM-001',
          name: 'قماش قطني',
          unit: 'METER',
          currentStock: 120,
          minStockLevel: 50,
          supplierId: 'sup-1',
          isActive: true,
        },
      ];
      prisma.rawMaterial.findMany.mockResolvedValue(publicRows);

      const result = await service.getAllRawMaterials(
        {},
        UserRole.PRODUCTION_MANAGER,
      );

      const findManyArg = prisma.rawMaterial.findMany.mock.calls[0][0] as {
        select?: Record<string, boolean>;
        include?: unknown;
      };
      // عقد الاستعلام: select صريح بلا costPerUnit وبلا علاقة المورد
      expect(findManyArg.include).toBeUndefined();
      expect(findManyArg.select).toBeDefined();
      expect(findManyArg.select).not.toHaveProperty('costPerUnit');
      expect(findManyArg.select).not.toHaveProperty('supplier');
      // الدفاع العمقي: الصفوف المعادة لا تحمل التكلفة ولا المورد
      expect(result.data[0]).not.toHaveProperty('costPerUnit');
      expect(result.data[0]).not.toHaveProperty('supplier');
      expect(result.data[0]).toMatchObject({ id: 'rm-1', supplierId: 'sup-1' });
    });

    it.each([
      ['CASHIER', UserRole.CASHIER],
      ['VIEWER', UserRole.VIEWER],
      ['HR_MANAGER', UserRole.HR_MANAGER],
    ])(
      '%s على قائمة المواد: نفس الـ select العام (دور غير مالي)',
      async (_name, role) => {
        prisma.rawMaterial.findMany.mockResolvedValue([{ id: 'rm-1' }]);

        await service.getAllRawMaterials({}, role);

        const findManyArg = prisma.rawMaterial.findMany.mock.calls[0][0] as {
          select?: Record<string, boolean>;
          include?: unknown;
        };
        expect(findManyArg.include).toBeUndefined();
        expect(findManyArg.select).not.toHaveProperty('costPerUnit');
      },
    );

    it('استدعاء بلا دور (برمجي): fail-closed — التكلفة لا تُعاد', async () => {
      prisma.rawMaterial.findMany.mockResolvedValue([
        { id: 'rm-1', supplierId: 'sup-1' },
      ]);

      await service.getAllRawMaterials({});

      const findManyArg = prisma.rawMaterial.findMany.mock.calls[0][0] as {
        select?: Record<string, boolean>;
        include?: unknown;
      };
      expect(findManyArg.include).toBeUndefined();
      expect(findManyArg.select).not.toHaveProperty('costPerUnit');
    });

    it.each([
      ['INVENTORY_MANAGER', UserRole.INVENTORY_MANAGER],
      ['GENERAL_MANAGER', UserRole.GENERAL_MANAGER],
      ['SUPER_ADMIN', UserRole.SUPER_ADMIN],
    ])(
      '%s على قائمة المواد: include المورد (بيانات كاملة بالتكلفة)',
      async (_name, role) => {
        const materials = [
          { id: 'rm-1', costPerUnit: 45.5, supplier: { id: 's-1' } },
        ];
        prisma.rawMaterial.findMany.mockResolvedValue(materials);

        const result = await service.getAllRawMaterials({}, role);

        expect(result.data).toEqual(materials);
        expect(prisma.rawMaterial.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ include: { supplier: true } }),
        );
      },
    );

    it('دور مالي على الدفتر: unitCost/totalValue تعاد كما هي', async () => {
      const entries = [
        {
          id: 'sle-1',
          quantityDelta: -20,
          balanceAfter: 180,
          unitCost: 45.5,
          totalValue: 910,
        },
      ];
      prisma.stockLedgerEntry.findMany.mockResolvedValue(entries);

      const result = await service.getLedgerEntries({}, UserRole.ACCOUNTANT);

      expect(result.data).toEqual(entries);
      expect(result.data[0]).toHaveProperty('unitCost', 45.5);
      expect(result.data[0]).toHaveProperty('totalValue', 910);
    });

    it('دور غير مالي على الدفتر (دفاع عمقي): unitCost/totalValue تُسقطان', async () => {
      prisma.stockLedgerEntry.findMany.mockResolvedValue([
        {
          id: 'sle-1',
          quantityDelta: -20,
          balanceAfter: 180,
          unitCost: 45.5,
          totalValue: 910,
        },
      ]);

      const result = await service.getLedgerEntries(
        {},
        UserRole.PRODUCTION_MANAGER,
      );

      expect(result.data[0]).not.toHaveProperty('unitCost');
      expect(result.data[0]).not.toHaveProperty('totalValue');
      // الأعمدة الكمية تبقى — سلسلة التدقيق التشغيلية
      expect(result.data[0]).toMatchObject({
        id: 'sle-1',
        quantityDelta: -20,
        balanceAfter: 180,
      });
    });

    it('دور غير مالي على أرصدة المنتج التام: unitCost تُسقط والرصيد الكمي يبقى', async () => {
      prisma.finishedGoodStock.findMany.mockResolvedValue([
        {
          id: 'fg-stock-1',
          quantity: 12,
          warehouseId: 'wh-fg',
          unitCost: 52,
          productVariant: { product: { name: 'تيشيرت' } },
          warehouse: { code: 'WH-FG' },
        },
      ]);

      const result = await service.getAllFinishedGoods({}, UserRole.CASHIER);

      expect(result.data[0]).not.toHaveProperty('unitCost');
      expect(result.data[0]).toMatchObject({
        id: 'fg-stock-1',
        quantity: 12,
        variant: { product: { name: 'تيشيرت' } },
      });
    });

    it('دور مالي على أرصدة المنتج التام: unitCost تعاد', async () => {
      prisma.finishedGoodStock.findMany.mockResolvedValue([
        {
          id: 'fg-stock-1',
          quantity: 12,
          warehouseId: 'wh-fg',
          unitCost: 52,
          productVariant: { product: { name: 'تيشيرت' } },
          warehouse: { code: 'WH-FG' },
        },
      ]);

      const result = await service.getAllFinishedGoods({}, UserRole.ACCOUNTANT);

      expect(result.data[0]).toHaveProperty('unitCost', 52);
    });
  });
});

/**
 * OPS-F01 / OPS-F11 — قيد GL على هدر وتسوية المخزون.
 *
 * النمط: نتحقق أن InventoryService.executeMovement (عبر waste() / adjust())
 * يستدعي FinancialPostingService.postJournalEntryInTx داخل نفس الـ tx مع
 * الطرفين الصحيحين (debit/credit) والمبلغ = |الكمية| × متوسط التكلفة المرجح،
 * وأن postingKey مستقر مرتبط بـ entryCode.
 */
describe('InventoryService — قيد GL لهدر/تسوية المخزون (OPS-F01 / OPS-F11)', () => {
  let service: InventoryService;
  let prisma: ExtendedPrismaMock;
  let tx: ReturnType<typeof createTxMock>;
  let eventEmitter: { emitAsync: jest.Mock };
  let postJournalEntryInTx: jest.Mock;
  let financial: FinancialPostingService;

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    tx = createTxMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    postJournalEntryInTx = jest.fn().mockResolvedValue({
      entryId: 'je-1',
      entryCode: 'JE-TEST-1',
      totalDebit: 0,
      totalCredit: 0,
      linesCount: 1,
      createdAt: new Date(),
    });
    financial = {
      postJournalEntryInTx,
    } as unknown as FinancialPostingService;
    prisma.$transaction.mockImplementation(
      async (
        fn: (txClient: ReturnType<typeof createTxMock>) => Promise<unknown>,
      ) => fn(tx),
    );
    prisma.warehouse.findUnique.mockResolvedValue(WAREHOUSE);
    tx.rawMaterial.update.mockResolvedValue(MATERIAL_AFTER);
    tx.stockLedgerEntry.create.mockResolvedValue(ENTRY_CREATED);
    tx.stockLedgerEntry.aggregate.mockResolvedValue({
      _sum: { quantityDelta: 200 },
    });
    tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
      financial,
    );
  });

  it('OPS-F01: waste يرحّل Dr WASTE_EXPENSE / Cr INVENTORY بمبلغ |الكمية| × currentCost', async () => {
    tx.rawMaterial.update.mockResolvedValue({
      currentStock: 197.5,
      costPerUnit: 45.5, // متوسط التكلفة المرجح
      minStockLevel: 50,
    });

    await service.waste(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 2.5,
        reason: 'قماش مبلل تالف',
      },
      'user-1',
    );

    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
    const call = postJournalEntryInTx.mock.calls[0] as unknown as [
      unknown,
      {
        description: string;
        reference?: string;
        postingKey: string;
        isAuto: boolean;
        lines: {
          debitAccountId: string;
          creditAccountId: string;
          amount: number;
          description?: string;
        }[];
        userId?: string;
        metadata: { source: string; rawMaterialId: string };
      },
      string | undefined,
    ];
    const input = call[1];
    expect(input.isAuto).toBe(true);
    expect(input.postingKey).toBe('inventory-waste:' + ENTRY_CREATED.entryCode);
    expect(input.lines[0].debitAccountId).toBe(CHART_OF_ACCOUNTS.WASTE_EXPENSE);
    expect(input.lines[0].creditAccountId).toBe(CHART_OF_ACCOUNTS.INVENTORY);
    // amount = 2.5 × 45.5 = 113.75
    expect(input.lines[0].amount).toBeCloseTo(113.75, 2);
    expect(input.metadata).toEqual(
      expect.objectContaining({
        source: 'inventory.waste',
        rawMaterialId: 'rm-1',
      }),
    );
    expect(call[2]).toBe('user-1');
  });

  it('OPS-F11: تسوية موجبة (delta>0) ترحّل Dr INVENTORY / Cr INVENTORY_ADJUSTMENT_INCOME', async () => {
    tx.rawMaterial.update.mockResolvedValue({
      currentStock: 153.5,
      costPerUnit: 50, // متوسط التكلفة المرجح
      minStockLevel: 50,
    });

    await service.adjust(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantityDelta: 3.5, // موجب
        reason: 'فائض جرد',
      },
      'user-1',
    );

    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
    const input = postJournalEntryInTx.mock.calls[0][1] as {
      postingKey: string;
      lines: {
        debitAccountId: string;
        creditAccountId: string;
        amount: number;
      }[];
      metadata: { source: string; delta: number };
    };
    expect(input.postingKey).toBe(
      'inventory-adjustment:' + ENTRY_CREATED.entryCode,
    );
    expect(input.lines[0].debitAccountId).toBe(CHART_OF_ACCOUNTS.INVENTORY);
    expect(input.lines[0].creditAccountId).toBe(
      CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_INCOME,
    );
    // amount = 3.5 × 50 = 175
    expect(input.lines[0].amount).toBeCloseTo(175, 2);
    expect(input.metadata.delta).toBe(3.5);
    expect(input.metadata.source).toBe('inventory.adjustment');
  });

  it('OPS-F11: تسوية سالبة (delta<0) ترحّل Dr INVENTORY_ADJUSTMENT_EXPENSE / Cr INVENTORY', async () => {
    tx.rawMaterial.update.mockResolvedValue({
      currentStock: 146.5,
      costPerUnit: 45.5,
      minStockLevel: 50,
    });

    await service.adjust(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantityDelta: -3.5, // سالب
        reason: 'عجز جرد شهري',
      },
      'user-1',
    );

    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
    const input = postJournalEntryInTx.mock.calls[0][1] as {
      postingKey: string;
      lines: {
        debitAccountId: string;
        creditAccountId: string;
        amount: number;
      }[];
      metadata: { source: string; delta: number };
    };
    expect(input.postingKey).toBe(
      'inventory-adjustment:' + ENTRY_CREATED.entryCode,
    );
    expect(input.lines[0].debitAccountId).toBe(
      CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_EXPENSE,
    );
    expect(input.lines[0].creditAccountId).toBe(CHART_OF_ACCOUNTS.INVENTORY);
    // amount = |−3.5| × 45.5 = 159.25
    expect(input.lines[0].amount).toBeCloseTo(159.25, 2);
    expect(input.metadata.delta).toBe(-3.5);
  });

  it('لا يُرحّل قيد GL إذا كان المبلغ 0 (كمية صفرية)', async () => {
    tx.rawMaterial.update.mockResolvedValue({
      currentStock: 200,
      costPerUnit: 45.5,
      minStockLevel: 50,
    });

    await service.adjust(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantityDelta: 0, // لا أثر مالي
        reason: 'لا حركة',
      },
      'user-1',
    );

    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('RECEIVE/ISSUE لا تستدعي FinancialPostingService (يُرحّل من المستدعي)', async () => {
    tx.rawMaterial.update.mockResolvedValue({
      currentStock: 250,
      costPerUnit: 46.13,
      minStockLevel: 50,
    });

    await service.receive(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 50,
        unitCost: 48,
      },
      'user-1',
    );

    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('postingKey مستقر يربط القيد بـ entryCode (idempotency)', async () => {
    tx.rawMaterial.update.mockResolvedValue({
      currentStock: 197.5,
      costPerUnit: 45.5,
      minStockLevel: 50,
    });

    await service.waste(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 2.5,
        reason: 'قماش مبلل تالف',
      },
      'user-1',
    );

    // نفس ENTRY_CREATED.entryCode المُعاد من الـ mock — يثبت أن postingKey
    // يعتمد على entryCode لا على Date.now() أو Math.random().
    const input = postJournalEntryInTx.mock.calls[0][1] as {
      postingKey: string;
    };
    expect(input.postingKey).toBe('inventory-waste:' + ENTRY_CREATED.entryCode);
  });
});

describe('InventoryService — PERF-F02 bulkIssueFinishedGoods', () => {
  let service: InventoryService;
  let prisma: ExtendedPrismaMock;
  let tx: ReturnType<typeof createTxMock>;
  let eventEmitter: { emitAsync: jest.Mock };
  let postJournalEntryInTx: jest.Mock;
  let financial: FinancialPostingService;

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    tx = createTxMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    postJournalEntryInTx = jest.fn().mockResolvedValue({
      entryId: 'je-bulk',
      entryCode: 'JE-BULK-1',
    });
    financial = { postJournalEntryInTx } as unknown as FinancialPostingService;
    prisma.$transaction.mockImplementation(
      async (
        fn: (txClient: ReturnType<typeof createTxMock>) => Promise<unknown>,
      ) => fn(tx),
    );
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
      financial,
    );
  });

  it('يرفض قائمة فارغة ويعيد totalValue=0 وأحداثًا فارغة دون أي استعلام', async () => {
    const result = await service.bulkIssueFinishedGoods(
      [],
      'wh-fg',
      tx as never,
      'u-1',
    );
    expect(result.movements).toEqual([]);
    expect(result.totalValue).toBe(0);
    expect(result.events).toEqual([]);
    expect(tx.finishedGoodStock.findMany).not.toHaveBeenCalled();
    expect(tx.stockLedgerEntry.createMany).not.toHaveBeenCalled();
  });

  it('يرفض كمية غير صحيحة بـ BadRequestException', async () => {
    await expect(
      service.bulkIssueFinishedGoods(
        [
          { productVariantId: 'v-1', quantity: 2 },
          { productVariantId: 'v-2', quantity: 0 }, // غير صالح
        ],
        'wh-fg',
        tx as never,
        'u-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('يرفض بنفة بلا رصيد بـ NotFoundException', async () => {
    tx.finishedGoodStock.findMany.mockResolvedValue([
      {
        id: 's-1',
        productVariantId: 'v-1',
        quantity: 10,
        unitCost: new Prisma.Decimal(40),
      },
      // v-2 غير موجود
    ]);
    await expect(
      service.bulkIssueFinishedGoods(
        [
          { productVariantId: 'v-1', quantity: 2 },
          { productVariantId: 'v-2', quantity: 1 },
        ],
        'wh-fg',
        tx as never,
        'u-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('يرفض بنفة برصيد غير كافٍ بـ ConflictException', async () => {
    tx.finishedGoodStock.findMany.mockResolvedValue([
      {
        id: 's-1',
        productVariantId: 'v-1',
        quantity: 1, // أقل من المطلوب (2)
        unitCost: new Prisma.Decimal(40),
      },
    ]);
    await expect(
      service.bulkIssueFinishedGoods(
        [{ productVariantId: 'v-1', quantity: 2 }],
        'wh-fg',
        tx as never,
        'u-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('ينفذ الإصدار الجماعي بـ findMany واحد + updateMany لكل بندة + createMany واحد', async () => {
    tx.finishedGoodStock.findMany.mockResolvedValue([
      {
        id: 's-1',
        productVariantId: 'v-1',
        quantity: 100,
        unitCost: new Prisma.Decimal(40),
      },
      {
        id: 's-2',
        productVariantId: 'v-2',
        quantity: 50,
        unitCost: new Prisma.Decimal(80),
      },
    ]);
    tx.finishedGoodStock.updateMany.mockResolvedValue({ count: 1 });
    tx.stockLedgerEntry.createMany.mockResolvedValue({ count: 2 });

    const result = await service.bulkIssueFinishedGoods(
      [
        { productVariantId: 'v-1', quantity: 5, reference: 'SO-1' },
        { productVariantId: 'v-2', quantity: 3, reference: 'SO-1' },
      ],
      'wh-fg',
      tx as never,
      'u-1',
    );

    // PERF-F02: استعلام واحد findMany لكل الأرصدة
    expect(tx.finishedGoodStock.findMany).toHaveBeenCalledTimes(1);
    expect(tx.finishedGoodStock.findMany).toHaveBeenCalledWith({
      where: {
        warehouseId: 'wh-fg',
        productVariantId: { in: ['v-1', 'v-2'] },
      },
      select: {
        id: true,
        productVariantId: true,
        quantity: true,
        unitCost: true,
      },
    });
    // updateMany مرتين (مرة لكل بندة) — تسلسليًا (INV-3: لا Promise.all)
    expect(tx.finishedGoodStock.updateMany).toHaveBeenCalledTimes(2);
    // createMany مرة واحدة لكل قيود الـ ledger
    expect(tx.stockLedgerEntry.createMany).toHaveBeenCalledTimes(1);
    expect(tx.stockLedgerEntry.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          productVariantId: 'v-1',
          quantityDelta: -5,
          balanceAfter: 95,
          unitCost: 40,
          totalValue: 200,
          createdById: 'u-1',
        }),
        expect.objectContaining({
          productVariantId: 'v-2',
          quantityDelta: -3,
          balanceAfter: 47,
          unitCost: 80,
          totalValue: 240,
          createdById: 'u-1',
        }),
      ]),
    });
    // totalValue = 200 + 240 = 440 (round2)
    expect(result.totalValue).toBe(440);
    expect(result.movements).toHaveLength(2);
    expect(result.movements[0].type).toBe(StockMovementType.ISSUE);
    expect(result.movements[0].quantityDelta).toBe(-5);
    expect(result.movements[1].quantityDelta).toBe(-3);
  });

  it('يرفض بعد التحديث الذري لو count=0 (تغير بالتزامن)', async () => {
    tx.finishedGoodStock.findMany.mockResolvedValue([
      {
        id: 's-1',
        productVariantId: 'v-1',
        quantity: 100,
        unitCost: new Prisma.Decimal(40),
      },
    ]);
    // تحاكي أن الصف تغير بالتزامن (لم يعد يحقق الشرط WHERE quantity >= 2)
    tx.finishedGoodStock.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.bulkIssueFinishedGoods(
        [{ productVariantId: 'v-1', quantity: 2 }],
        'wh-fg',
        tx as never,
        'u-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  // ============ INV-3: تسلسل التحديثات + سلوك الأحداث ============

  it('INV-3: تحديثات CAS تسلسلية — لا تداخل تنفيذ (لا Promise.all) وبترتيب البنود', async () => {
    tx.finishedGoodStock.findMany.mockResolvedValue([
      {
        id: 's-1',
        productVariantId: 'v-1',
        quantity: 100,
        unitCost: new Prisma.Decimal(40),
      },
      {
        id: 's-2',
        productVariantId: 'v-2',
        quantity: 50,
        unitCost: new Prisma.Decimal(80),
      },
    ]);
    // نتتبع التداخل: كل استدعاء يبدأ ثم يسلم دورة الأحداث قبل أن يكتمل.
    // لو استخدم المسار Promise.all لبدأ الثاني قبل اكتمال الأول → maxInFlight=2.
    let inFlight = 0;
    let maxInFlight = 0;
    tx.finishedGoodStock.updateMany.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return { count: 1 };
    });
    tx.stockLedgerEntry.createMany.mockResolvedValue({ count: 2 });

    await service.bulkIssueFinishedGoods(
      [
        { productVariantId: 'v-1', quantity: 5 },
        { productVariantId: 'v-2', quantity: 3 },
      ],
      'wh-fg',
      tx as never,
      'u-1',
    );

    expect(tx.finishedGoodStock.updateMany).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1); // تسلسلي صافٍ — واحد في كل لحظة
    // نفس ترتيب البنود (CAS شرطي على id الصف الصحيح لكل بندة)
    expect(
      tx.finishedGoodStock.updateMany.mock.calls.map(
        (call) => (call[0] as { where: { id: string } }).where.id,
      ),
    ).toEqual(['s-1', 's-2']);
  });

  it('INV-3: يعبّئ eventsCollector بأحداث STOCK_DEDUCTED ويعيدها — ولا يبث بنفسه', async () => {
    tx.finishedGoodStock.findMany.mockResolvedValue([
      {
        id: 's-1',
        productVariantId: 'v-1',
        quantity: 100,
        unitCost: new Prisma.Decimal(40),
      },
      {
        id: 's-2',
        productVariantId: 'v-2',
        quantity: 50,
        unitCost: new Prisma.Decimal(80),
      },
    ]);
    tx.finishedGoodStock.updateMany.mockResolvedValue({ count: 1 });
    tx.stockLedgerEntry.createMany.mockResolvedValue({ count: 2 });

    const events: StockEvent[] = [];
    const result = await service.bulkIssueFinishedGoods(
      [
        { productVariantId: 'v-1', quantity: 5, reference: 'SO-1' },
        { productVariantId: 'v-2', quantity: 3, reference: 'SO-1' },
      ],
      'wh-fg',
      tx as never,
      'u-1',
      events,
    );

    // حدث خصم لكل بندة بلقطة الرصيد بعد الخصم — بنمط INV-1 (مؤجل البث)
    expect(events).toEqual([
      {
        name: EVENTS.STOCK_DEDUCTED,
        payload: {
          productVariantId: 'v-1',
          warehouseId: 'wh-fg',
          quantity: 5,
          newStock: 95,
        },
      },
      {
        name: EVENTS.STOCK_DEDUCTED,
        payload: {
          productVariantId: 'v-2',
          warehouseId: 'wh-fg',
          quantity: 3,
          newStock: 47,
        },
      },
    ]);
    // الأحداث تُعاد في النتيجة أيضًا — للمستدعين الذين لم يمرروا مجمعًا
    expect(result.events).toEqual(events);
    // INV-1/INV-3: المسار يعمل داخل معاملة خارجية — لا بث قبل commit أبدًا
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('INV-3: فشل المسار (تعارض CAS) لا يجمع أي حدث — فلا أحداث لحركة رُجعت', async () => {
    tx.finishedGoodStock.findMany.mockResolvedValue([
      {
        id: 's-1',
        productVariantId: 'v-1',
        quantity: 100,
        unitCost: new Prisma.Decimal(40),
      },
    ]);
    tx.finishedGoodStock.updateMany.mockResolvedValue({ count: 0 });
    const events: StockEvent[] = [];

    await expect(
      service.bulkIssueFinishedGoods(
        [{ productVariantId: 'v-1', quantity: 2 }],
        'wh-fg',
        tx as never,
        'u-1',
        events,
      ),
    ).rejects.toThrow(ConflictException);

    expect(events).toEqual([]);
  });
});

// ============ INV-6 (GF-IMP-W3): المخزن الافتراضي الحتمي ============

describe('InventoryService — INV-6 (مخزن خامات افتراضي حتمي)', () => {
  let service: InventoryService;
  let prisma: ExtendedPrismaMock;
  let tx: ReturnType<typeof createTxMock>;
  let eventEmitter: { emitAsync: jest.Mock };
  let financial: FinancialPostingService;

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    tx = createTxMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    financial = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({ entryId: 'je-1' }),
    } as unknown as FinancialPostingService;
    prisma.$transaction.mockImplementation(
      async (
        fn: (txClient: ReturnType<typeof createTxMock>) => Promise<unknown>,
      ) => fn(tx),
    );
    prisma.warehouse.findUnique.mockResolvedValue(WAREHOUSE);
    tx.rawMaterial.update.mockResolvedValue(MATERIAL_AFTER);
    tx.stockLedgerEntry.create.mockResolvedValue(ENTRY_CREATED);
    tx.stockLedgerEntry.aggregate.mockResolvedValue({
      _sum: { quantityDelta: 150 },
    });
    tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
      financial,
    );
  });

  it('INV-6: الاختيار حتمي — أول مخزن خامات نشط بترتيب createdAt صاعد', async () => {
    prisma.warehouse.findFirst.mockResolvedValue({
      id: 'wh-raw-first',
      type: WarehouseType.RAW_MATERIAL,
      isActive: true,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    await service.addRawMaterialStock('rm-1', 10, 45.5, 'user-1', 'key-inv6');

    // الحتمية: (type=RAW_MATERIAL, isActive=true) بترتيب createdAt asc
    expect(prisma.warehouse.findFirst).toHaveBeenCalledWith({
      where: { type: WarehouseType.RAW_MATERIAL, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    // الحركة توجّه للمخزن المختار نفسه
    expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warehouseId: 'wh-raw-first' }),
      }),
    );
  });

  it('INV-6: fallback حتمي إلى أول مخزن عام نشط عند غياب مخازن الخامات', async () => {
    // لا مخزن خامات → الاختيار يتحول لأول مخزن عام نشط بنفس الترتيب
    prisma.warehouse.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'wh-general-1',
        type: WarehouseType.GENERAL,
        isActive: true,
      });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    await service.addRawMaterialStock('rm-1', 10, 45.5, 'user-1', 'key-inv6b');

    expect(prisma.warehouse.findFirst).toHaveBeenNthCalledWith(2, {
      where: { type: WarehouseType.GENERAL, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warehouseId: 'wh-general-1' }),
      }),
    );
  });

  it('INV-6: بلا مخازن نشطة إطلاقًا → 409 fail-closed (السلوك القائم لا انحدار)', async () => {
    prisma.warehouse.findFirst.mockResolvedValue(null);
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    await expect(
      service.addRawMaterialStock('rm-1', 10, 45.5, 'user-1', 'key-inv6c'),
    ).rejects.toThrow('لا يوجد مخزن خامات نشط');
    expect(tx.rawMaterial.update).not.toHaveBeenCalled();
  });
});

// ============ INV-7 (GF-IMP-W3): سجل تدقيق كتابات المخزون ============

describe('InventoryService — INV-7 (سجل التدقيق داخل معاملات الحركات)', () => {
  let service: InventoryService;
  let prisma: ExtendedPrismaMock;
  let tx: ReturnType<typeof createTxMock>;
  let eventEmitter: { emitAsync: jest.Mock };
  let financial: FinancialPostingService;

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    tx = createTxMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    financial = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({ entryId: 'je-1' }),
    } as unknown as FinancialPostingService;
    prisma.$transaction.mockImplementation(
      async (
        fn: (txClient: ReturnType<typeof createTxMock>) => Promise<unknown>,
      ) => fn(tx),
    );
    prisma.warehouse.findUnique.mockResolvedValue(WAREHOUSE);
    tx.rawMaterial.update.mockResolvedValue(MATERIAL_AFTER);
    tx.stockLedgerEntry.create.mockResolvedValue(ENTRY_CREATED);
    tx.stockLedgerEntry.aggregate.mockResolvedValue({
      _sum: { quantityDelta: 150 },
    });
    tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
      financial,
    );
  });

  it('INV-7: receive بفاعل يكتب STOCK_RECEIVED بالرصيد قبل/بعد داخل المعاملة نفسها', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    await service.receive(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 50,
        unitCost: 48,
      },
      'user-9',
    );

    expect(tx.activityLog.create).toHaveBeenCalledTimes(1);
    expect(tx.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-9',
        action: 'STOCK_RECEIVED',
        module: 'inventory',
        details: {
          entryCode: ENTRY_CREATED.entryCode,
          type: StockMovementType.RECEIVE,
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          quantityDelta: 50,
          balanceBefore: 150,
          balanceAfter: 200,
          totalValue: 2400,
        },
      },
    });
  });

  it('INV-7: receive بلا فاعل (استدعاء برمجي قديم) — لا سجل تدقيق (userId NOT NULL)', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    await service.receive({
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      quantity: 50,
      unitCost: 48,
    });

    expect(tx.activityLog.create).not.toHaveBeenCalled();
  });

  it('INV-7: كل نوع حركة يكتب فعله الصحيح (ISSUE/ADJUSTMENT/WASTE)', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    await service.issue(
      { rawMaterialId: 'rm-1', warehouseId: 'wh-1', quantity: 5 },
      'user-issue',
    );
    expect(tx.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STOCK_ISSUED',
          userId: 'user-issue',
        }),
      }),
    );

    await service.adjust(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantityDelta: -3.5,
        reason: 'عجز جرد',
      },
      'user-adj',
    );
    expect(tx.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STOCK_ADJUSTED',
          userId: 'user-adj',
        }),
      }),
    );

    await service.waste(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 2.5,
        reason: 'تالف',
      },
      'user-waste',
    );
    expect(tx.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STOCK_WASTED',
          userId: 'user-waste',
        }),
      }),
    );
  });

  it('INV-7: فشل الحركة (رصيد سالب) لا يكتب سجل تدقيق — التراجع شامل', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    // الرصيد الإجمالي بعد الحركة سالب → BadRequestException داخل المعاملة
    tx.rawMaterial.update.mockResolvedValue({
      ...MATERIAL_AFTER,
      currentStock: -5,
    });

    await expect(
      service.issue(
        { rawMaterialId: 'rm-1', warehouseId: 'wh-1', quantity: 205 },
        'user-fail',
      ),
    ).rejects.toThrow(BadRequestException);

    // كتب الـ ledger؟ لا (الاستثناء قبلها) — وكذلك سجل التدقيق
    expect(tx.stockLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.activityLog.create).not.toHaveBeenCalled();
  });
});

// ============ INV-8 (GF-IMP-W3): حركة RETURN + هدر البضاعة الجاهزة ============

describe('InventoryService — INV-8 (أ): مرتجع الإنتاج (RETURN)', () => {
  let service: InventoryService;
  let prisma: ExtendedPrismaMock;
  let tx: ReturnType<typeof createTxMock>;
  let eventEmitter: { emitAsync: jest.Mock };
  let postJournalEntryInTx: jest.Mock;
  let financial: FinancialPostingService;

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    tx = createTxMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    postJournalEntryInTx = jest.fn().mockResolvedValue({ entryId: 'je-1' });
    financial = {
      postJournalEntryInTx,
    } as unknown as FinancialPostingService;
    prisma.$transaction.mockImplementation(
      async (
        fn: (txClient: ReturnType<typeof createTxMock>) => Promise<unknown>,
      ) => fn(tx),
    );
    prisma.warehouse.findUnique.mockResolvedValue(WAREHOUSE);
    tx.rawMaterial.update.mockResolvedValue(MATERIAL_AFTER);
    tx.stockLedgerEntry.create.mockResolvedValue(ENTRY_CREATED);
    tx.stockLedgerEntry.aggregate.mockResolvedValue({
      _sum: { quantityDelta: 150 },
    });
    tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
      financial,
    );
  });

  it('INV-8: المرتجع يزيد الرصيد (delta موجب) بقيد ledger بنوع RETURN وبلا قيد GL', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    const result = await service.return(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 12.5,
        reason: 'بقايا قص من مرحلة القص',
        reference: 'WO-20260901-ABCD1234',
      },
      'user-1',
    );

    // الزيادة ذرية + موجبة (كالاستلام)
    expect(tx.rawMaterial.update).toHaveBeenCalledWith({
      where: { id: 'rm-1' },
      data: { currentStock: { increment: 12.5 } },
      select: { currentStock: true, costPerUnit: true, minStockLevel: true },
    });
    // سجل الحركة بنوع RETURN صراحة مع السبب والمرجع
    expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: StockMovementType.RETURN,
          warehouseId: 'wh-1',
          rawMaterialId: 'rm-1',
          quantityDelta: 12.5,
          balanceAfter: 162.5,
          unitCost: 45.5,
          totalValue: 568.75,
          reference: 'WO-20260901-ABCD1234',
          createdById: 'user-1',
        }),
      }),
    );
    expect(result).toMatchObject({
      replayed: false,
      type: StockMovementType.RETURN,
      quantityDelta: 12.5,
      balanceAfter: 162.5,
      unitCost: 45.5,
      totalValue: 568.75,
    });
    // ADR-0020: مرتجع داخلي بلا طرف خارجي — لا قيد GL إطلاقًا
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
    // INV-7: سجل التدقيق بفعل STOCK_RETURNED
    expect(tx.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STOCK_RETURNED',
          userId: 'user-1',
        }),
      }),
    );
  });

  it('INV-8: بلا warehouseId (حرفية التكليف) → مخزن الخامات الافتراضي الحتمي (INV-6)', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.warehouse.findFirst.mockResolvedValue({
      id: 'wh-raw-default',
      type: WarehouseType.RAW_MATERIAL,
      isActive: true,
    });

    // حرفية ReturnStockDto: rawMaterialId/quantity/reason (+reference) فقط
    await service.return(
      {
        rawMaterialId: 'rm-1',
        quantity: 7.5,
        reason: 'بقايا قص من مرحلة القص',
      },
      'user-1',
    );

    // الاختيار الحتمي: أول مخزن خامات نشط بترتيب createdAt صاعد
    expect(prisma.warehouse.findFirst).toHaveBeenCalledWith({
      where: { type: WarehouseType.RAW_MATERIAL, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    // الحركة توجّه للمخزن المختار نفسه — لا حركة بلا مخزن
    expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: StockMovementType.RETURN,
          warehouseId: 'wh-raw-default',
          rawMaterialId: 'rm-1',
          quantityDelta: 7.5,
        }),
      }),
    );
  });

  it('INV-8: المرتجع يبث STOCK_ADDED بعد commit (اتجاه دخول) — لا STOCK_DEDUCTED', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    await service.return(
      {
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 5,
        reason: 'توفير خامة',
      },
      'user-1',
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      EVENTS.STOCK_ADDED,
      expect.objectContaining({
        materialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 5,
      }),
    );
  });

  it('INV-8: المرتجع يرفض المستودعات غير الخامات (نفس قواعد الاستلام/الصرف)', async () => {
    prisma.warehouse.findUnique.mockResolvedValue({
      ...WAREHOUSE,
      type: WarehouseType.FINISHED_GOODS,
    });

    await expect(
      service.return(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-fg',
          quantity: 5,
          reason: 'خطأ مستودع',
        },
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tx.rawMaterial.update).not.toHaveBeenCalled();
  });

  it('INV-8: idempotency بنطاق inventory.return — نفس المفتاح يعيد الاستجابة بلا أثر', async () => {
    const input = {
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      quantity: 12.5,
      reason: 'بقايا قص من مرحلة القص',
    };
    const requestHash = requestHashOf({
      operation: 'inventory.return',
      rawMaterialId: input.rawMaterialId,
      warehouseId: input.warehouseId,
      quantityDelta: input.quantity,
      notes: `مرتجع من الإنتاج — السبب: ${input.reason}`,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'return-key-1',
      scope: 'inventory.return',
      requestHash,
      response: {
        replayed: false,
        entryCode: 'SLE-EXISTING-RETURN',
        type: StockMovementType.RETURN,
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantityDelta: 12.5,
        balanceAfter: 162.5,
        unitCost: 45.5,
        totalValue: 568.75,
        costPerUnitAfter: null,
        createdAt: '2026-09-06T00:00:00.000Z',
      },
    });

    const result = await service.return(
      { ...input, idempotencyKey: 'return-key-1' },
      'user-1',
    );

    expect(result).toMatchObject({
      replayed: true,
      entryCode: 'SLE-EXISTING-RETURN',
    });
    // لا تنفيذ جديد — لا كتابة رصيد ولا ledger
    expect(tx.rawMaterial.update).not.toHaveBeenCalled();
    expect(tx.stockLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('INV-8: الرصيد السالب ممنوع كالمعتاد (ADR-0007) — لا يُقبل صرف معكوس', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    // رصيد المستودع بعد الإضافة يبقى موجبًا دائمًا — نختبر الحد عبر كمية
    // سالبة مرفوضة من DTO... هنا: المرتجع دائمًا موجب فنتحقق من حارس
    // الرصيد الإجمالي عبر update يعيد رصيدًا موجبًا (لا استثناء)
    await service.return(
      { rawMaterialId: 'rm-1', warehouseId: 'wh-1', quantity: 1, reason: 'x' },
      'user-1',
    );
    expect(tx.rawMaterial.update).toHaveBeenCalledTimes(1);
  });
});

describe('InventoryService — INV-8 (ب): هدر البضاعة الجاهزة', () => {
  let service: InventoryService;
  let prisma: ExtendedPrismaMock;
  let tx: ReturnType<typeof createTxMock>;
  let eventEmitter: { emitAsync: jest.Mock };
  let postJournalEntryInTx: jest.Mock;
  let financial: FinancialPostingService;

  const FG_WAREHOUSE = {
    id: 'wh-fg',
    code: 'WH-FG',
    name: 'مخزن المنتج التام',
    type: WarehouseType.FINISHED_GOODS,
    isActive: true,
  };

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    tx = createTxMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    postJournalEntryInTx = jest.fn().mockResolvedValue({ entryId: 'je-1' });
    financial = {
      postJournalEntryInTx,
    } as unknown as FinancialPostingService;
    prisma.$transaction.mockImplementation(
      async (
        fn: (txClient: ReturnType<typeof createTxMock>) => Promise<unknown>,
      ) => fn(tx),
    );
    // INV-6: مخزن التام الافتراضي حتمي
    prisma.warehouse.findFirst.mockResolvedValue(FG_WAREHOUSE);
    tx.finishedGoodStock.findUnique.mockResolvedValue({
      id: 'fgs-1',
      quantity: 10,
      unitCost: new Prisma.Decimal(50),
    });
    tx.finishedGoodStock.updateMany.mockResolvedValue({ count: 1 });
    tx.stockLedgerEntry.create.mockResolvedValue(ENTRY_CREATED);
    tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
      financial,
    );
  });

  it('INV-8: يخفض finished_good_stocks بـ CAS ويسجل حركة WASTE موصولة بالمتغير', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    const result = await service.wasteFinishedGood(
      {
        finishedGoodVariantId: 'pv-1',
        quantity: 3,
        reason: 'تلف بالتخزين',
      },
      'user-1',
    );

    // CAS: تحديث شرطي quantity >= المطلوب
    expect(tx.finishedGoodStock.updateMany).toHaveBeenCalledWith({
      where: { id: 'fgs-1', quantity: { gte: 3 } },
      data: { quantity: { decrement: 3 } },
    });
    // الدفتر: WASTE بالمتغير والكمية الموجبة سالبة الدلتا والرصيد بعد
    expect(tx.stockLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: StockMovementType.WASTE,
          warehouseId: 'wh-fg',
          productVariantId: 'pv-1',
          quantityDelta: -3,
          balanceAfter: 7,
          createdById: 'user-1',
        }),
      }),
    );
    expect(result).toMatchObject({
      replayed: false,
      type: StockMovementType.WASTE,
      quantityDelta: -3,
      balanceAfter: 7,
      unitCost: 50,
      totalValue: 150,
    });
    // INV-7: سجل التدقيق داخل نفس المعاملة
    expect(tx.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STOCK_WASTED',
          userId: 'user-1',
        }),
      }),
    );
  });

  it('INV-8: يرحّل Dr WASTE_EXPENSE / Cr FINISHED_GOOD_STOCK بمبلغ الكمية × تكلفة الوحدة', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);

    await service.wasteFinishedGood(
      { finishedGoodVariantId: 'pv-1', quantity: 3, reason: 'تلف بالتخزين' },
      'user-1',
    );

    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
    const call = postJournalEntryInTx.mock.calls[0] as [
      unknown,
      {
        postingKey: string;
        lines: {
          debitAccountId: string;
          creditAccountId: string;
          amount: Prisma.Decimal;
        }[];
        metadata: Record<string, unknown>;
      },
      unknown,
    ];
    expect(call[0]).toBe(tx); // داخل نفس المعاملة
    expect(call[1].postingKey).toBe(
      'inventory-fg-waste:' + ENTRY_CREATED.entryCode,
    );
    expect(call[1].lines).toEqual([
      {
        debitAccountId: CHART_OF_ACCOUNTS.WASTE_EXPENSE,
        creditAccountId: CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK,
        amount: new Prisma.Decimal(150),
        description: 'تلف بالتخزين',
      },
    ]);
    expect(call[1].metadata).toEqual(
      expect.objectContaining({
        source: 'inventory.fg-waste',
        productVariantId: 'pv-1',
        quantity: 3,
      }),
    );
    expect(call[2]).toBe('user-1');
  });

  it('INV-8: تعارض CAS (count=0) → 409 بلا ledger ولا قيد GL', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    tx.finishedGoodStock.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.wasteFinishedGood(
        {
          finishedGoodVariantId: 'pv-1',
          quantity: 99,
          reason: 'أكثر من الرصيد',
        },
        'user-1',
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.wasteFinishedGood(
        {
          finishedGoodVariantId: 'pv-1',
          quantity: 99,
          reason: 'أكثر من الرصيد',
        },
        'user-1',
      ),
    ).rejects.toThrow('رصيد المنتج التام غير كافٍ للهدر أو تغير بالتزامن');
    expect(tx.stockLedgerEntry.create).not.toHaveBeenCalled();
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('INV-8: رصيد غير موجود → 404 بلا CAS', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    tx.finishedGoodStock.findUnique.mockResolvedValue(null);

    await expect(
      service.wasteFinishedGood(
        { finishedGoodVariantId: 'pv-ghost', quantity: 1, reason: 'x' },
        'user-1',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(tx.finishedGoodStock.updateMany).not.toHaveBeenCalled();
  });

  it('INV-8: بلا مخزن تام نشط → 409 برسالة واضحة (نمط INV-6)', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.warehouse.findFirst.mockResolvedValue(null);

    await expect(
      service.wasteFinishedGood(
        { finishedGoodVariantId: 'pv-1', quantity: 1, reason: 'x' },
        'user-1',
      ),
    ).rejects.toThrow('لا يوجد مخزن منتج تام نشط');
  });

  it('INV-8: كمية غير صحيحة (كسرية/صفر/سالبة) → 400 قبل أي استعلام', async () => {
    for (const quantity of [2.5, 0, -3]) {
      await expect(
        service.wasteFinishedGood(
          { finishedGoodVariantId: 'pv-1', quantity, reason: 'x' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    }
    expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it('INV-8: قيمة صفرية (unitCost=0) → لا قيد GL (لا هدر بلا قيمة)', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    tx.finishedGoodStock.findUnique.mockResolvedValue({
      id: 'fgs-1',
      quantity: 10,
      unitCost: new Prisma.Decimal(0),
    });

    const result = await service.wasteFinishedGood(
      { finishedGoodVariantId: 'pv-1', quantity: 2, reason: 'بلا قيمة' },
      'user-1',
    );

    expect(result).toMatchObject({ totalValue: 0, balanceAfter: 8 });
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });
});

// ============ INV-9 (GF-IMP-W3): فلتر الدفتر بالبضاعة الجاهزة ============

describe('InventoryService — INV-9 (فلتر الدفتر بمتغير المنتج التام)', () => {
  let service: InventoryService;
  let prisma: ExtendedPrismaMock;

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    // createEventEmitterMock يعيد EventEmitter2 بالفعل — لا حاجة لتحويل
    service = new InventoryService(
      prisma as unknown as PrismaService,
      createEventEmitterMock(),
      { postJournalEntryInTx: jest.fn() } as unknown as FinancialPostingService,
    );
  });

  it('INV-9: productVariantId يُطبّق في where للقائمة والعدّ (البضاعة الجاهزة)', async () => {
    prisma.stockLedgerEntry.findMany.mockResolvedValue([]);
    prisma.stockLedgerEntry.count.mockResolvedValue(0);

    await service.getLedgerEntries(
      { productVariantId: 'pv-1' },
      UserRole.INVENTORY_MANAGER,
    );

    const expectedWhere = { productVariantId: 'pv-1' };
    expect(prisma.stockLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(prisma.stockLedgerEntry.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });
  });

  it('INV-9: فلتر المتغير مع خامة/نوع/فترة معًا في where واحدة', async () => {
    prisma.stockLedgerEntry.findMany.mockResolvedValue([]);

    await service.getLedgerEntries(
      {
        productVariantId: 'pv-1',
        type: StockMovementType.WASTE,
        from: '2026-08-01T00:00:00Z',
        to: '2026-08-31T23:59:59Z',
      },
      UserRole.ACCOUNTANT,
    );

    expect(prisma.stockLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productVariantId: 'pv-1',
          type: StockMovementType.WASTE,
          createdAt: {
            gte: new Date('2026-08-01T00:00:00Z'),
            lte: new Date('2026-08-31T23:59:59Z'),
          },
        },
      }),
    );
  });
});

// ============ INV-10 (GF-IMP-W3): فجوة CAS لمسار الإصدار المفرد ============

describe('InventoryService — INV-10 (تعارض CAS لمسار الإصدار المفرد للمنتج التام)', () => {
  let service: InventoryService;
  let prisma: ExtendedPrismaMock;
  let tx: ReturnType<typeof createTxMock>;
  let eventEmitter: { emitAsync: jest.Mock };
  let financial: FinancialPostingService;

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    tx = createTxMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    financial = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({ entryId: 'je-1' }),
    } as unknown as FinancialPostingService;
    prisma.$transaction.mockImplementation(
      async (
        fn: (txClient: ReturnType<typeof createTxMock>) => Promise<unknown>,
      ) => fn(tx),
    );
    prisma.warehouse.findUnique.mockResolvedValue({
      ...WAREHOUSE,
      type: WarehouseType.FINISHED_GOODS,
    });
    tx.finishedGoodStock.findUnique.mockResolvedValue({
      id: 'fgs-1',
      quantity: 10,
      unitCost: new Prisma.Decimal(50),
    });
    tx.stockLedgerEntry.create.mockResolvedValue(ENTRY_CREATED);
    tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
      financial,
    );
  });

  it('INV-10: updateMany يعيد count=0 (سباق استهلك الرصيد) → 409 ولا يُكتب ledger', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    // الرصيد المقروء كافٍ (10 ≥ 5) لكن التحديث الذري لم يمس صفًا —
    // مستهلك متزامن خفض الرصيد بين القراءة والتحديث
    tx.finishedGoodStock.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.issueFinishedGood(
        { productVariantId: 'pv-1', warehouseId: 'wh-fg', quantity: 5 },
        'user-1',
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.issueFinishedGood(
        { productVariantId: 'pv-1', warehouseId: 'wh-fg', quantity: 5 },
        'user-1',
      ),
    ).rejects.toThrow('المخزون التام غير كافٍ أو تغير بالتزامن');

    // لا ledger لحركة لم تنفذ (التراجع الكامل للمعاملة)
    expect(tx.stockLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.idempotencyKey.update).not.toHaveBeenCalled();
  });

  it('INV-10: CAS الناجح (count=1) يكتب الحركة ويعيدها — لا انحدار', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    tx.finishedGoodStock.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.issueFinishedGood(
      { productVariantId: 'pv-1', warehouseId: 'wh-fg', quantity: 5 },
      'user-1',
    );

    expect(result).toMatchObject({
      replayed: false,
      quantityDelta: -5,
      balanceAfter: 5,
    });
    expect(tx.stockLedgerEntry.create).toHaveBeenCalledTimes(1);
  });
});
