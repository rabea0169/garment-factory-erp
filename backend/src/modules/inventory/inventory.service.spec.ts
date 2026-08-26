/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars */
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType, WarehouseType } from '@prisma/client';
import { InventoryService } from './inventory.service';
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
    },
    stockLedgerEntry: { create: jest.fn(), aggregate: jest.fn() },
    idempotencyKey: { create: jest.fn(), update: jest.fn() },
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
    it('مرشحات خامة/مخزن/نوع/فترة مع حد 200 وترتيب أحدث أولًا', async () => {
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

    it('بلا مرشحات: where فارغة وحد 200 حماية من الاستجابات الضخمة', async () => {
      prisma.stockLedgerEntry.findMany.mockResolvedValue([]);

      await service.getLedgerEntries({});

      expect(prisma.stockLedgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 0, take: 20 }),
      );
    });
  });

  // ============ القراءات القديمة (انحدار GF-0003) ============

  describe('القراءات القديمة (انحدار)', () => {
    it('يجلب كل الخامات مع الموردين مرتبة بالاسم', async () => {
      const materials = [
        { id: 'rm-1', name: 'قماش قطني', supplier: { id: 's-1' } },
      ];
      prisma.rawMaterial.findMany.mockResolvedValue(materials);

      const result = await service.getAllRawMaterials({});

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
