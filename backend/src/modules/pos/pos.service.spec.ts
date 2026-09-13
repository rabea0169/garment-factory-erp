import 'reflect-metadata';
import { WarehouseType } from '@prisma/client';
import { PosService } from './pos.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { computeRequestHash } from '../../core/common/idempotency.util';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { PosPriceLevel, QuickSaleDto } from './dto/quick-sale.dto';

/**
 * SELIM-ERP W2 — اختبارات نقطة البيع:
 * - البيع السريع ذري: أمر CONFIRMED مباشرة + مدفوع كامل + سند قبض آلي.
 * - الأسعار خادمية بمستوى السعر (قطاعي/جملة) — لا تُقبل من العميل.
 * - walk-in: upsert عميل النقدي مرة واحدة.
 * - قيد GL: Dr CASH / Cr إيراد + ضريبة + COGS — نفس بنود التأكيد.
 * - إعادة الإرسال بمفتاح idempotency نفسه تعيد نفس الاستجابة بلا أثر.
 * - حل الباركود: توليفة مباشرة ثم fallback لباركود المنتج.
 */

type PosPrismaMock = ReturnType<typeof createPrismaMock> & {
  customer: ReturnType<typeof createPrismaMock>['customer'] & {
    upsert: jest.Mock;
    findFirst: jest.Mock;
  };
  productVariant: ReturnType<typeof createPrismaMock>['productVariant'] & {
    findFirst: jest.Mock;
  };
  product: ReturnType<typeof createPrismaMock>['product'] & {
    findFirst: jest.Mock;
    groupBy?: jest.Mock;
  };
  finishedGoodStock: ReturnType<
    typeof createPrismaMock
  >['finishedGoodStock'] & {
    groupBy: jest.Mock;
  };
  warehouse: ReturnType<typeof createPrismaMock>['warehouse'] & {
    findFirst: jest.Mock;
  };
};

function createPosMock(): PosPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
    customer: { ...base.customer, upsert: jest.fn(), findFirst: jest.fn() },
    productVariant: { ...base.productVariant, findFirst: jest.fn() },
    product: { ...base.product, findFirst: jest.fn(), groupBy: jest.fn() },
    finishedGoodStock: { ...base.finishedGoodStock, groupBy: jest.fn() },
    warehouse: { ...base.warehouse, findFirst: jest.fn() },
  };
}

