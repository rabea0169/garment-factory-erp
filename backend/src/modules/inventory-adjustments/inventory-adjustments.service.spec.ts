import 'reflect-metadata';
import { AdjustmentStatus } from '@prisma/client';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { InventoryService } from '../inventory/inventory.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';

/**
 * SELIM-ERP W1 — اختبارات خدمة تسويات الجرد.
 *
 * تركّز على قواعد المجال (نفس قواعد Selim ERP):
 * - رصيد النظام والفرق والقيمة تُحسب على الخادم (لا تُقبل من العميل).
 * - الترقيم ADJ-0001 داخل معاملة الإنشاء.
 * - آلة الحالات: الاعتماد/الرفض/الحذف من DRAFT فقط.
 * - الاعتماد يطبّق الفروق: الخامات عبر InventoryService.adjust، والبضاعة
 *   الجاهزة بحركة دفتر مباشرة داخل المعاملة + قيد GL بالحسابات الصحيحة.
 * - بنود XOR (خامة أو توليفة) وبنود الفرق صفر لا تُطبق.
 */
describe('InventoryAdjustmentsService — قواعد تسويات الجرد (SELIM W1)', () => {
  let service: InventoryAdjustmentsService;
  const prisma = {
    $transaction: jest.fn(),
    inventoryAdjustment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    warehouse: { findUnique: jest.fn() },
    rawMaterial: { findUnique: jest.fn() },
    productVariant: { findUnique: jest.fn() },
    finishedGoodStock: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    stockLedgerEntry: {
      aggregate: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
  const sequence = { nextNumber: jest.fn() };
  const financial = {
    postJournalEntryInTx: jest.fn(),
    reverseJournalEntryInTx: jest.fn(),
  };
  const inventory = { adjust: jest.fn() };
  const tx = {} as unknown as Record<string, unknown>;

  /** إدخال وسيط لقراءة بيانات إنشاء التسوية من الـ mock (بلا any مسرب). */
  const createDataOf = (): {
    status: AdjustmentStatus;
    items: { create: Array<Record<string, unknown>> };
  } =>
    (
      prisma.inventoryAdjustment.create.mock.calls as unknown as Array<
        [
          {
            data: {
              status: AdjustmentStatus;
              items: { create: Array<Record<string, unknown>> };
            };
          },
        ]
      >
    )[0]?.[0]?.data;

  /** إدخال وسيط لقراءة بيانات القيد المُرحَّل (بلا any مسرب). */
  const journalInputOf = (
    call = 0,
  ): {
    lines: Array<{
      debitAccountId: string;
      creditAccountId: string;
      amount: number;
    }>;
    postingKey?: string;
  } =>
    (
      financial.postJournalEntryInTx.mock.calls as unknown as Array<
        [
          unknown,
          {
            lines: Array<{
              debitAccountId: string;
              creditAccountId: string;
              amount: number;
            }>;
            postingKey?: string;
          },
        ]
      >
    )[call]?.[1];

  const baseDto: CreateInventoryAdjustmentDto = {
    warehouseId: 'wh-1',
    notes: 'جرد ربع سنوي',
    items: [
      {
        rawMaterialId: 'rm-1',
        itemName: 'قماش قطن',
        unit: 'متر',
        actualQty: 95,
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (client: unknown) => unknown)(tx);
      }
      return [[], 0];
    });
    prisma.inventoryAdjustment.findUnique.mockResolvedValue(null);
    prisma.inventoryAdjustment.findMany.mockResolvedValue([]);
    prisma.inventoryAdjustment.count.mockResolvedValue(0);
    prisma.inventoryAdjustment.create.mockResolvedValue({
      id: 'adj-1',
      code: 'ADJ-0001',
    });
    prisma.inventoryAdjustment.update.mockResolvedValue({ id: 'adj-1' });
    prisma.inventoryAdjustment.updateMany.mockResolvedValue({ count: 1 });
    prisma.inventoryAdjustment.delete.mockResolvedValue({ id: 'adj-1' });
    prisma.warehouse.findUnique.mockResolvedValue({
      id: 'wh-1',
      code: 'WH-RAW',
      isActive: true,
    });
    prisma.rawMaterial.findUnique.mockResolvedValue({
      id: 'rm-1',
      name: 'قماش قطن',
      unit: 'METER',
      costPerUnit: '5',
    });
    prisma.productVariant.findUnique.mockResolvedValue({
      id: 'var-1',
      size: 'L',
      color: 'أحمر',
      product: { name: 'تيشيرت بولو' },
    });
    prisma.finishedGoodStock.findUnique.mockResolvedValue({
      quantity: 40,
      unitCost: '60',
    });
    prisma.finishedGoodStock.create.mockResolvedValue({ id: 'fgs-1' });
    prisma.finishedGoodStock.update.mockResolvedValue({ id: 'fgs-1' });
    prisma.stockLedgerEntry.aggregate.mockResolvedValue({
      _sum: { quantityDelta: '100' },
    });
    prisma.stockLedgerEntry.findFirst.mockResolvedValue(null);
    prisma.stockLedgerEntry.create.mockResolvedValue({ entryCode: 'SLE-1' });
    sequence.nextNumber.mockResolvedValue('ADJ-0001');
    financial.postJournalEntryInTx.mockResolvedValue({
      entryId: 'je-1',
      entryCode: 'JE-0001',
    });
    financial.reverseJournalEntryInTx.mockResolvedValue({
      reversalEntryId: 'je-2',
    });
    inventory.adjust.mockResolvedValue({ entryCode: 'SLE-9' });
    Object.assign(tx, prisma);
    service = new InventoryAdjustmentsService(
      prisma as never,
      sequence as unknown as SequenceService,
      financial as unknown as FinancialPostingService,
      inventory as unknown as InventoryService,
    );
  });

  it('يحسب رصيد النظام والفرق والقيمة على الخادم (نقص 5 وحدات × 5 = −25)', async () => {
    await service.create(baseDto, 'user-1');
    const data = createDataOf();
    const item = data?.items.create[0];
    // النظام 100 (من الدفتر)، الفعلي 95 → فرق −5، القيمة −5 × 5 = −25.
    expect(Number(item?.systemQty)).toBe(100);
    expect(Number(item?.difference)).toBe(-5);
    expect(Number(item?.valueDifference)).toBe(-25);
    // الحالة مسودة دائمًا عند الإنشاء — لا تُقبل من العميل.
    expect(data?.status).toBe(AdjustmentStatus.DRAFT);
    // الترقيم عبر SequenceService داخل المعاملة.
    expect(sequence.nextNumber).toHaveBeenCalledWith(
      'INVENTORY_ADJUSTMENT',
      tx,
    );
  });

  it('يرفض بندًا يجمع خامة وتوليفة معًا (XOR)', async () => {
    await expect(
      service.create(
        {
          ...baseDto,
          items: [
            {
              rawMaterialId: 'rm-1',
              productVariantId: 'var-1',
              itemName: 'صنف مزدوج',
              unit: 'قطعة',
              actualQty: 10,
            },
          ],
        },
        'user-1',
      ),
    ).rejects.toThrow('لا كلاهما ولا بلا منهما');
  });

  it('يرفض بندًا بلا خامة وبلا توليفة', async () => {
    await expect(
      service.create(
        {
          ...baseDto,
          items: [{ itemName: 'صنف حر', unit: 'قطعة', actualQty: 10 }],
        },
        'user-1',
      ),
    ).rejects.toThrow('لا كلاهما ولا بلا منهما');
  });

  it('يرفض إنشاء تسوية لمخزن غير موجود', async () => {
    prisma.warehouse.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto, 'user-1')).rejects.toThrow(
      'المخزن غير موجود',
    );
  });

  it('يرفض إنشاء تسوية لمخزن غير نشط', async () => {
    prisma.warehouse.findUnique.mockResolvedValue({
      id: 'wh-1',
      isActive: false,
    });
    await expect(service.create(baseDto, 'user-1')).rejects.toThrow(
      'المخزن غير نشط',
    );
  });

  it('الاعتماد يطبق فرق الخامات عبر InventoryService.adjust', async () => {
    prisma.inventoryAdjustment.findUnique.mockResolvedValue({
      id: 'adj-1',
      code: 'ADJ-0001',
      warehouseId: 'wh-1',
      status: AdjustmentStatus.DRAFT,
      notes: 'جرد',
      items: [
        {
          id: 'it-1',
          rawMaterialId: 'rm-1',
          productVariantId: null,
          itemName: 'قماش قطن',
          difference: '-5',
          unitCost: '5',
        },
      ],
    });
    await service.approve('adj-1', 'user-1');
    expect(inventory.adjust).toHaveBeenCalledWith(
      expect.objectContaining({
        rawMaterialId: 'rm-1',
        warehouseId: 'wh-1',
        quantityDelta: -5,
        reference: 'ADJ-0001',
      }),
      'user-1',
    );
    // قلب الحالة داخل المعاملة بـ CAS.
    const flipCall = (
      prisma.inventoryAdjustment.updateMany.mock.calls as unknown as Array<
        [{ where: Record<string, unknown>; data: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(flipCall?.where).toEqual({
      id: 'adj-1',
      status: AdjustmentStatus.DRAFT,
    });
    expect(flipCall?.data).toMatchObject({
      status: AdjustmentStatus.APPROVED,
      approvedById: 'user-1',
    });
  });

  it('الاعتماد لا يطبق بنود الفرق صفر (adjust لا يُستدعى)', async () => {
    prisma.inventoryAdjustment.findUnique.mockResolvedValue({
      id: 'adj-1',
      code: 'ADJ-0001',
      warehouseId: 'wh-1',
      status: AdjustmentStatus.DRAFT,
      items: [
        {
          id: 'it-1',
          rawMaterialId: 'rm-1',
          productVariantId: null,
          difference: '0',
          unitCost: '5',
        },
      ],
    });
    await service.approve('adj-1', 'user-1');
    expect(inventory.adjust).not.toHaveBeenCalled();
  });

  it('الاعتماد ينشئ حركة دفتر وقيد GL للبضاعة الجاهزة بالحسابات الصحيحة', async () => {
    prisma.inventoryAdjustment.findUnique.mockResolvedValue({
      id: 'adj-1',
      code: 'ADJ-0001',
      warehouseId: 'wh-1',
      status: AdjustmentStatus.DRAFT,
      date: new Date('2026-09-10'),
      items: [
        {
          id: 'it-2',
          rawMaterialId: null,
          productVariantId: 'var-1',
          itemName: 'تيشيرت بولو — L/أحمر',
          difference: '3',
          unitCost: '60',
        },
      ],
    });
    await service.approve('adj-1', 'user-1');
    // حركة الدفتر مباشرة داخل المعاملة.
    const ledgerData = (
      prisma.stockLedgerEntry.create.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0]?.data;
    expect(ledgerData?.productVariantId).toBe('var-1');
    expect(ledgerData?.reference).toBe('ADJ-0001');
    // تحديث رصيد المنتج التام +3.
    expect(prisma.finishedGoodStock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { quantity: { increment: 3 } },
      }),
    );
    // القيد: Dr FINISHED_GOOD_STOCK / Cr INVENTORY_ADJUSTMENT_INCOME بمبلغ 180.
    const input = journalInputOf();
    expect(input?.lines[0]?.debitAccountId).toBe(
      CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK,
    );
    expect(input?.lines[0]?.creditAccountId).toBe(
      CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_INCOME,
    );
    expect(input?.lines[0]?.amount).toBe(180);
    expect(input?.postingKey).toBe('adjustment-fg:it-2');
  });

  it('يرفض اعتماد تسوية غير مسودة', async () => {
    prisma.inventoryAdjustment.findUnique.mockResolvedValue({
      id: 'adj-1',
      status: AdjustmentStatus.APPROVED,
      items: [],
    });
    await expect(service.approve('adj-1', 'user-1')).rejects.toThrow(
      'لا يمكن اعتماد إلا تسوية في حالة مسودة',
    );
  });

  it('يرفض اعتماد تسوية غير موجودة', async () => {
    prisma.inventoryAdjustment.findUnique.mockResolvedValue(null);
    await expect(service.approve('adj-x', 'user-1')).rejects.toThrow(
      'تسوية الجرد غير موجودة',
    );
  });

  it('الرفض يتطلب مسودة ويحفظ السبب', async () => {
    prisma.inventoryAdjustment.findUnique.mockResolvedValue({
      id: 'adj-1',
      status: AdjustmentStatus.DRAFT,
    });
    await service.reject('adj-1', 'أعيد الجرد ووُجد تطابق');
    expect(prisma.inventoryAdjustment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'adj-1' },
        data: {
          status: AdjustmentStatus.REJECTED,
          rejectedReason: 'أعيد الجرد ووُجد تطابق',
        },
      }),
    );
  });

  it('يرفض رفض تسوية معتمدة', async () => {
    prisma.inventoryAdjustment.findUnique.mockResolvedValue({
      id: 'adj-1',
      status: AdjustmentStatus.APPROVED,
    });
    await expect(service.reject('adj-1', 'سبب')).rejects.toThrow(
      'لا يمكن رفض إلا تسوية في حالة مسودة',
    );
  });

  it('الحذف مسودة فقط', async () => {
    prisma.inventoryAdjustment.findUnique.mockResolvedValue({
      id: 'adj-1',
      status: AdjustmentStatus.DRAFT,
    });
    const result = await service.remove('adj-1');
    expect(prisma.inventoryAdjustment.delete).toHaveBeenCalledWith({
      where: { id: 'adj-1' },
    });
    expect(result).toEqual({ deleted: true });

    prisma.inventoryAdjustment.findUnique.mockResolvedValue({
      id: 'adj-1',
      status: AdjustmentStatus.APPROVED,
    });
    await expect(service.remove('adj-1')).rejects.toThrow(
      'لا يمكن حذف تسوية معتمدة أو مرفوضة',
    );
  });

  it('الكميات غير الصحيحة للبضاعة الجاهزة تُرفض (أعداد صحيحة فقط)', async () => {
    await expect(
      service.create(
        {
          ...baseDto,
          items: [
            {
              productVariantId: 'var-1',
              itemName: 'تيشيرت بولو',
              unit: 'قطعة',
              actualQty: 10.5,
            },
          ],
        },
        'user-1',
      ),
    ).rejects.toThrow('أعداد صحيحة');
  });
});
