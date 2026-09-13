import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { PackingService } from './packing.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * SELIM-ERP W1 — اختبارات خدمة العبوات.
 *
 * تركّز على قواعد التعبئة (نفس قواعد Selim ERP مع التكيف الموثق):
 * - الترقيم نظامي PACK-0001 وكود العميل يُتجاهل.
 * - البناء يخصم المكونات (كمية × عدد) بحرس رصيد مسبق برسالة المتاح.
 * - البناء/التفكيك يوثّقان في ActivityLog (PACK_BUILD/PACK_UNPACK)
 *   والتكلفة تُسترجع من آخر بناء عند التفكيك.
 * - الحذف يُرفض لأي عبوة لها عمليات بناء.
 */
describe('PackingService — العبوات (SELIM W1)', () => {
  let service: PackingService;
  let prisma: {
    $transaction: jest.Mock;
    pack: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    productVariant: { count: jest.Mock };
    finishedGoodStock: { findUnique: jest.Mock };
    activityLog: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
    };
  };
  let sequence: { nextNumber: jest.Mock };
  let inventory: {
    issueFinishedGood: jest.Mock;
    receiveFinishedGood: jest.Mock;
  };
  const tx: Record<string, unknown> = {};

  const packRow = () => ({
    id: 'pack-1',
    code: 'PACK-0001',
    name: 'سرية 12 قطعة',
    notes: null,
    isActive: true,
    components: [
      { id: 'pc-1', packId: 'pack-1', productVariantId: 'var-1', quantity: 12 },
      { id: 'pc-2', packId: 'pack-1', productVariantId: 'var-2', quantity: 6 },
    ],
  });

  const createDto = {
    code: 'CLIENT-XX',
    name: 'سرية 12 قطعة',
    components: [
      { productVariantId: 'var-1', quantity: 12 },
      { productVariantId: 'var-2', quantity: 6 },
    ],
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn().mockImplementation(async (arg) => {
        if (typeof arg === 'function') return arg(tx);
        return Promise.all(arg);
      }),
      pack: {
        findUnique: jest.fn().mockResolvedValue(packRow()),
        findMany: jest.fn().mockResolvedValue([packRow()]),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'pack-1',
          ...data,
        })),
        update: jest.fn().mockResolvedValue({ id: 'pack-1' }),
      },
      productVariant: { count: jest.fn().mockResolvedValue(2) },
      finishedGoodStock: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'fgs-1',
          quantity: 500,
          unitCost: 40,
        }),
      },
      activityLog: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
    };
    Object.assign(tx, prisma);
    sequence = { nextNumber: jest.fn().mockResolvedValue('PACK-0001') };
    inventory = {
      issueFinishedGood: jest
        .fn()
        .mockResolvedValue({ entryCode: 'SLE-1', unitCost: 40 }),
      receiveFinishedGood: jest
        .fn()
        .mockResolvedValue({ entryCode: 'SLE-2', unitCost: 40 }),
    };
    service = new PackingService(
      prisma as never,
      sequence as unknown as SequenceService,
      inventory as unknown as InventoryService,
    );
  });

  it('يرفض توليفة مكررة في مكونات العبوة', async () => {
    await expect(
      service.create(
        {
          ...createDto,
          components: [
            { productVariantId: 'var-1', quantity: 12 },
            { productVariantId: 'var-1', quantity: 6 },
          ],
        } as never,
        'user-1',
      ),
    ).rejects.toThrow('كل توليفة تظهر مرة واحدة');
  });

  it('يرفض مكونًا غير موجود أو غير نشط', async () => {
    prisma.productVariant.count.mockResolvedValue(1);
    await expect(service.create(createDto as never, 'user-1')).rejects.toThrow(
      'توليفة في مكونات العبوة غير موجودة',
    );
  });

  it('يولّد PACK-0001 نظاميًا ويتجاهل كود العميل', async () => {
    await service.create(createDto as never, 'user-1');
    expect(sequence.nextNumber).toHaveBeenCalledWith('PACK', tx);
    const createCall = prisma.pack.create.mock.calls[0][0];
    expect(createCall.data.code).toBe('PACK-0001');
    expect(createCall.data.name).toBe('سرية 12 قطعة');
    const components = createCall.data.components.create as {
      productVariantId: string;
      quantity: Prisma.Decimal;
    }[];
    // Decimal(12,4) — نقارن رقميًا (نفس أسلوب مواصفات العروض).
    expect(
      components.map((c) => ({
        productVariantId: c.productVariantId,
        quantity: Number(c.quantity),
      })),
    ).toEqual([
      { productVariantId: 'var-1', quantity: 12 },
      { productVariantId: 'var-2', quantity: 6 },
    ]);
  });

  it('يرفض البناء عند عدم كفاية رصيد مكون برسالة المتاح', async () => {
    prisma.finishedGoodStock.findUnique.mockResolvedValue({
      id: 'fgs-1',
      quantity: 30,
      unitCost: 40,
    });
    await expect(
      service.build('pack-1', { warehouseId: 'wh-fg', count: 3 }, 'user-1'),
    ).rejects.toThrow('رصيد المكون غير كافٍ — المتاح: 30 والمطلوب: 36');
    expect(inventory.issueFinishedGood).not.toHaveBeenCalled();
  });

  it('البناء يخصم كل مكون (كمية × عدد) ويسجل PACK_BUILD بالتكلفة', async () => {
    const result = await service.build(
      'pack-1',
      { warehouseId: 'wh-fg', count: 3 },
      'user-1',
    );
    // 12×3=36 و6×3=18 عبر issueFinishedGood بمرجع كود العبوة.
    expect(inventory.issueFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'var-1',
        warehouseId: 'wh-fg',
        quantity: 36,
        reference: 'PACK-0001',
      }),
      'user-1',
      tx,
    );
    expect(inventory.issueFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'var-2',
        quantity: 18,
      }),
      'user-1',
      tx,
    );
    // توثيق التدقيق: PACK_BUILD بتفاصيل تحمل الكمية وتكلفة الوحدة.
    const log = prisma.activityLog.create.mock.calls[0][0].data;
    expect(log.action).toBe('PACK_BUILD');
    expect(log.module).toBe('PACKING');
    expect(log.userId).toBe('user-1');
    expect(log.details.packId).toBe('pack-1');
    expect(log.details.count).toBe(3);
    expect(log.details.components).toEqual([
      { productVariantId: 'var-1', quantity: 36, unitCost: 40 },
      { productVariantId: 'var-2', quantity: 18, unitCost: 40 },
    ]);
    expect(result.builtCount).toBe(3);
  });

  it('يرفض تفكيك عبوة لم تُبنَ بعد', async () => {
    await expect(
      service.unpack('pack-1', { warehouseId: 'wh-fg', count: 2 }, 'user-1'),
    ).rejects.toThrow('لا يمكن تفكيك عبوة لم تُبنَ بعد');
  });

  it('التفكيك يعيد المكونات بتكلفة آخر بناء ويسجل PACK_UNPACK', async () => {
    prisma.activityLog.findFirst.mockResolvedValue({
      details: {
        packId: 'pack-1',
        count: 3,
        components: [
          { productVariantId: 'var-1', quantity: 36, unitCost: 40 },
          { productVariantId: 'var-2', quantity: 18, unitCost: 55 },
        ],
      },
    });
    const result = await service.unpack(
      'pack-1',
      { warehouseId: 'wh-fg', count: 2 },
      'user-1',
    );
    expect(inventory.receiveFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'var-1',
        warehouseId: 'wh-fg',
        quantity: 24,
        unitCost: 40,
        reference: 'PACK-0001',
      }),
      'user-1',
      tx,
    );
    expect(inventory.receiveFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'var-2',
        quantity: 12,
        unitCost: 55,
      }),
      'user-1',
      tx,
    );
    const log = prisma.activityLog.create.mock.calls[0][0].data;
    expect(log.action).toBe('PACK_UNPACK');
    expect(log.details.count).toBe(2);
    expect(result.unpackedCount).toBe(2);
  });

  it('يرفض حذف عبوة لها عمليات بناء موثقة', async () => {
    prisma.activityLog.count.mockResolvedValue(2);
    await expect(service.remove('pack-1')).rejects.toThrow(
      'لا يمكن حذف عبوة لها عمليات بناء موثقة',
    );
    expect(prisma.pack.update).not.toHaveBeenCalled();
  });

  it('يحذف (منطقيًا) عبوة بلا عمليات بناء', async () => {
    prisma.activityLog.count.mockResolvedValue(0);
    const result = await service.remove('pack-1');
    expect(prisma.pack.update).toHaveBeenCalledWith({
      where: { id: 'pack-1' },
      data: { isActive: false },
    });
    expect(result.deleted).toBe(true);
  });

  it('يشتق المتاح من سجل التدقيق (بناء − تفكيك) في القائمة', async () => {
    prisma.activityLog.findMany.mockResolvedValue([
      {
        action: 'PACK_BUILD',
        details: { packId: 'pack-1', count: 5 },
      },
      {
        action: 'PACK_UNPACK',
        details: { packId: 'pack-1', count: 2 },
      },
    ]);
    const result = await service.listPacks({} as never);
    expect(result.items[0].availableCount).toBe(3);
    expect(result.total).toBe(1);
  });
});