describe('PosService — نقطة البيع (SELIM W2)', () => {
  let service: PosService;
  let prisma: PosPrismaMock;
  let postJournalEntryInTx: jest.Mock;
  let bulkIssueFinishedGoods: jest.Mock;
  const tx = {} as unknown as PosPrismaMock;

  const dto: QuickSaleDto = {
    items: [{ productVariantId: 'var-1', quantity: 2 }],
    discount: 0,
    priceLevel: PosPriceLevel.RETAIL,
  };

  beforeEach(() => {
    delete process.env.COMPANY_VAT_NUMBER;
    delete process.env.COMPANY_NAME;
    prisma = createPosMock();
    prisma.$transaction.mockImplementation(
      (arg: (client: PosPrismaMock) => Promise<unknown>): Promise<unknown> =>
        arg(tx),
    );
    Object.assign(tx, prisma);

    prisma.customer.upsert.mockResolvedValue({ id: 'walk-in-1' });
    prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    prisma.productVariant.findMany.mockResolvedValue([
      {
        id: 'var-1',
        productId: 'prod-1',
        size: 'L',
        color: 'أحمر',
        barcode: '111',
        product: {
          id: 'prod-1',
          code: 'P-1',
          name: 'تيشيرت',
          retailPrice: '250',
          wholesalePrice: '200',
          isActive: true,
          deletedAt: null,
        },
      },
    ]);
    prisma.warehouse.findFirst.mockResolvedValue({
      id: 'wh-fg',
      code: 'WH-FG',
      type: WarehouseType.FINISHED_GOODS,
      isActive: true,
    });
    prisma.finishedGoodStock.findMany.mockResolvedValue([
      { productVariantId: 'var-1', unitCost: '120' },
    ]);
    bulkIssueFinishedGoods = jest.fn().mockResolvedValue({ totalValue: 240 });
    prisma.salesOrder.create.mockResolvedValue({
      id: 'so-1',
      code: 'SO-2026-ABC',
      createdAt: new Date('2026-09-13T10:00:00Z'),
    });
    prisma.salesOrder.findUniqueOrThrow.mockResolvedValue({
      id: 'so-1',
      code: 'SO-2026-ABC',
      createdAt: new Date('2026-09-13T10:00:00Z'),
      customer: { name: 'عميل نقدي', code: 'WALK-IN' },
      subtotal: '500',
      discount: '0',
      vatRate: '0.14',
      vatAmount: '70',
      totalAmount: '570',
      paidAmount: '570',
      items: [
        {
          quantity: 2,
          unitPrice: '250',
          totalPrice: '500',
          variant: {
            size: 'L',
            color: 'أحمر',
            product: { name: 'تيشيرت', code: 'P-1' },
          },
        },
      ],
    });
    prisma.customerPayment.create.mockResolvedValue({ id: 'cp-1' });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    postJournalEntryInTx = jest.fn().mockResolvedValue(undefined);
    prisma.activityLog.create.mockResolvedValue({ id: 'al-1' });

    service = new PosService(
      prisma as unknown as PrismaService,
      { bulkIssueFinishedGoods } as unknown as InventoryService,
      { postJournalEntryInTx } as unknown as FinancialPostingService,
    );
  });

  it('بيع سريع: أمر CONFIRMED مباشرة بمدفوع كامل وwalk-in upsert', async () => {
    const result = (await service.quickSale(dto, 'user-1')) as {
      code: string;
      items: { name: string }[];
      qrPayload: string;
    };
    // walk-in: upsert بكود ثابت.
    expect(prisma.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'WALK-IN' } }),
    );
    const createCall = (
      prisma.salesOrder.create.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0][0].data;
    expect(createCall.status).toBe('CONFIRMED');
    expect(createCall.paidAmount).toBe(570);
    // 2 × 250 = 500 + VAT 14% = 570.
    expect(createCall.subtotal).toBe(500);
    expect(createCall.vatAmount).toBe(70);
    expect(createCall.totalAmount).toBe(570);
    // سند قبض آلي مرتبط بالأمر.
    expect(prisma.customerPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          salesOrderId: 'so-1',
          amount: 570,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
    // إيصار الطباعة في الرد.
    expect(result.code).toBe('SO-2026-ABC');
    expect(result.items[0].name).toBe('تيشيرت');
    expect(result.qrPayload).toContain('SO-2026-ABC');
  });

  it('مستوى سعر الجملة يستخدم wholesalePrice', async () => {
    await service.quickSale(
      { ...dto, priceLevel: PosPriceLevel.WHOLESALE },
      'user-1',
    );
    const createCall = (
      prisma.salesOrder.create.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0][0].data;
    // 2 × 200 = 400 + VAT 14% = 456.
    expect(createCall.subtotal).toBe(400);
    expect(createCall.totalAmount).toBe(456);
  });

  it('قيد GL: Dr CASH / Cr إيراد + ضريبة + COGS بنفس بنود التأكيد', async () => {
    await service.quickSale(dto, 'user-1');
    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
    const input = (
      postJournalEntryInTx.mock.calls as unknown as Array<
        [
          unknown,
          {
            postingKey: string;
            lines: {
              debitAccountId: string;
              creditAccountId: string;
              amount: number;
            }[];
          },
        ]
      >
    )[0][1];
    expect(input.postingKey).toBe('pos-sale:so-1');
    expect(input.lines).toHaveLength(3);
    // معرفات الحسابات من CHART_OF_ACCOUNTS (UUIDs ثابتة).
    expect(input.lines[0]).toMatchObject({
      debitAccountId: '10000000-0000-0000-0000-000000000011',
      creditAccountId: '40000000-0000-0000-0000-000000000011',
      amount: 500,
    });
    expect(input.lines[1]).toMatchObject({
      debitAccountId: '10000000-0000-0000-0000-000000000011',
      creditAccountId: '20000000-0000-0000-0000-000000000031',
      amount: 70,
    });
    expect(input.lines[2]).toMatchObject({
      debitAccountId: CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
      creditAccountId: '10000000-0000-0000-0000-000000000041',
      amount: 240,
    });
    // صرف المخزون بكميات السلة من WH-FG (الكود مولّد — أي سلسلة).
    expect(bulkIssueFinishedGoods).toHaveBeenCalledWith(
      [
        {
          productVariantId: 'var-1',
          quantity: 2,
          reference: expect.any(String) as string,
          notes: expect.any(String) as string,
        },
      ],
      'wh-fg',
      tx,
      'user-1',
    );
  });

  it('idempotency: نفس المفتاح يعيد الاستجابة المخزنة بلا بيع جديد', async () => {
    // الهاش الحقيقي نفس بنية الخدمة — يضمن التطابق لا مجرد شكل.
    const requestHash = computeRequestHash({
      operation: 'pos-quick-sale',
      userId: 'user-1',
      customerId: null,
      discount: 0,
      priceLevel: PosPriceLevel.RETAIL,
      items: dto.items,
      notes: '',
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      scope: 'pos-quick-sale',
      requestHash,
      response: { code: 'SO-REPLAY', orderId: 'so-r', replayed: true },
    });
    const result = (await service.quickSale(dto, 'user-1', 'key-1')) as {
      code?: string;
      replayed?: boolean;
    };
    expect(result.replayed).toBe(true);
    expect(result.code).toBe('SO-REPLAY');
    // لم يُنشأ أمر جديد إطلاقًا.
    expect(prisma.salesOrder.create).not.toHaveBeenCalled();
  });

  it('يرفض تكرار الصنف في السلة أو كميات غير صحيحة', async () => {
    await expect(
      service.quickSale(
        {
          ...dto,
          items: [
            { productVariantId: 'var-1', quantity: 1 },
            { productVariantId: 'var-1', quantity: 2 },
          ],
        },
        'user-1',
      ),
    ).rejects.toThrow('لا يجوز تكرار');
    await expect(
      service.quickSale(
        { ...dto, items: [{ productVariantId: 'var-1', quantity: 0 }] },
        'user-1',
      ),
    ).rejects.toThrow('كمية صحيحة موجبة');
  });

  it('حل الباركود: توليفة مباشرة أولا ثم باركود المنتج', async () => {
    prisma.productVariant.findFirst.mockResolvedValue({
      id: 'var-9',
      productId: 'prod-9',
      size: 'M',
      color: 'أزرق',
      barcode: '222',
      product: {
        id: 'prod-9',
        code: 'P-9',
        name: 'بنطلون',
        retailPrice: '300',
        wholesalePrice: '260',
        isActive: true,
        deletedAt: null,
      },
    });
    const direct = (await service.resolveBarcode('222')) as {
      variantId: string;
    };
    expect(direct.variantId).toBe('var-9');

    // fallback: باركود على المنتج نفسه.
    prisma.productVariant.findFirst.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-8',
      code: 'P-8',
      name: 'جاكيت',
      retailPrice: '800',
      wholesalePrice: '700',
      variants: [{ id: 'var-8', size: 'XL', color: 'أسود', barcode: null }],
    });
    const fallback = (await service.resolveBarcode('P8BARCODE')) as {
      variantId: string;
      name: string;
    };
    expect(fallback.variantId).toBe('var-8');
    expect(fallback.name).toBe('جاكيت');
  });

  it('كتالوج POS: يسطح المنتجات بالمتاح من WH-FG', async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'prod-1',
        code: 'P-1',
        name: 'تيشيرت',
        retailPrice: '250',
        wholesalePrice: '200',
        variants: [{ id: 'var-1', size: 'L', color: 'أحمر', barcode: '111' }],
      },
    ]);
    prisma.finishedGoodStock.groupBy.mockResolvedValue([
      { productVariantId: 'var-1', _sum: { quantity: 7 } },
    ]);
    const catalog = (await service.getCatalog(undefined, undefined)) as {
      items: { variantId: string; availableQty: number; retailPrice: number }[];
    };
    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]).toMatchObject({
      variantId: 'var-1',
      availableQty: 7,
      retailPrice: 250,
    });
  });
});
