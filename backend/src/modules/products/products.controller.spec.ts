import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('ProductsController — التفويض والتحقق من المسارات الحساسة (GF-REMAINING-001)', () => {
  let controller: ProductsController;
  let service: {
    getAllSeasons: jest.Mock;
    getAllProducts: jest.Mock;
    getProductDetails: jest.Mock;
    createProduct: jest.Mock;
    createFullProduct: jest.Mock;
    createVariant: jest.Mock;
    addBomItem: jest.Mock;
    deleteBomItem: jest.Mock;
  };

  const managerRoles = [UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER];

  beforeEach(() => {
    service = {
      getAllSeasons: jest.fn().mockResolvedValue([]),
      getAllProducts: jest.fn().mockResolvedValue([]),
      getProductDetails: jest.fn().mockResolvedValue({ id: 'p-1' }),
      createProduct: jest.fn().mockResolvedValue({ id: 'p-2' }),
      createFullProduct: jest.fn().mockResolvedValue({ id: 'p-full' }),
      createVariant: jest.fn().mockResolvedValue({ id: 'v-1' }),
      addBomItem: jest.fn().mockResolvedValue({ id: 'bom-1' }),
      deleteBomItem: jest.fn().mockResolvedValue({ id: 'bom-1' }),
    };
    controller = new ProductsController(service as unknown as ProductsService);
  });

  it('يفوّض قائمة المواسم والمنتجات وتفاصيل منتج إلى الخدمة', async () => {
    await controller.getSeasons({});
    await controller.getAllProducts({});
    await controller.getProduct('123e4567-e89b-12d3-a456-426614174000');
    expect(service.getAllSeasons).toHaveBeenCalledTimes(1);
    expect(service.getAllProducts).toHaveBeenCalledTimes(1);
    expect(service.getProductDetails).toHaveBeenCalledWith(
      '123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it('يفوّض إنشاء المنتج الكامل إلى الخدمة بنفس body', async () => {
    const body = {
      code: 'PRD-FULL',
      name: 'تيشيرت',
      category: 'قمصان',
      retailPrice: 300,
      wholesalePrice: 220,
      variants: [{ size: 'L', color: 'أسود' }],
      bomItems: [
        {
          rawMaterialId: '223e4567-e89b-12d3-a456-426614174000',
          quantity: 1.2,
          unit: 'METER',
        },
      ],
    };
    await controller.createFullProduct(body);
    expect(service.createFullProduct).toHaveBeenCalledWith(body, undefined);
  });

  it('ينشئ منتجًا عبر الخدمة ببيانات الطلب كما هي', async () => {
    const body = {
      code: 'PRD-T02',
      name: 'قميص',
      category: 'قمصان',
      retailPrice: 300,
      wholesalePrice: 220,
    };
    await controller.createProduct(body);
    expect(service.createProduct).toHaveBeenCalledWith(body, undefined);
  });

  it.each([
    ['createProduct', 'إنشاء المنتج'],
    ['createFullProduct', 'إنشاء المنتج الكامل'],
    ['createVariant', 'إضافة المتغير'],
    ['addBomItem', 'إضافة مادة BOM'],
    ['deleteBomItem', 'حذف مادة BOM'],
  ] as const)('%s مقيّد بأدوار الإدارة المناسبة: %s', (method, _label) => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      ProductsController.prototype,
      method,
    );
    expect(roles).toEqual(managerRoles);
  });

  it('يفوّض إضافة متغير إلى الخدمة', async () => {
    const productId = '123e4567-e89b-12d3-a456-426614174000';
    await controller.createVariant(productId, { size: 'L', color: 'أزرق' });
    expect(service.createVariant).toHaveBeenCalledWith(
      productId,
      'L',
      'أزرق',
      undefined,
    );
  });

  it('يفوّض إضافة BOM إلى الخدمة', async () => {
    const productId = '123e4567-e89b-12d3-a456-426614174000';
    const rawMaterialId = '223e4567-e89b-12d3-a456-426614174000';
    await controller.addBomItem(productId, {
      rawMaterialId,
      quantity: 1.25,
      unit: 'METER',
    });
    expect(service.addBomItem).toHaveBeenCalledWith(
      productId,
      rawMaterialId,
      1.25,
      'METER',
      undefined,
    );
  });

  it('يفوّض حذف BOM إلى الخدمة', async () => {
    const bomId = '323e4567-e89b-12d3-a456-426614174000';
    await controller.deleteBomItem(bomId);
    expect(service.deleteBomItem).toHaveBeenCalledWith(bomId);
  });
});
