import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StockMovementType, WarehouseType } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
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
  stockLedgerEntry: { create: jest.Mock; findMany: jest.Mock };
  idempotencyKey: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

function createTxMock() {
  return {
    rawMaterial: { update: jest.fn() },
    stockLedgerEntry: { create: jest.fn() },
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
    },
    stockLedgerEntry: { create: jest.fn(), findMany: jest.fn() },
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
  let eventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    prisma = createInventoryPrismaMock();
    tx = createTxMock();
    eventEmitter = createEventEmitterMock() as unknown as { emit: jest.Mock };
    prisma.$transaction.mockImplementation(
      async (
        fn: (txClient: ReturnType<typeof createTxMock>) => Promise<unknown>,
      ) => fn(tx),
    );
    // مخزن خامات نشط صالح افتراضيًا
    prisma.warehouse.findUnique.mockResolvedValue(WAREHOUSE);
    tx.rawMaterial.update.mockResolvedValue(MATERIAL_AFTER);
    tx.stockLedgerEntry.create.mockResolvedValue(ENTRY_CREATED);
    tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    service = new InventoryService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
    );
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

      expect(eventEmitter.emit).toHaveBeenCalledWith(EVENTS.STOCK_ADDED, {
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

      await service.issue(
        { rawMaterialId: 'rm-1', warehouseId: 'wh-1', quantity: 10 },
        'user-1',
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(EVENTS.STOCK_DEDUCTED, {
        materialId: 'rm-1',
        warehouseId: 'wh-1',
        quantity: 10,
        newStock: 40,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(EVENTS.STOCK_LOW, {
        materialId: 'rm-1',
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

      const result = await service.getWarehouses();

      expect(result).toEqual(warehouses);
      expect(prisma.warehouse.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      });
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
      expect(eventEmitter.emit).toHaveBeenCalledWith(EVENTS.STOCK_ADDED, {
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

      expect(result).toEqual(entries);
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
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    });

    it('بلا مرشحات: where فارغة وحد 200 حماية من الاستجابات الضخمة', async () => {
      prisma.stockLedgerEntry.findMany.mockResolvedValue([]);

      await service.getLedgerEntries({});

      expect(prisma.stockLedgerEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, take: 200 }),
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

      const result = await service.getAllRawMaterials();

      expect(result).toEqual(materials);
      expect(prisma.rawMaterial.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { supplier: true },
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('يعرض فقط الخامات التي رصيدها عند حد الطلب أو أقل (low stock)', async () => {
      prisma.rawMaterial.findMany.mockResolvedValue([
        { id: 'rm-1', currentStock: 5, minStockLevel: 20 }, // منخفض
        { id: 'rm-2', currentStock: 50, minStockLevel: 20 }, // سليم
        { id: 'rm-3', currentStock: 20, minStockLevel: 20 }, // عند الحد بالضبط = منخفض
      ]);

      const result = await service.getLowStockMaterials();

      expect(result.map((m) => m.id)).toEqual(['rm-1', 'rm-3']);
    });

    it('يجلب المنتج التام مع الـ variant والمنتج', async () => {
      const goods = [{ id: 'fg-1', variant: { product: { name: 'تيشيرت' } } }];
      prisma.finishedGood.findMany.mockResolvedValue(goods);

      const result = await service.getAllFinishedGoods();

      expect(result).toEqual(goods);
      expect(prisma.finishedGood.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { variant: { include: { product: true } } },
        }),
      );
    });

    it('الملخص يجمع العدادات: خامات + منخفض + أنواع منتج تام', async () => {
      prisma.rawMaterial.count.mockResolvedValue(10);
      prisma.rawMaterial.findMany.mockResolvedValue([
        { currentStock: 1, minStockLevel: 5 },
        { currentStock: 2, minStockLevel: 5 },
        { currentStock: 100, minStockLevel: 5 },
      ]);
      prisma.finishedGood.count.mockResolvedValue(4);

      const result = await service.getDashboardSummary();

      expect(result).toEqual({
        totalMaterials: 10,
        lowStockMaterials: 2,
        totalFinishedGoodsTypes: 4,
      });
    });
  });
});
