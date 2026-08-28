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
  };

  beforeEach(() => {
    service = {
      getSuppliers: jest.fn().mockResolvedValue([]),
      createSupplier: jest.fn().mockResolvedValue({ id: 'sup-1' }),
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
});
