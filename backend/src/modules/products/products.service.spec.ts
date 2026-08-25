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

    expect((result as any).data || result).toEqual(products);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 20,
      include: { season: true, variants: true },
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
    prisma.product.findUnique.mockResolvedValue(product);

    const result = await service.getProductDetails('p-1');

    expect((result as any).data || result).toEqual(product);
    expect(prisma.product.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-1' } }),
    );
  });

  it('يرمي 404 لمنتج غير موجود', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
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
