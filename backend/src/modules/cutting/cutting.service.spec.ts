import 'reflect-metadata';
import { CuttingOrderStatus, Prisma, WarehouseType } from '@prisma/client';
import { CuttingService } from './cutting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { InventoryService } from '../inventory/inventory.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import type { PrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * SELIM-ERP W1 — اختبارات خدمة القص.
 *
 * تركّز على قواعد المجال (نفس قواعد Selim ERP):
 * - الكميات والإجماليات تُحسب على الخادم من البنود، والقطع الصحيحة شرط.
 * - المسودة بلا حركات؛ التفعيل فقط يحرك المخزون (صرف مصدر + إدخال
 *   توليفات + أجر عامل) داخل معاملة واحدة.
 * - تفعيل أمر برصيد غير كافٍ يُرفض برسالة المتاح.
 * - العكس يرد كل الحركات من دفتر StockLedgerEntry (reference = رقم
 *   المستند) ويحذف سجل الأجر.
 */

/** إدخال وسيط لقراءة بيانات إنشاء أمر القص (بلا any مسرب — نمط sales). */
interface CuttingOrderCreateCall {
  data: {
    totalPieces: number;
    totalLays: number;
    wageTotal: number;
    wagePerPiece: number | null;
    status: CuttingOrderStatus;
    // بنود الإنشاء المتداخلة — يُلوّب نوعها عند القراءة حسب الاختبار
    lines: { create: unknown };
  };
}

/** مدخلات صرف المصدر عبر InventoryService (التوليفة/الكمية/المرجع). */
interface IssueFinishedGoodCall {
  productVariantId: string;
  quantity: number;
  reference: string;
}

/** بيانات سجل أجر القص (DailyProduction). */
interface DailyProductionData {
  workerId: string;
  piecesCount: number;
  totalAmount: number;
  notes: string;
}

/**
 * SELIM-W1: امتداد محلي للـ mock الموحد — القص يحتاج طرقًا إضافية
 * على نماذج قائمة: productVariant.findUnique/count (اختيار/إنشاء
 * التوليفة الهدف)، finishedGoodStock.findFirst/update (أكبر رصيد +
 * استرجاع المصدر عند العكس)، وdailyProduction.findFirst/delete
 * (سجل الأجر) — بنمط SalesPrismaMock: لا نغيّر شكل نماذج قائمة في
 * الـ helper المشترك حفاظًا على توابق بقية المواصفات.
 */
type CuttingPrismaMock = PrismaMock & {
  productVariant: PrismaMock['productVariant'] & {
    findUnique: jest.Mock;
    count: jest.Mock;
  };
  finishedGoodStock: PrismaMock['finishedGoodStock'] & {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  dailyProduction: PrismaMock['dailyProduction'] & {
    findFirst: jest.Mock;
    delete: jest.Mock;
  };
};

function createCuttingPrismaMock(): CuttingPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
    productVariant: {
      ...base.productVariant,
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    finishedGoodStock: {
      ...base.finishedGoodStock,
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    dailyProduction: {
      ...base.dailyProduction,
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };
}

describe('CuttingService — أوامر القص (SELIM W1)', () => {
  let service: CuttingService;
  let prisma: CuttingPrismaMock;
  let nextNumber: jest.Mock;
  let issueFinishedGood: jest.Mock;
  let receiveFinishedGood: jest.Mock;
  // tx يشترك مع prisma في نفس الـ mocks (المعاملة تمر على نفس الوكيل).
  const tx = {} as unknown as CuttingPrismaMock;

  const activeOrder = (overrides: Record<string, unknown> = {}) => ({
    id: 'cut-1',
    docNumber: 'CUT-0001',
    date: new Date('2026-09-15T00:00:00Z'),
    productId: 'prod-1',
    warehouseId: 'wh-fg',
    workerId: 'worker-1',
    wagePerPiece: 2.5,
    wageTotal: 250,
    totalPieces: 100,
    totalLays: 4,
    status: CuttingOrderStatus.DRAFT,
    lines: [
      {
        id: 'line-1',
        size: 'L',
        color: 'كحلي',
        colorId: null,
        sizeGroupId: null,
        layCount: 4,
        piecesPerLay: 25,
        quantity: 100,
        productVariantId: null,
      },
    ],
    ...overrides,
  });

  const baseCreateDto = {
    productId: 'prod-1',
    warehouseId: 'wh-fg',
    lines: [
      { size: 'M', layCount: 3, piecesPerLay: 25 },
      { size: 'L', layCount: 2, piecesPerLay: 30 },
    ],
  };

  beforeEach(() => {
    prisma = createCuttingPrismaMock();
    prisma.$transaction.mockImplementation(
      (
        arg: ((client: CuttingPrismaMock) => Promise<unknown>) | unknown[],
      ): Promise<unknown> =>
        typeof arg === 'function' ? arg(tx) : Promise.all(arg),
    );
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      name: 'تيشيرت بولو',
    });
    prisma.warehouse.findUnique.mockResolvedValue({
      id: 'wh-fg',
      isActive: true,
      type: WarehouseType.FINISHED_GOODS,
    });
    prisma.worker.findUnique.mockResolvedValue({
      id: 'worker-1',
      isActive: true,
    });
    prisma.color.findMany.mockResolvedValue([]);
    prisma.color.findUnique.mockResolvedValue(null);
    prisma.color.create.mockResolvedValue({ id: 'color-1' });
    prisma.color.update.mockResolvedValue({ id: 'color-1' });
    prisma.sizeGroup.findMany.mockResolvedValue([]);
    prisma.sizeGroup.findUnique.mockResolvedValue(null);
    prisma.sizeGroup.create.mockResolvedValue({ id: 'sg-1' });
    prisma.sizeGroup.update.mockResolvedValue({ id: 'sg-1' });
    prisma.cuttingOrder.findUnique.mockResolvedValue(null);
    prisma.cuttingOrder.findMany.mockResolvedValue([]);
    prisma.cuttingOrder.count.mockResolvedValue(0);
    prisma.cuttingOrder.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'cut-1',
        ...data,
      }),
    );
    prisma.cuttingOrder.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'cut-1',
        ...data,
      }),
    );
    prisma.cuttingLine.update.mockResolvedValue({ id: 'line-1' });
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'var-target',
      isActive: true,
    });
    prisma.productVariant.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'var-new',
        ...data,
      }),
    );
    prisma.productVariant.count.mockResolvedValue(0);
    prisma.finishedGoodStock.findFirst.mockResolvedValue(null);
    prisma.finishedGoodStock.findUnique.mockResolvedValue({
      id: 'fgs-1',
      quantity: 500,
      unitCost: new Prisma.Decimal(40),
    });
    prisma.finishedGoodStock.updateMany.mockResolvedValue({ count: 1 });
    prisma.finishedGoodStock.update.mockResolvedValue({ id: 'fgs-1' });
    prisma.stockLedgerEntry.findMany.mockResolvedValue([]);
    prisma.stockLedgerEntry.create.mockResolvedValue({ id: 'sle-1' });
    prisma.dailyProduction.create.mockResolvedValue({ id: 'dp-1' });
    prisma.dailyProduction.findFirst.mockResolvedValue(null);
    prisma.dailyProduction.delete.mockResolvedValue({ id: 'dp-1' });
    Object.assign(tx, prisma);
    nextNumber = jest.fn().mockResolvedValue('CUT-0001');
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
    service = new CuttingService(
      prisma as unknown as PrismaService,
      sequence,
      inventory,
    );
  });

  // ---------------- الإنشاء ----------------

  it('يحسب الكميات والإجماليات على الخادم: بند = رقصات × قطع الرقصة', async () => {
    await service.create(
      { ...baseCreateDto, workerId: 'worker-1', wagePerPiece: 2 },
      'user-1',
    );
    expect(nextNumber).toHaveBeenCalledWith('CUTTING_ORDER', tx);
    const createCall = (
      prisma.cuttingOrder.create.mock.calls as unknown as Array<
        [CuttingOrderCreateCall]
      >
    )[0][0];
    // بندان: 3×25=75 و2×30=60 → 135 قطعة و5 رقصات؛ أجر 135×2=270.
    expect(Number(createCall.data.totalPieces)).toBe(135);
    expect(Number(createCall.data.totalLays)).toBe(5);
    expect(Number(createCall.data.wageTotal)).toBe(270);
    const lines = createCall.data.lines.create as { quantity: number }[];
    expect(Number(lines[0].quantity)).toBe(75);
    expect(Number(lines[1].quantity)).toBe(60);
    expect(createCall.data.status).toBe(CuttingOrderStatus.DRAFT);
  });

  it('لا يحسب أجرًا بلا عامل (أو بلا أجر قطعة)', async () => {
    await service.create(baseCreateDto, 'user-1');
    const createCall = (
      prisma.cuttingOrder.create.mock.calls as unknown as Array<
        [CuttingOrderCreateCall]
      >
    )[0][0];
    expect(Number(createCall.data.wageTotal)).toBe(0);
    expect(createCall.data.wagePerPiece).toBeNull();
  });

  it('يرفض القطع غير الصحيحة عند الإنشاء', async () => {
    await expect(
      service.create(
        {
          ...baseCreateDto,
          lines: [{ size: 'M', layCount: 1, piecesPerLay: 2.5 }],
        },
        'user-1',
      ),
    ).rejects.toThrow('أوامر القص تتطلب قطعًا صحيحة');
  });

  it('يرفض الإنشاء على مخزن ليس منتج تام', async () => {
    prisma.warehouse.findUnique.mockResolvedValue({
      id: 'wh-raw',
      isActive: true,
      type: WarehouseType.RAW_MATERIAL,
    });
    await expect(
      service.create(baseCreateDto as never, 'user-1'),
    ).rejects.toThrow('أوامر القص تتطلب مخزن منتج تام نشط');
  });

  it('يرفض المنتج أو العامل غير النشط', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(
      service.create(baseCreateDto as never, 'user-1'),
    ).rejects.toThrow('المنتج المحدد غير موجود');
    prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
    prisma.worker.findUnique.mockResolvedValue({ id: 'w', isActive: false });
    await expect(
      service.create({ ...baseCreateDto, workerId: 'w' }, 'user-1'),
    ).rejects.toThrow('العامل المحدد غير موجود أو غير نشط');
  });

  it('يلقّط اسم اللون المرجعي عند غياب النص في البند', async () => {
    prisma.color.findMany.mockResolvedValue([{ id: 'color-9', name: 'أحمر' }]);
    await service.create(
      {
        ...baseCreateDto,
        lines: [
          { size: 'M', layCount: 1, piecesPerLay: 10, colorId: 'color-9' },
        ],
      },
      'user-1',
    );
    const lines = (
      prisma.cuttingOrder.create.mock.calls as unknown as Array<
        [CuttingOrderCreateCall]
      >
    )[0][0].data.lines.create as {
      color: string | null;
      colorId: string | null;
    }[];
    expect(lines[0].colorId).toBe('color-9');
    expect(lines[0].color).toBe('أحمر');
  });

  // ---------------- التفعيل ----------------

  it('يرفض تفعيل أمر غير مسودة أو قطع غير صحيحة', async () => {
    prisma.cuttingOrder.findUnique.mockResolvedValue(
      activeOrder({ status: CuttingOrderStatus.ACTIVE }),
    );
    await expect(service.activate('cut-1', {}, 'user-1')).rejects.toThrow(
      'لا يمكن تفعيل أمر قص غير مسودة',
    );
    prisma.cuttingOrder.findUnique.mockResolvedValue(
      activeOrder({ totalPieces: 100.5 }),
    );
    await expect(service.activate('cut-1', {}, 'user-1')).rejects.toThrow(
      'أوامر القص تتطلب قطعًا صحيحة',
    );
  });

  it('يرفض التفعيل عند عدم كفاية رصيد المصدر برسالة المتاح', async () => {
    prisma.cuttingOrder.findUnique.mockResolvedValue(activeOrder());
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'var-1',
      productId: 'prod-1',
      isActive: true,
    });
    prisma.finishedGoodStock.findUnique.mockResolvedValue({
      id: 'fgs-1',
      quantity: 50,
      unitCost: 40,
    });
    await expect(
      service.activate('cut-1', { sourceVariantId: 'var-1' }, 'user-1'),
    ).rejects.toThrow('المخزون غير كافٍ — المتاح: 50 والمطلوب: 100');
    expect(issueFinishedGood).not.toHaveBeenCalled();
  });

  it('يرفض توليفة مصدر لا تنتمي للموديل', async () => {
    prisma.cuttingOrder.findUnique.mockResolvedValue(activeOrder());
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'var-x',
      productId: 'prod-آخر',
      isActive: true,
    });
    await expect(
      service.activate('cut-1', { sourceVariantId: 'var-x' }, 'user-1'),
    ).rejects.toThrow('لا تنتمي للموديل المقصوص');
  });

  it('يختار تلقائيًا توليفة الموديل صاحبة أكبر رصيد عند غياب sourceVariantId', async () => {
    prisma.cuttingOrder.findUnique.mockResolvedValue(
      activeOrder({ workerId: null, wageTotal: 0 }),
    );
    prisma.finishedGoodStock.findFirst.mockResolvedValue({
      id: 'fgs-auto',
      productVariantId: 'var-auto',
      quantity: 900,
    });
    await service.activate('cut-1', {}, 'user-1');
    const issueInput = (
      issueFinishedGood.mock.calls as unknown as Array<[IssueFinishedGoodCall]>
    )[0][0];
    expect(issueInput.productVariantId).toBe('var-auto');
    expect(issueInput.quantity).toBe(100);
    expect(issueInput.reference).toBe('CUT-0001');
    // بلا عامل → لا سجل أجر.
    expect(prisma.dailyProduction.create).not.toHaveBeenCalled();
  });

  it('التفعيل يصرف المصدر ويُدخل كل توليفة بتكلفته ويسجل الأجر', async () => {
    prisma.cuttingOrder.findUnique.mockResolvedValue(activeOrder());
    prisma.productVariant.findUnique.mockImplementation(
      ({ where }: { where: { id?: string } }) =>
        where.id
          ? { id: 'var-1', productId: 'prod-1', isActive: true }
          : { id: 'var-target', isActive: true },
    );
    prisma.finishedGoodStock.findUnique.mockResolvedValue({
      id: 'fgs-1',
      quantity: 500,
      unitCost: 40,
    });
    await service.activate('cut-1', { sourceVariantId: 'var-1' }, 'user-1');

    // (ب) صرف المصدر بكامل القطع.
    expect(issueFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'var-1',
        warehouseId: 'wh-fg',
        quantity: 100,
        reference: 'CUT-0001',
      }),
      'user-1',
      tx,
    );
    // (ج) إدخال التوليفة الهدف بتكلفة المصدر نفسها + ربط البند بها.
    expect(receiveFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'var-target',
        quantity: 100,
        unitCost: 40,
        reference: 'CUT-0001',
      }),
      'user-1',
      tx,
    );
    expect(prisma.cuttingLine.update).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: { productVariantId: 'var-target' },
    });
    // (د) سجل أجر القص للعامل بالقطع الصحيحة.
    const dp = (
      prisma.dailyProduction.create.mock.calls as unknown as Array<
        [{ data: DailyProductionData }]
      >
    )[0][0].data;
    expect(dp.workerId).toBe('worker-1');
    expect(dp.piecesCount).toBe(100);
    expect(Number(dp.totalAmount)).toBe(250);
    expect(dp.notes).toBe('أجر قص CUT-0001');
    // الحالة النهائية ACTIVE.
    expect(prisma.cuttingOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cut-1', status: CuttingOrderStatus.DRAFT },
        data: { status: CuttingOrderStatus.ACTIVE },
      }),
    );
  });

  it('ينشئ التوليفة الهدف عند غيابها (productId × size × color)', async () => {
    prisma.cuttingOrder.findUnique.mockResolvedValue(
      activeOrder({ workerId: null, wageTotal: 0 }),
    );
    prisma.finishedGoodStock.findFirst.mockResolvedValue({
      id: 'fgs-auto',
      productVariantId: 'var-auto',
      quantity: 900,
    });
    prisma.productVariant.findUnique.mockResolvedValue(null);
    await service.activate('cut-1', {}, 'user-1');
    expect(prisma.productVariant.create).toHaveBeenCalledWith({
      data: {
        productId: 'prod-1',
        size: 'L',
        color: 'كحلي',
        colorId: null,
        isActive: true,
      },
      select: { id: true, isActive: true },
    });
  });

  // ---------------- العكس ----------------

  it('يرفض عكس أمر غير مفعّل', async () => {
    prisma.cuttingOrder.findUnique.mockResolvedValue(
      activeOrder({ status: CuttingOrderStatus.DRAFT }),
    );
    await expect(service.reverse('cut-1', 'user-1')).rejects.toThrow(
      'لا يمكن عكس أمر قص غير مفعّل',
    );
  });

  it('العكس يرد الحركات (صرف التوليفة + استرجاع المصدر) ويحذف الأجر', async () => {
    prisma.cuttingOrder.findUnique.mockResolvedValue(
      activeOrder({ status: CuttingOrderStatus.ACTIVE }),
    );
    // حركات التفعيل بترتيبها: صرف المصدر ثم إدخال التوليفة.
    prisma.stockLedgerEntry.findMany.mockResolvedValue([
      {
        id: 'sle-1',
        quantityDelta: -100,
        productVariantId: 'var-1',
        unitCost: 40,
      },
      {
        id: 'sle-2',
        quantityDelta: 100,
        productVariantId: 'var-target',
        unitCost: 40,
      },
    ]);
    prisma.finishedGoodStock.findUnique.mockImplementation(
      ({
        where,
      }: {
        where: { warehouseId_productVariantId: { productVariantId: string } };
      }) => {
        const variantId = where.warehouseId_productVariantId.productVariantId;
        if (variantId === 'var-1') {
          return {
            id: 'fgs-1',
            quantity: 400,
            unitCost: new Prisma.Decimal(40),
          };
        }
        return {
          id: 'fgs-t',
          quantity: 100,
          unitCost: new Prisma.Decimal(40),
        };
      },
    );
    prisma.dailyProduction.findFirst.mockResolvedValue({ id: 'dp-1' });

    await service.reverse('cut-1', 'user-2');

    // عكس حركة الإدخال (التوليفة): صرف شرطي بحرس الرصيد.
    expect(prisma.finishedGoodStock.updateMany).toHaveBeenCalledWith({
      where: { id: 'fgs-t', quantity: { gte: 100 } },
      data: { quantity: { decrement: 100 } },
    });
    // عكس حركة الصرف (المصدر): استرجاع بذات التكلفة (متوسط مرجح).
    expect(prisma.finishedGoodStock.update).toHaveBeenCalledWith({
      where: { id: 'fgs-1' },
      data: expect.objectContaining({ quantity: { increment: 100 } }) as Record<
        string,
        unknown
      >,
    });
    // حركتا العكس في دفتر الحركات بنفس مرجع المستند.
    const created = prisma.stockLedgerEntry.create.mock.calls as unknown as [
      { data: { type: string; quantityDelta: unknown; reference: string } },
    ][];
    expect(created).toHaveLength(2);
    expect(created[0][0].data.type).toBe('RECEIVE');
    expect(Number(created[0][0].data.quantityDelta)).toBe(100);
    expect(created[1][0].data.type).toBe('ISSUE');
    expect(Number(created[1][0].data.quantityDelta)).toBe(-100);
    for (const [call] of created) {
      expect(call.data.reference).toBe('CUT-0001');
    }
    // حذف سجل الأجر.
    expect(prisma.dailyProduction.delete).toHaveBeenCalledWith({
      where: { id: 'dp-1' },
    });
    // الحالة النهائية REVERSED مع من قام بالعكس.
    expect(prisma.cuttingOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cut-1' },
        data: expect.objectContaining({
          status: CuttingOrderStatus.REVERSED,
          reversedById: 'user-2',
        }) as Record<string, unknown>,
      }),
    );
  });

  it('يرفض العكس حين لا توجد حركات موثقة للمستند', async () => {
    prisma.cuttingOrder.findUnique.mockResolvedValue(
      activeOrder({ status: CuttingOrderStatus.ACTIVE }),
    );
    await expect(service.reverse('cut-1', 'user-1')).rejects.toThrow(
      'لا توجد حركات مخزون مرتبطة بأمر القص لعكسها',
    );
  });

  // ---------------- الألوان والمقاسات ----------------

  it('يرفض اسم لون مكررًا والحذف منطقي', async () => {
    prisma.color.findUnique.mockResolvedValue({ id: 'color-1' });
    await expect(
      service.createColor({ name: 'كحلي', hex: '#1F3A93' }),
    ).rejects.toThrow('يوجد لون بهذا الاسم بالفعل');
    prisma.color.findUnique.mockResolvedValue(null);
    await service.createColor({ name: 'كحلي', hex: '#1F3A93' });
    expect(prisma.color.create).toHaveBeenCalledWith({
      data: { name: 'كحلي', hex: '#1F3A93', isActive: true },
    });
    // الحذف منطقي.
    prisma.color.findUnique.mockResolvedValue({ id: 'color-1', name: 'كحلي' });
    await service.removeColor('color-1');
    expect(prisma.color.update).toHaveBeenCalledWith({
      where: { id: 'color-1' },
      data: { isActive: false },
    });
  });

  it('يرفض مجموعة مقاسات فارغة أو مكررة والحذف منطقي', async () => {
    await expect(
      service.createSizeGroup({ name: 'شبابي', sizes: ['  '] }),
    ).rejects.toThrow('قيمًا فارغة');
    prisma.sizeGroup.findUnique.mockResolvedValue({ id: 'sg-1' });
    await expect(
      service.createSizeGroup({ name: 'شبابي', sizes: ['S'] }),
    ).rejects.toThrow('بهذا الاسم');
    prisma.sizeGroup.findUnique.mockResolvedValue(null);
    await service.createSizeGroup({
      name: 'شبابي',
      sizes: ['S', 'M', 'L'],
    });
    expect(prisma.sizeGroup.create).toHaveBeenCalledWith({
      data: { name: 'شبابي', sizes: ['S', 'M', 'L'], isActive: true },
    });
    prisma.sizeGroup.findUnique.mockResolvedValue({
      id: 'sg-1',
      name: 'شبابي',
    });
    await service.removeSizeGroup('sg-1');
    expect(prisma.sizeGroup.update).toHaveBeenCalledWith({
      where: { id: 'sg-1' },
      data: { isActive: false },
    });
  });
});
