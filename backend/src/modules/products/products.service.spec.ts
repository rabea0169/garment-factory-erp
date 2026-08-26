import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('ProductsService — كتالوج المنتجات (GF-0003)', () => {
  let service: ProductsService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
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
});

describe('ProductsService — versioned BOM', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: ProductsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    service = new ProductsService(prisma as unknown as PrismaService);
  });

  it('creates the first active BOM version without mutating a line in place', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'product-1' });
    prisma.rawMaterial.findFirst.mockResolvedValue({ id: 'material-1' });
    prisma.bomVersion.findFirst.mockResolvedValue(null);
    prisma.bomVersion.create.mockResolvedValue({
      id: 'bom-1',
      versionName: 'v1.0',
      isActive: true,
      lines: [{ rawMaterialId: 'material-1', quantity: 2, unit: 'METER' }],
    });

    const result = await service.addBomItem(
      'product-1',
      'material-1',
      2,
      'METER',
    );

    expect(result).toMatchObject({ id: 'bom-1', versionName: 'v1.0' });
    expect(prisma.bomVersion.create).toHaveBeenCalledWith({
      data: {
        productId: 'product-1',
        versionName: 'v1.0',
        isActive: true,
        lines: {
          create: [{ rawMaterialId: 'material-1', quantity: 2, unit: 'METER' }],
        },
      },
      include: { lines: { include: { rawMaterial: true } } },
    });
    expect(prisma.bomLine.upsert).not.toHaveBeenCalled();
  });

  it('creates a new active BOM version when changing an existing component', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'product-1' });
    prisma.rawMaterial.findFirst.mockResolvedValue({ id: 'material-2' });
    prisma.bomVersion.findFirst.mockResolvedValue({
      id: 'bom-1',
      productId: 'product-1',
      versionName: 'v1.0',
      isActive: true,
      lines: [
        {
          id: 'line-1',
          rawMaterialId: 'material-1',
          quantity: 1,
          unit: 'METER',
        },
      ],
    });
    prisma.bomVersion.update.mockResolvedValue({
      id: 'bom-1',
      isActive: false,
    });
    prisma.bomVersion.create.mockResolvedValue({
      id: 'bom-2',
      versionName: 'v2.0',
      isActive: true,
      lines: [],
    });

    await service.addBomItem('product-1', 'material-2', 3, 'PIECE');

    expect(prisma.bomVersion.update).toHaveBeenCalledWith({
      where: { id: 'bom-1' },
      data: { isActive: false },
    });
    expect(prisma.bomVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          versionName: 'v2.0',
          isActive: true,
          lines: {
            create: [
              { rawMaterialId: 'material-1', quantity: 1, unit: 'METER' },
              { rawMaterialId: 'material-2', quantity: 3, unit: 'PIECE' },
            ],
          },
        }) as Record<string, unknown>,
      }),
    );
  });

  it('creates a replacement BOM version instead of deleting a historical line', async () => {
    prisma.bomLine.findUnique.mockResolvedValue({
      id: 'line-1',
      bomVersion: {
        id: 'bom-1',
        productId: 'product-1',
        versionName: 'v3.0',
        isActive: true,
        lines: [
          {
            id: 'line-1',
            rawMaterialId: 'material-1',
            quantity: 1,
            unit: 'METER',
          },
          {
            id: 'line-2',
            rawMaterialId: 'material-2',
            quantity: 2,
            unit: 'PIECE',
          },
        ],
      },
    });
    prisma.bomVersion.update.mockResolvedValue({
      id: 'bom-1',
      isActive: false,
    });
    prisma.bomVersion.create.mockResolvedValue({
      id: 'bom-4',
      versionName: 'v4.0',
      isActive: true,
      lines: [{ rawMaterialId: 'material-2', quantity: 2, unit: 'PIECE' }],
    });

    const result = await service.deleteBomItem('line-1');

    expect(result).toMatchObject({ deletedLineId: 'line-1' });
    expect(prisma.bomLine.delete).not.toHaveBeenCalled();
    expect(prisma.bomVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          versionName: 'v4.0',
          lines: {
            create: [
              { rawMaterialId: 'material-2', quantity: 2, unit: 'PIECE' },
            ],
          },
        }) as Record<string, unknown>,
      }),
    );
  });

  it('rejects non-positive BOM quantities before opening a transaction', async () => {
    await expect(
      service.addBomItem('product-1', 'material-1', 0, 'METER'),
    ).rejects.toThrow('كمية BOM');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
