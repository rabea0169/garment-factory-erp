import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('ProductsController — التفويض والتفويض للخدمة (GF-0003)', () => {
  let controller: ProductsController;
  let service: {
    getAllSeasons: jest.Mock;
    getAllProducts: jest.Mock;
    getProductDetails: jest.Mock;
    createProduct: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getAllSeasons: jest.fn().mockResolvedValue([]),
      getAllProducts: jest.fn().mockResolvedValue([]),
      getProductDetails: jest.fn().mockResolvedValue({ id: 'p-1' }),
      createProduct: jest.fn().mockResolvedValue({ id: 'p-2' }),
    };
    controller = new ProductsController(service as unknown as ProductsService);
  });

  it('يفوّض قائمة المواسم والمنتجات وتفاصيل منتج إلى الخدمة', async () => {
    await controller.getSeasons();
    await controller.getProducts();
    await controller.getProduct('p-1');
    expect(service.getAllSeasons).toHaveBeenCalledTimes(1);
    expect(service.getAllProducts).toHaveBeenCalledTimes(1);
    expect(service.getProductDetails).toHaveBeenCalledWith('p-1');
  });

  it('ينشئ منتجًا عبر الخدمة ببيانات الطلب كما هي', async () => {
    const body = { code: 'PRD-T02', name: 'قميص', category: 'قمصان' };
    await controller.createProduct(body);
    expect(service.createProduct).toHaveBeenCalledWith(body);
  });

  it('إنشاء منتج مقيّد بدورين: GENERAL_MANAGER وPRODUCTION_MANAGER فقط', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      ProductsController.prototype,
      'createProduct',
    );
    expect(roles).toEqual([
      UserRole.GENERAL_MANAGER,
      UserRole.PRODUCTION_MANAGER,
    ]);
  });
});
