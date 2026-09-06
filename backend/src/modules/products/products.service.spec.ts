import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * مواصفة موسّعة: PROD-1 يحتاج bomLine.findUnique لفحص الوجود قبل الحذف —
 * النمط نفسه المستخدم في inventory.service.spec (توسيع المصنع المشترك محليًا).
 */
type ProductsPrismaMock = ReturnType<typeof createPrismaMock> & {
  bomLine: {
    upsert: jest.Mock;
    createMany: jest.Mock;
    delete: jest.Mock;
    findUnique: jest.Mock;
  };
};

function createProductsPrismaMock(): ProductsPrismaMock {
  return {
    ...createPrismaMock(),
    bomLine: {
      upsert: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
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
