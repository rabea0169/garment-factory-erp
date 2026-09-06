import { UserRole } from '@prisma/client';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';
import { ROLES_KEY } from '../auth/roles.guard';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

describe('SuppliersController — التفويض والصلاحيات', () => {
  let controller: SuppliersController;
  let service: {
    getSuppliers: jest.Mock;
    createSupplier: jest.Mock;
    updateSupplier: jest.Mock;
    deactivateSupplier: jest.Mock;
    activateSupplier: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getSuppliers: jest.fn().mockResolvedValue([]),
      createSupplier: jest.fn().mockResolvedValue({ id: 'sup-1' }),
      updateSupplier: jest.fn().mockResolvedValue({ id: 'sup-1' }),
      deactivateSupplier: jest.fn().mockResolvedValue({ id: 'sup-1' }),
      activateSupplier: jest.fn().mockResolvedValue({ id: 'sup-1' }),
    };
    controller = new SuppliersController(
      service as unknown as SuppliersService,
    );
  });

  it('delegates supplier listing and creation', async () => {
    const pagination = { page: 1, limit: 20 };
    const body = { name: 'شركة النسيج' };

    await controller.getSuppliers(pagination);
    await controller.createSupplier(body);

    expect(service.getSuppliers).toHaveBeenCalledWith(pagination);
    // RES-F02: controller forwards an optional idempotency-key header (undefined in this test).
    expect(service.createSupplier).toHaveBeenCalledWith(body, undefined);
  });

  it('protects supplier creation with inventory or general manager roles', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      SuppliersController.prototype,
      'createSupplier',
    );

    expect(roles).toEqual([
      UserRole.INVENTORY_MANAGER,
      UserRole.GENERAL_MANAGER,
    ]);
  });

  // PUR-7 (P2 — GF-IMP-W3): مسارات التحديث/التعطيل/التنشيط — التفويض
  // بالفاعل والمفتاح، والأدوار INVENTORY_MANAGER/GENERAL_MANAGER.
  it('PUR-7 (أ): update يمرر id والحمولة والفاعل وIdempotency-Key', async () => {
    const body = { phone: '01111111111' };
    await controller.updateSupplier('sup-1', body, 'actor-1', 'update-key-1');

    expect(service.updateSupplier).toHaveBeenCalledWith(
      'sup-1',
      body,
      'actor-1',
      'update-key-1',
    );
  });

  it('PUR-7 (ب): deactivate/activate يمرران id والفاعل والمفتاح', async () => {
    await controller.deactivateSupplier('sup-1', 'actor-1', 'off-key-1');
    expect(service.deactivateSupplier).toHaveBeenCalledWith(
      'sup-1',
      'actor-1',
      'off-key-1',
    );

    await controller.activateSupplier('sup-1', 'actor-1', 'on-key-1');
    expect(service.activateSupplier).toHaveBeenCalledWith(
      'sup-1',
      'actor-1',
      'on-key-1',
    );
  });

  const WRITE_ROUTES: Array<[string, string]> = [
    ['updateSupplier', 'تحديث مورد'],
    ['deactivateSupplier', 'تعطيل مورد'],
    ['activateSupplier', 'تنشيط مورد'],
  ];

  it.each(WRITE_ROUTES)(
    'PUR-7: %s مقيد بـ INVENTORY_MANAGER وGENERAL_MANAGER (%s)',
    (method) => {
      const roles = getMethodMetadata<UserRole[]>(
        ROLES_KEY,
        SuppliersController.prototype,
        method,
      );
      expect(roles).toEqual([
        UserRole.INVENTORY_MANAGER,
        UserRole.GENERAL_MANAGER,
      ]);
    },
  );
});
