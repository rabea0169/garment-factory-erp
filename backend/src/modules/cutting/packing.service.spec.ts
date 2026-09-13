import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { PackingService } from './packing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { InventoryService } from '../inventory/inventory.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import type { PrismaMock } from '../../../test/helpers/prisma-mock';

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

/** إدخال وسيط لقراءة بيانات إنشاء العبوة (بلا any مسرب — نمط sales). */
interface PackCreateCall {
  data: {
    code: string;
    name: string;
    components: { create: unknown };
  };
}

/** تفاصيل توثيق البناء/التفكيك في سجل التدقيق. */
interface ActivityLogDetails {
  packId: string;
  count: number;
  components: Array<{
    productVariantId: string;
    quantity: number;
    unitCost: number;
  }>;
}

/** إدخال وسيط لقراءة بيانات سجل التدقيق (PACK_BUILD/PACK_UNPACK). */
interface ActivityLogCreateCall {
  data: {
    action: string;
    module: string;
    userId: string;
    details: ActivityLogDetails;
  };
}

/**
 * SELIM-W1: امتداد محلي للـ mock الموحد — التعبئة تحتاج قراءة سجل
 * التدقيق (activityLog.findMany/findFirst/count لاشتقاق المتاح) و
 * productVariant.count للتحقق من المكونات (نمط SalesPrismaMock: لا
 * نغيّر شكل نماذج قائمة في الـ helper المشترك).
 */
type PackingPrismaMock = PrismaMock & {
  activityLog: PrismaMock['activityLog'] & {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
  };
  productVariant: PrismaMock['productVariant'] & { count: jest.Mock };
};

function createPackingPrismaMock(): PackingPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
    activityLog: {
      ...base.activityLog,
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    productVariant: { ...base.productVariant, count: jest.fn() },
  };
}

describe('PackingService — العبوات (SELIM W1)', () => {
  let service: PackingService;
  let prisma: PackingPrismaMock;
  let nextNumber: jest.Mock;
  let issueFinishedGood: jest.Mock;
  let receiveFinishedGood: jest.Mock;
  // tx يشترك مع prisma في نفس الـ mocks (المعاملة تمر على نفس الوكيل).
  const tx = {} as unknown as PackingPrismaMock;

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
    prisma = createPackingPrismaMock();
    prisma.$transaction.mockImplementation(
      (
        arg: ((client: PackingPrismaMock) => Promise<unknown>) | unknown[],
      ): Promise<unknown> =>
        typeof arg === 'function' ? arg(tx) : Promise.all(arg),
    );
    prisma.pack.findUnique.mockResolvedValue(packRow());
    prisma.pack.findMany.mockResolvedValue([packRow()]);
    prisma.pack.count.mockResolvedValue(1);
    prisma.pack.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'pack-1',
        ...data,
      }),
    );
    prisma.pack.update.mockResolvedValue({ id: 'pack-1' });
    prisma.productVariant.count.mockResolvedValue(2);
    prisma.finishedGoodStock.findUnique.mockResolvedValue({
      id: 'fgs-1',
      quantity: 500,
      unitCost: 40,
    });
    prisma.activityLog.findMany.mockResolvedValue([]);
    prisma.activityLog.findFirst.mockResolvedValue(null);
    prisma.activityLog.count.mockResolvedValue(0);
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });
    Object.assign(tx, prisma);
    nextNumber = jest.fn().mockResolvedValue('PACK-0001');
    const sequence = { nextNumber } as unknown as SequenceService;
    issueFinishedGood = jest
      .fn()
      .mockResolvedValue({ entryCode: 'SLE-1', unitCost: 40 });
    receiveFinishedGood = jest
      .fn()
      .mockResolvedValue({ entryCode: 'SLE-2', unitCost: 40 });
    const inventory = {
      issueFinishedGood,
      receiveFinishedGood,
    } as unknown as InventoryService;
    service = new PackingService(
      prisma as unknown as PrismaService,
      sequence,
      inventory,
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
        },
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
    await service.create(createDto, 'user-1');
    expect(nextNumber).toHaveBeenCalledWith('PACK', tx);
    const createCall = (
      prisma.pack.create.mock.calls as unknown as Array<[PackCreateCall]>
    )[0][0];
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
    expect(issueFinishedGood).not.toHaveBeenCalled();
  });

  it('البناء يخصم كل مكون (كمية × عدد) ويسجل PACK_BUILD بالتكلفة', async () => {
    const result = await service.build(
      'pack-1',
      { warehouseId: 'wh-fg', count: 3 },
      'user-1',
    );
    // 12×3=36 و6×3=18 عبر issueFinishedGood بمرجع كود العبوة.
    expect(issueFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'var-1',
        warehouseId: 'wh-fg',
        quantity: 36,
        reference: 'PACK-0001',
      }),
      'user-1',
      tx,
    );
    expect(issueFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'var-2',
        quantity: 18,
      }),
      'user-1',
      tx,
    );
    // توثيق التدقيق: PACK_BUILD بتفاصيل تحمل الكمية وتكلفة الوحدة.
    const log = (
      prisma.activityLog.create.mock.calls as unknown as Array<
        [ActivityLogCreateCall]
      >
    )[0][0].data;
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
    expect(receiveFinishedGood).toHaveBeenCalledWith(
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
    expect(receiveFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'var-2',
        quantity: 12,
        unitCost: 55,
      }),
      'user-1',
      tx,
    );
    const log = (
      prisma.activityLog.create.mock.calls as unknown as Array<
        [ActivityLogCreateCall]
      >
    )[0][0].data;
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
    const result = await service.listPacks({});
    expect(result.items[0].availableCount).toBe(3);
    expect(result.total).toBe(1);
  });
});
