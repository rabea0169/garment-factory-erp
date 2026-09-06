import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { computeRequestHash } from '../../core/common/idempotency.util';

/**
 * مواصفة موسّعة: PROD-1 يحتاج bomLine.findUnique لفحص الوجود قبل الحذف،
 * وPROD-3 يحتاج season.findUnique لفحص الموسم داخل المعاملة، وPROD-4
 * يحتاج bomLine.create/findMany وbomVersion.update (مسار الإصدار) —
 * النمط نفسه المستخدم في inventory.service.spec (توسيع المصنع المشترك محليًا).
 */
type ProductsPrismaMock = ReturnType<typeof createPrismaMock> & {
  bomLine: {
    upsert: jest.Mock;
    create: jest.Mock;
    createMany: jest.Mock;
    delete: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  bomVersion: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
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
      create: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    bomVersion: {
      ...base.bomVersion,
      update: jest.fn(),
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

  it('يجلب كل المنتجات مع المواسم والـ variants النشطة افتراضيًا (PROD-7)', async () => {
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
      include: {
        season: true,
        variants: { where: { isActive: true } },
      },
      orderBy: { name: 'asc' },
    });
  });

  // ============ PROD-7: توحيد تعريض المتغيرات غير النشطة ============

  it('PROD-7: getAllProducts بـ includeInactive=true يجلب كل المتغيرات بلا مرشح', async () => {
    prisma.product.findMany.mockResolvedValue([]);

    await service.getAllProducts({}, true);

    // قيمة include قالب حرفية (لا objectContaining متداخلة — يمرر النوع بأمان)
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { season: true, variants: true },
      }),
    );
  });

  it('PROD-7: getProductDetails الافتراضي يعرض المتغيرات النشطة فقط (توحيد مع القائمة)', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p-1',
      variants: [{ id: 'v-1', isActive: true }],
    });

    await service.getProductDetails('p-1');

    // include كامل بصيغة حرفية (objectContaining يطبق مساواة عميقة على القيم —
    // القالب الحرفي يمرر النوع بأمان ويتطابق مع الاستدعاء الفعلي بالكامل)
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'p-1', deletedAt: null },
      include: {
        season: true,
        variants: { where: { isActive: true } },
        bomVersions: { include: { lines: { include: { rawMaterial: true } } } },
      },
    });
  });

  it('PROD-7: getProductDetails بـ includeInactive=true يعرض كل المتغيرات (السلوك القديم عند الطلب)', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p-1',
      variants: [
        { id: 'v-1', isActive: true },
        { id: 'v-2', isActive: false },
      ],
    });

    const result = await service.getProductDetails('p-1', true);

    // include كامل بصيغة حرفية — نفس سبط المساواة العميقة أعلاه
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'p-1', deletedAt: null },
      include: {
        season: true,
        variants: true,
        bomVersions: { include: { lines: { include: { rawMaterial: true } } } },
      },
    });
    expect((result as { variants: unknown[] }).variants).toHaveLength(2);
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

  // ============ PROD-5 + PROD-4: مسارات addBomItem (إضافة / إصدار) ============

  it('PROD-5: addBomItem ينجح وينشئ إصدار v1.0 عند عدم وجود إصدار نشط', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', isActive: true });
    prisma.rawMaterial.findFirst.mockResolvedValue({
      id: 'rm-1',
      isActive: true,
    });
    prisma.bomVersion.findFirst.mockResolvedValue(null);
    prisma.bomVersion.create.mockResolvedValue({ id: 'bom-v1' });
    // PROD-4: بند جديد → bomLine.create (لا upsert على إصدار نشط)
    prisma.bomLine.findUnique.mockResolvedValue(null);
    prisma.bomLine.create.mockResolvedValue({
      id: 'bl-1',
      bomVersionId: 'bom-v1',
      rawMaterialId: 'rm-1',
      quantity: 2,
      unit: 'METER',
      rawMaterial: { id: 'rm-1' },
    });

    const result = await service.addBomItem('p-1', 'rm-1', 2, 'METER');

    // إصدار جديد عند غياب النشط
    expect(prisma.bomVersion.create).toHaveBeenCalledWith({
      data: { productId: 'p-1', versionName: 'v1.0', isActive: true },
    });
    // إنشاء البند على الإصدار (بلا تعديل في مكان — PROD-4)
    expect(prisma.bomLine.create).toHaveBeenCalledWith({
      data: {
        bomVersionId: 'bom-v1',
        rawMaterialId: 'rm-1',
        quantity: 2,
        unit: 'METER',
      },
      include: { rawMaterial: true },
    });
    expect(result).toMatchObject({ id: 'bl-1', newVersion: false });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('PROD-4: تعديل جوهري (quantity) على بند قائم في إصدار نشط → إطفاء القديم وإصدار جديد v2.0 بنسخة كاملة', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', isActive: true });
    prisma.rawMaterial.findFirst.mockResolvedValue({
      id: 'rm-1',
      isActive: true,
    });
    prisma.bomVersion.findFirst.mockResolvedValue({
      id: 'bom-v1',
      productId: 'p-1',
      versionName: 'v1.0',
      isActive: true,
    });
    // البند القائم: quantity=2 → التعديل إلى 5 جوهري
    prisma.bomLine.findUnique.mockResolvedValue({
      id: 'bl-1',
      bomVersionId: 'bom-v1',
      rawMaterialId: 'rm-1',
      quantity: new Prisma.Decimal(2),
      unit: 'METER',
    });
    prisma.bomLine.findMany.mockResolvedValue([
      {
        id: 'bl-1',
        bomVersionId: 'bom-v1',
        rawMaterialId: 'rm-1',
        quantity: new Prisma.Decimal(2),
        unit: 'METER',
      },
      {
        id: 'bl-2',
        bomVersionId: 'bom-v1',
        rawMaterialId: 'rm-2',
        quantity: new Prisma.Decimal('0.8'),
        unit: 'KG',
      },
    ]);
    prisma.bomVersion.update.mockResolvedValue({ id: 'bom-v1' });
    prisma.bomVersion.create.mockResolvedValue({
      id: 'bom-v2',
      productId: 'p-1',
      versionName: 'v2.0',
      isActive: true,
    });
    prisma.bomLine.createMany.mockResolvedValue({ count: 1 });
    prisma.bomLine.create.mockResolvedValue({
      id: 'bl-new',
      bomVersionId: 'bom-v2',
      rawMaterialId: 'rm-1',
      quantity: 5,
      unit: 'METER',
      rawMaterial: { id: 'rm-1' },
    });

    const result = await service.addBomItem('p-1', 'rm-1', 5, 'METER');

    // الإصدار القديم يُطفأ داخل نفس المعاملة
    expect(prisma.bomVersion.update).toHaveBeenCalledWith({
      where: { id: 'bom-v1' },
      data: { isActive: false },
    });
    // الإصدار الجديد version+1 (v1.0 → v2.0) نشط
    expect(prisma.bomVersion.create).toHaveBeenCalledWith({
      data: { productId: 'p-1', versionName: 'v2.0', isActive: true },
    });
    // بقية البنود تُنسخ كما هي إلى الإصدار الجديد
    expect(prisma.bomLine.createMany).toHaveBeenCalledWith({
      data: [
        {
          bomVersionId: 'bom-v2',
          rawMaterialId: 'rm-2',
          quantity: new Prisma.Decimal('0.8'),
          unit: 'KG',
        },
      ],
    });
    // البند المعدّل يُنشأ بالقيم الجديدة على الإصدار الجديد
    expect(prisma.bomLine.create).toHaveBeenCalledWith({
      data: {
        bomVersionId: 'bom-v2',
        rawMaterialId: 'rm-1',
        quantity: 5,
        unit: 'METER',
      },
      include: { rawMaterial: true },
    });
    // الاستجابة تحمل علم الإصدار الجديد
    expect(result).toMatchObject({
      id: 'bl-new',
      bomVersionId: 'bom-v2',
      newVersion: true,
      versionName: 'v2.0',
      previousVersionId: 'bom-v1',
    });
    // لا كتابة مباشرة على بند الإصدار القديم
    expect(prisma.bomLine.delete).not.toHaveBeenCalled();
  });

  it('PROD-4: تعديل unit فقط على بند قائم → إصدار جديد كذلك (unitId جوهري)', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', isActive: true });
    prisma.rawMaterial.findFirst.mockResolvedValue({
      id: 'rm-1',
      isActive: true,
    });
    prisma.bomVersion.findFirst.mockResolvedValue({
      id: 'bom-v3',
      productId: 'p-1',
      versionName: 'v3.0',
      isActive: true,
    });
    // نفس الكمية لكن وحدة مختلفة → جوهري
    prisma.bomLine.findUnique.mockResolvedValue({
      id: 'bl-9',
      bomVersionId: 'bom-v3',
      rawMaterialId: 'rm-1',
      quantity: new Prisma.Decimal(2),
      unit: 'METER',
    });
    prisma.bomLine.findMany.mockResolvedValue([
      {
        id: 'bl-9',
        bomVersionId: 'bom-v3',
        rawMaterialId: 'rm-1',
        quantity: new Prisma.Decimal(2),
        unit: 'METER',
      },
    ]);
    prisma.bomVersion.update.mockResolvedValue({});
    prisma.bomVersion.create.mockResolvedValue({ id: 'bom-v4' });
    prisma.bomLine.create.mockResolvedValue({
      id: 'bl-unit',
      bomVersionId: 'bom-v4',
      rawMaterialId: 'rm-1',
      quantity: 2,
      unit: 'YARD',
      rawMaterial: { id: 'rm-1' },
    });

    const result = await service.addBomItem('p-1', 'rm-1', 2, 'YARD');

    expect(prisma.bomVersion.create).toHaveBeenCalledWith({
      data: { productId: 'p-1', versionName: 'v4.0', isActive: true },
    });
    // بند واحد فقط في الإصدار → لا createMany للبقية
    expect(prisma.bomLine.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'bl-unit', newVersion: true });
  });

  it('PROD-4: نفس القيم تمامًا (quantity وunit) → لا إصدار جديد ولا أي كتابة', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', isActive: true });
    prisma.rawMaterial.findFirst.mockResolvedValue({
      id: 'rm-1',
      isActive: true,
    });
    prisma.bomVersion.findFirst.mockResolvedValue({
      id: 'bom-active',
      versionName: 'v1.0',
      isActive: true,
    });
    prisma.bomLine.findUnique.mockResolvedValue({
      id: 'bl-existing',
      bomVersionId: 'bom-active',
      rawMaterialId: 'rm-1',
      quantity: new Prisma.Decimal(5),
      unit: 'KG',
    });

    const result = await service.addBomItem('p-1', 'rm-1', 5, 'KG');

    // لا إصدار جديد ولا كتابة على البنود — نفس البند يُعاد كما هو
    expect(prisma.bomVersion.create).not.toHaveBeenCalled();
    expect(prisma.bomVersion.update).not.toHaveBeenCalled();
    expect(prisma.bomLine.create).not.toHaveBeenCalled();
    expect(prisma.bomLine.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'bl-existing',
      newVersion: false,
      quantity: new Prisma.Decimal(5),
    });
  });

  it('PROD-5: إعادة تشغيل idempotency لمسار BOM — نفس المفتاح يعيد الاستجابة دون كتابة', async () => {
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
      response: { id: 'bom-line-1', quantity: 2, newVersion: false },
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
      newVersion: false,
      replayed: true,
    });
    // إعادة التشغيل بلا تنفيذ جديد
    expect(prisma.bomLine.create).not.toHaveBeenCalled();
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(prisma.rawMaterial.findFirst).not.toHaveBeenCalled();
  });

  // ============ PROD-6: سجلات تدقيق كتابات الكتالوج ============

  it('PROD-6: createFullProduct يكتب PRODUCT_CREATED داخل المعاملة عند توفر الفاعل', async () => {
    prisma.season.findUnique.mockResolvedValue({ id: 'season-1' });
    prisma.product.create.mockResolvedValue({
      id: 'p-full-2',
      code: 'PRD-F2',
      name: 'قميص',
    });
    prisma.productVariant.createMany.mockResolvedValue({ count: 1 });
    prisma.bomVersion.create.mockResolvedValue({ id: 'bom-x' });
    prisma.bomLine.createMany.mockResolvedValue({ count: 1 });
    prisma.product.findUnique.mockResolvedValue({ id: 'p-full-2' });
    prisma.activityLog.create.mockResolvedValue({});

    await service.createFullProduct(
      {
        code: 'PRD-F2',
        name: 'قميص',
        category: 'قمصان',
        retailPrice: 300,
        wholesalePrice: 220,
        seasonId: 'season-1',
        variants: [{ size: 'M', color: 'أزرق' }],
        bomItems: [{ rawMaterialId: 'rm-1', quantity: 1.2, unit: 'متر' }],
      },
      undefined,
      'user-audit-1',
    );

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-audit-1',
        action: 'PRODUCT_CREATED',
        module: 'products',
        details: {
          productId: 'p-full-2',
          code: 'PRD-F2',
          name: 'قميص',
          variantsCount: 1,
          bomItemsCount: 1,
          seasonId: 'season-1',
        },
      },
    });
  });

  it('PROD-6: createVariant يكتب VARIANT_CREATED بالقيم الجوهرية', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1' });
    prisma.productVariant.create.mockResolvedValue({
      id: 'v-audit',
      productId: 'p-1',
      size: 'XL',
      color: 'أبيض',
    });
    prisma.activityLog.create.mockResolvedValue({});

    await service.createVariant('p-1', 'XL', 'أبيض', undefined, 'user-audit-2');

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-audit-2',
        action: 'VARIANT_CREATED',
        module: 'products',
        details: {
          variantId: 'v-audit',
          productId: 'p-1',
          size: 'XL',
          color: 'أبيض',
        },
      },
    });
  });

  it('PROD-6: مسار الإصدار الجديد (PROD-4) يكتب BOM_VERSION_CREATED ثم BOM_ITEM_ADDED', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', isActive: true });
    prisma.rawMaterial.findFirst.mockResolvedValue({
      id: 'rm-1',
      isActive: true,
    });
    prisma.bomVersion.findFirst.mockResolvedValue({
      id: 'bom-v1',
      productId: 'p-1',
      versionName: 'v1.0',
      isActive: true,
    });
    prisma.bomLine.findUnique.mockResolvedValue({
      id: 'bl-1',
      bomVersionId: 'bom-v1',
      rawMaterialId: 'rm-1',
      quantity: new Prisma.Decimal(2),
      unit: 'METER',
    });
    prisma.bomLine.findMany.mockResolvedValue([
      {
        id: 'bl-1',
        bomVersionId: 'bom-v1',
        rawMaterialId: 'rm-1',
        quantity: new Prisma.Decimal(2),
        unit: 'METER',
      },
    ]);
    prisma.bomVersion.update.mockResolvedValue({});
    prisma.bomVersion.create.mockResolvedValue({ id: 'bom-v2' });
    prisma.bomLine.create.mockResolvedValue({
      id: 'bl-v2',
      bomVersionId: 'bom-v2',
      rawMaterialId: 'rm-1',
      quantity: 9,
      unit: 'METER',
      rawMaterial: { id: 'rm-1' },
    });
    prisma.activityLog.create.mockResolvedValue({});

    await service.addBomItem(
      'p-1',
      'rm-1',
      9,
      'METER',
      undefined,
      'user-audit-3',
    );

    const actions = (
      prisma.activityLog.create.mock.calls as unknown as Array<
        [{ data: { action: string } }]
      >
    ).map((call) => call[0].data.action);
    expect(actions).toEqual(['BOM_VERSION_CREATED', 'BOM_ITEM_ADDED']);
    const versionCall = (
      prisma.activityLog.create.mock.calls as unknown as Array<
        [{ data: { details: Record<string, unknown> } }]
      >
    )[0]?.[0];
    expect(versionCall?.data.details).toMatchObject({
      productId: 'p-1',
      newVersionId: 'bom-v2',
      versionName: 'v2.0',
      previousVersionId: 'bom-v1',
      changedRawMaterialId: 'rm-1',
    });
    const itemCall = (
      prisma.activityLog.create.mock.calls as unknown as Array<
        [{ data: { details: Record<string, unknown> } }]
      >
    )[1]?.[0];
    expect(itemCall?.data.details).toMatchObject({
      bomLineId: 'bl-v2',
      bomVersionId: 'bom-v2',
      newVersion: true,
    });
  });

  it('PROD-6: بلا فاعل (استدعاء برمجي قديم) — لا سجل تدقيق (userId NOT NULL بلا مستخدم نظام)', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', isActive: true });
    prisma.rawMaterial.findFirst.mockResolvedValue({
      id: 'rm-1',
      isActive: true,
    });
    prisma.bomVersion.findFirst.mockResolvedValue(null);
    prisma.bomVersion.create.mockResolvedValue({ id: 'bom-v1' });
    prisma.bomLine.findUnique.mockResolvedValue(null);
    prisma.bomLine.create.mockResolvedValue({
      id: 'bl-noaudit',
      bomVersionId: 'bom-v1',
      rawMaterialId: 'rm-1',
      quantity: 1,
      unit: 'KG',
      rawMaterial: { id: 'rm-1' },
    });

    await service.addBomItem('p-1', 'rm-1', 1, 'KG');

    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  // ============ PROD-1 + PROD-6: حذف بند BOM (فحص + معاملة + تدقيق) ============

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

  it('PROD-1: حذف بند موجود يفحص الوجود ثم يحذف داخل معاملة واحدة (PROD-6)', async () => {
    prisma.bomLine.findUnique.mockResolvedValue({
      id: 'bom-1',
      bomVersionId: 'bom-v1',
      rawMaterialId: 'rm-1',
      quantity: new Prisma.Decimal('1.5'),
      unit: 'METER',
    });
    prisma.bomLine.delete.mockResolvedValue({ id: 'bom-1' });

    const result = await service.deleteBomItem('bom-1');

    expect(prisma.bomLine.findUnique).toHaveBeenCalledWith({
      where: { id: 'bom-1' },
      select: {
        id: true,
        bomVersionId: true,
        rawMaterialId: true,
        quantity: true,
        unit: true,
      },
    });
    expect(result).toEqual({ id: 'bom-1' });
    expect(prisma.bomLine.delete).toHaveBeenCalledWith({
      where: { id: 'bom-1' },
    });
    // الفحص والحذف داخل معاملة واحدة (PRD-6/PROD-6)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // بلا فاعل → لا سجل تدقيق
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it('PROD-6: حذف بند مع فاعل يكتب BOM_ITEM_DELETED بالقيم الجوهرية داخل المعاملة', async () => {
    prisma.bomLine.findUnique.mockResolvedValue({
      id: 'bom-2',
      bomVersionId: 'bom-v1',
      rawMaterialId: 'rm-2',
      quantity: new Prisma.Decimal('0.75'),
      unit: 'KG',
    });
    prisma.bomLine.delete.mockResolvedValue({ id: 'bom-2' });
    prisma.activityLog.create.mockResolvedValue({});

    await service.deleteBomItem('bom-2', 'user-audit-4');

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-audit-4',
        action: 'BOM_ITEM_DELETED',
        module: 'products',
        details: {
          bomLineId: 'bom-2',
          bomVersionId: 'bom-v1',
          rawMaterialId: 'rm-2',
          quantity: '0.75',
          unit: 'KG',
        },
      },
    });
  });
});
