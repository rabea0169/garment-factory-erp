import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { computeRequestHash } from '../../core/common/idempotency.util';

/**
 * مواصفة موسّعة: PROD-1 يحتاج bomLine.findUnique لفحص الوجود قبل الحذف،
 * وPROD-3 يحتاج season.findUnique لفحص الموسم داخل المعاملة —
 * النمط نفسه المستخدم في inventory.service.spec (توسيع المصنع المشترك محليًا).
 */
type ProductsPrismaMock = ReturnType<typeof createPrismaMock> & {
  bomLine: {
    upsert: jest.Mock;
    createMany: jest.Mock;
    delete: jest.Mock;
    findUnique: jest.Mock;
  };
  season: {
    findMany: jest.Mock;
    create: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
  };
  rawMaterial: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
  };
};

function createProductsPrismaMock(): ProductsPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
    bomLine: {
      upsert: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    season: {
      ...base.season,
      findUnique: jest.fn(),
    },
    rawMaterial: {
      ...base.rawMaterial,
      findFirst: jest.fn(),
    },
  };
}

describe('ProductsService — كتالوج المنتجات (GF-0003)', () => {
  let service: ProductsService;
  let prisma: ProductsPrismaMock;

  beforeEach(() => {
    prisma = createProductsPrismaMock();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    service = new ProductsService(prisma as unknown as PrismaService);
  });

  it('يجلب كل المنتجات مع المواسم والـ variants', async () => {
    const products = [
      { id: 'p-1', name: 'تيشيرت بولو', variants: [{ id: 'v-1', size: 'M' }] },
    ];
    prisma.product.findMany.mockResolvedValue(products);

    const result = await service.getAllProducts({});

    expect(result.data).toEqual(products);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 20,
      where: { deletedAt: null },
      include: { season: true, variants: { where: { isActive: true } } },
      orderBy: { name: 'asc' },
    });
  });

  it('يرجع تفاصيل المنتج مع BOM عند وجوده', async () => {
    const product = {
      id: 'p-1',
      name: 'تيشيرت بولو',
      variants: [],
      bomItems: [{ rawMaterialId: 'rm-1', quantity: 1.2 }],
    };
    prisma.product.findFirst.mockResolvedValue(product);

    const result = await service.getProductDetails('p-1');

    expect(result).toEqual(product);
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-1', deletedAt: null } }),
    );
  });

  it('يرمي 404 لمنتج غير موجود', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.getProductDetails('ghost')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('ينشئ منتجًا بالبيانات كما وردت', async () => {
    const data = {
      code: 'PRD-T02',
      name: 'قميص كاجوال',
      category: 'قمصان',
      retailPrice: 300,
      wholesalePrice: 220,
    };
    prisma.product.create.mockResolvedValue({ id: 'p-2', ...data });

    const result = await service.createProduct(data);

    expect(result.id).toBe('p-2');
    expect(prisma.product.create).toHaveBeenCalledWith({ data });
  });

  it('ينشئ منتجًا كاملًا ومتغيراته وBOM داخل transaction واحدة', async () => {
    prisma.product.create.mockResolvedValue({ id: 'p-full' });
    prisma.productVariant.createMany.mockResolvedValue({ count: 1 });
    prisma.bomVersion.create.mockResolvedValue({ id: 'bom-1' });
    prisma.bomLine.createMany.mockResolvedValue({ count: 1 });
    prisma.product.findUnique.mockResolvedValue({
      id: 'p-full',
      variants: [{ size: 'L', color: 'أسود' }],
      bomVersions: [{ lines: [{ rawMaterialId: 'rm-1' }] }],
    });

    const result = await service.createFullProduct({
      code: ' PRD-FULL ',
      name: ' تيشيرت ',
      category: ' ملابس ',
      retailPrice: 300,
      wholesalePrice: 220,
      variants: [{ size: ' L ', color: ' أسود ' }],
      bomItems: [{ rawMaterialId: 'rm-1', quantity: 1.2, unit: ' متر ' }],
    });

    expect(result).toEqual(expect.objectContaining({ id: 'p-full' }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.productVariant.createMany).toHaveBeenCalledWith({
      data: [{ productId: 'p-full', size: 'L', color: 'أسود' }],
    });
    expect(prisma.bomLine.createMany).toHaveBeenCalledWith({
      data: [
        {
          bomVersionId: 'bom-1',
          rawMaterialId: 'rm-1',
          quantity: 1.2,
          unit: 'متر',
        },
      ],
    });
  });

  it('يرفض تكرار المتغير قبل بدء transaction', async () => {
    await expect(
      service.createFullProduct({
        code: 'PRD-DUP',
        name: 'تيشيرت',
        category: 'ملابس',
        retailPrice: 300,
        wholesalePrice: 220,
        variants: [
          { size: 'L', color: 'أسود' },
          { size: ' l ', color: ' أسود ' },
        ],
      }),
    ).rejects.toThrow('لا يمكن تكرار المقاس واللون');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ============ PROD-5: تكرار الخامة داخل BOM للمنتج الكامل ============

  it('PROD-5: يرفض تكرار الخامة داخل BOM للمنتج الكامل قبل المعاملة', async () => {
    await expect(
      service.createFullProduct({
        code: 'PRD-DUP-BOM',
        name: 'تيشيرت',
        category: 'ملابس',
        retailPrice: 300,
        wholesalePrice: 220,
        bomItems: [
          { rawMaterialId: 'rm-1', quantity: 1.2, unit: 'متر' },
          { rawMaterialId: 'rm-1', quantity: 0.8, unit: 'متر' },
        ],
      }),
    ).rejects.toThrow('لا يمكن تكرار الخامة داخل BOM');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ============ PROD-3: فحص معرف الموسم داخل المعاملة ============

  it('PROD-3: إنشاء منتج بسيط بموسم وهمي → 404 عربي واضح (لا 500)', async () => {
    prisma.season.findUnique.mockResolvedValue(null);

    await expect(
      service.createProduct({
        code: 'PRD-T03',
        name: 'قميص',
        category: 'قمصان',
        retailPrice: 300,
        wholesalePrice: 220,
        seasonId: 'ghost-season',
      }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.createProduct({
        code: 'PRD-T03',
        name: 'قميص',
        category: 'قمصان',
        retailPrice: 300,
        wholesalePrice: 220,
        seasonId: 'ghost-season',
      }),
    ).rejects.toThrow('الموسم المحدد غير موجود: ghost-season');

    // الرفض قبل أي إنشاء
    expect(prisma.season.findUnique).toHaveBeenCalledWith({
      where: { id: 'ghost-season' },
      select: { id: true },
    });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('PROD-3: إنشاء منتج كامل بموسم وهمي → 404 قبل أي إنشاء (منتج/نسخ/BOM)', async () => {
    prisma.season.findUnique.mockResolvedValue(null);

    await expect(
      service.createFullProduct({
        code: 'PRD-FULL-GHOST',
        name: 'تيشيرت',
        category: 'ملابس',
        retailPrice: 300,
        wholesalePrice: 220,
        seasonId: 'ghost-season',
        variants: [{ size: 'L', color: 'أسود' }],
        bomItems: [{ rawMaterialId: 'rm-1', quantity: 1.2, unit: 'متر' }],
      }),
    ).rejects.toThrow('الموسم المحدد غير موجود: ghost-season');

    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.productVariant.createMany).not.toHaveBeenCalled();
    expect(prisma.bomVersion.create).not.toHaveBeenCalled();
  });

  it('PROD-3: موسم صالح يمر — فحص داخل المعاملة ثم الإنشاء', async () => {
    prisma.season.findUnique.mockResolvedValue({ id: 'season-1' });
    prisma.product.create.mockResolvedValue({ id: 'p-3' });

    await service.createProduct({
      code: 'PRD-T04',
      name: 'قميص',
      category: 'قمصان',
      retailPrice: 300,
      wholesalePrice: 220,
      seasonId: 'season-1',
    });

    expect(prisma.season.findUnique).toHaveBeenCalledWith({
      where: { id: 'season-1' },
      select: { id: true },
    });
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        code: 'PRD-T04',
        name: 'قميص',
        category: 'قمصان',
        retailPrice: 300,
        wholesalePrice: 220,
        seasonId: 'season-1',
      },
    });
  });

  it('ينشئ variant بمنتج ومقاس ولون محددين', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
    prisma.productVariant.create.mockResolvedValue({
      id: 'v-9',
      productId: 'p-1',
      size: 'L',
      color: 'أسود',
    });

    await service.createVariant('p-1', 'L', 'أسود');

    expect(prisma.productVariant.create).toHaveBeenCalledWith({
      data: { productId: 'p-1', size: 'L', color: 'أسود' },
    });
  });

  // ============ PROD-2: تطبيع الفراغات في createVariant ============

  it("PROD-2: ينشئ variant بتطبيع الفراغات — ' L ' → 'L' (توحيد createFullProduct)", async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
    prisma.productVariant.create.mockResolvedValue({
      id: 'v-10',
      productId: 'p-1',
      size: 'L',
      color: 'أسود',
    });

    const result = (await service.createVariant('p-1', ' L ', ' أسود ')) as {
      size: string;
      color: string;
    };

    expect(prisma.productVariant.create).toHaveBeenCalledWith({
      data: { productId: 'p-1', size: 'L', color: 'أسود' },
    });
    expect(result.size).toBe('L');
    expect(result.color).toBe('أسود');
  });

  // ============ PROD-5: مسارات addBomItem ============

  it('PROD-5: addBomItem ينجح وينشئ إصدار v1.0 عند عدم وجود إصدار نشط', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', isActive: true });
    prisma.rawMaterial.findFirst.mockResolvedValue({
      id: 'rm-1',
      isActive: true,
    });
    prisma.bomVersion.findFirst.mockResolvedValue(null);
    prisma.bomVersion.create.mockResolvedValue({ id: 'bom-v1' });
    prisma.bomLine.upsert.mockResolvedValue({
      id: 'bl-1',
      rawMaterialId: 'rm-1',
      quantity: 2,
    });

    const result = await service.addBomItem('p-1', 'rm-1', 2, 'METER');

    // إصدار جديد عند غياب النشط
    expect(prisma.bomVersion.create).toHaveBeenCalledWith({
      data: { productId: 'p-1', versionName: 'v1.0', isActive: true },
    });
    // upsert بالمفتاح المركب (bomVersionId, rawMaterialId)
    expect(prisma.bomLine.upsert).toHaveBeenCalledWith({
      where: {
        bomVersionId_rawMaterialId: {
          bomVersionId: 'bom-v1',
          rawMaterialId: 'rm-1',
        },
      },
      create: {
        bomVersionId: 'bom-v1',
        rawMaterialId: 'rm-1',
        quantity: 2,
        unit: 'METER',
      },
      update: { quantity: 2, unit: 'METER' },
      include: { rawMaterial: true },
    });
    expect(result.id).toBe('bl-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('PROD-5: المادة المكررة على نفس الإصدار تُحدَّث بالـ upsert — المنطق القائم (لا رفض بالتصميم)', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', isActive: true });
    prisma.rawMaterial.findFirst.mockResolvedValue({
      id: 'rm-1',
      isActive: true,
    });
    prisma.bomVersion.findFirst.mockResolvedValue({
      id: 'bom-active',
      isActive: true,
    });
    prisma.bomLine.upsert.mockResolvedValue({ id: 'bl-existing' });

    await service.addBomItem('p-1', 'rm-1', 5, 'KG');

    // نفس الثنائية (bomVersionId, rawMaterialId): تحديث الكمية/الوحدة —
    // الرسمي للمسار: upsert (الملاحظة في الكود) لا رفض. الرفض الصريح
    // للتكرار موجود في مسار createFullProduct أعلاه.
    expect(prisma.bomLine.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.bomLine.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bomVersionId_rawMaterialId: {
            bomVersionId: 'bom-active',
            rawMaterialId: 'rm-1',
          },
        },
        update: { quantity: 5, unit: 'KG' },
      }),
    );
    // لا إصدار جديد
    expect(prisma.bomVersion.create).not.toHaveBeenCalled();
  });

  it('PROD-5: إعادة تشغيل idempotency لمسار BOM — نفس المفتاح يعيد الاستجابة دون upsert', async () => {
    const payload = {
      productId: 'p-1',
      rawMaterialId: 'rm-1',
      quantity: 2,
      unit: 'METER',
    };
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'bom-key-1',
      scope: 'product-bom-add',
      requestHash: computeRequestHash(payload),
      response: { id: 'bom-line-1', quantity: 2 },
    });

    const result = await service.addBomItem(
      payload.productId,
      payload.rawMaterialId,
      payload.quantity,
      payload.unit,
      'bom-key-1',
    );

    expect(result).toEqual({
      id: 'bom-line-1',
      quantity: 2,
      replayed: true,
    });
    // إعادة التشغيل بلا تنفيذ جديد
    expect(prisma.bomLine.upsert).not.toHaveBeenCalled();
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(prisma.rawMaterial.findFirst).not.toHaveBeenCalled();
  });

  // ============ PROD-1: حذف بند BOM ============

  it('PROD-1: حذف بند BOM غير موجود → 404 NotFoundException برسالة عربية', async () => {
    prisma.bomLine.findUnique.mockResolvedValue(null);

    await expect(service.deleteBomItem('ghost-bom')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.deleteBomItem('ghost-bom')).rejects.toThrow(
      'بند قائمة المواد غير موجود',
    );
    // لا محاولة حذف بعد الرفض
    expect(prisma.bomLine.delete).not.toHaveBeenCalled();
  });

  it('PROD-1: حذف بند موجود يفحص الوجود ثم يحذف كما هو', async () => {
    prisma.bomLine.findUnique.mockResolvedValue({ id: 'bom-1' });
    prisma.bomLine.delete.mockResolvedValue({ id: 'bom-1' });

    const result = await service.deleteBomItem('bom-1');

    expect(prisma.bomLine.findUnique).toHaveBeenCalledWith({
      where: { id: 'bom-1' },
      select: { id: true },
    });
    expect(result).toEqual({ id: 'bom-1' });
    expect(prisma.bomLine.delete).toHaveBeenCalledWith({
      where: { id: 'bom-1' },
    });
  });
});
