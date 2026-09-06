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
    // PROD-7: includeInactive يمرر false افتراضيًا (توحيد السلوكين)
    expect(service.getProductDetails).toHaveBeenCalledWith(
      '123e4567-e89b-12d3-a456-426614174000',
      false,
    );
  });

  // PROD-7: معامل الاستعلام includeInactive يُمرر كقيمة منطقية للخدمتين
  it('PROD-7: includeInactive=true يمرر إلى قائمة المنتجات وتفاصيله', async () => {
    await controller.getAllProducts({}, 'true');
    await controller.getProduct('123e4567-e89b-12d3-a456-426614174000', 'true');

    expect(service.getAllProducts).toHaveBeenCalledWith({}, true);
    expect(service.getProductDetails).toHaveBeenCalledWith(
      '123e4567-e89b-12d3-a456-426614174000',
      true,
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
    await controller.createFullProduct(body, 'user-1');
    // PROD-6: الفاعل من الجلسة يمرر للخدمة لسجل التدقيق (idempotencyKey ثم actorId)
    expect(service.createFullProduct).toHaveBeenCalledWith(
      body,
      undefined,
      'user-1',
    );
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
    await controller.createVariant(
      productId,
      { size: 'L', color: 'أزرق' },
      'user-1',
    );
    expect(service.createVariant).toHaveBeenCalledWith(
      productId,
      'L',
      'أزرق',
      undefined,
      'user-1',
    );
  });

  it('يفوّض إضافة BOM إلى الخدمة', async () => {
    const productId = '123e4567-e89b-12d3-a456-426614174000';
    const rawMaterialId = '223e4567-e89b-12d3-a456-426614174000';
    await controller.addBomItem(
      productId,
      {
        rawMaterialId,
        quantity: 1.25,
        unit: 'METER',
      },
      'user-1',
    );
    expect(service.addBomItem).toHaveBeenCalledWith(
      productId,
      rawMaterialId,
      1.25,
      'METER',
      undefined,
      'user-1',
    );
  });

  it('يفوّض حذف BOM إلى الخدمة مع فاعل الجلسة (PROD-6)', async () => {
    const bomId = '323e4567-e89b-12d3-a456-426614174000';
    await controller.deleteBomItem(bomId, 'user-1');
    expect(service.deleteBomItem).toHaveBeenCalledWith(bomId, 'user-1');
  });
});
