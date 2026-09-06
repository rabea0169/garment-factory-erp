import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';

/**
 * CC-9 (GF-IMP-W2): تفويض المتحكم — كل المسارات SUPER_ADMIN فقط + تمرير
 * actor وIdempotency-Key إلى الخدمة بنمط purchasing.controller.
 */
describe('UsersController — التفويض والصلاحيات (CC-9)', () => {
  let controller: UsersController;
  let service: {
    listUsers: jest.Mock;
    createUser: jest.Mock;
    changeUserRole: jest.Mock;
    deactivateUser: jest.Mock;
    activateUser: jest.Mock;
  };

  const expectSuperAdminOnly = (methodName: string) => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      UsersController.prototype,
      methodName,
    );
    expect(roles).toEqual([UserRole.SUPER_ADMIN]);
  };

  beforeEach(() => {
    service = {
      listUsers: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      createUser: jest.fn().mockResolvedValue({ id: 'u-1' }),
      changeUserRole: jest.fn().mockResolvedValue({ id: 'u-1' }),
      deactivateUser: jest.fn().mockResolvedValue({ id: 'u-1' }),
      activateUser: jest.fn().mockResolvedValue({ id: 'u-1' }),
    };
    controller = new UsersController(service as unknown as UsersService);
  });

  it('كل مسار users مقصور على SUPER_ADMIN', () => {
    expectSuperAdminOnly('listUsers');
    expectSuperAdminOnly('createUser');
    expectSuperAdminOnly('changeRole');
    expectSuperAdminOnly('deactivate');
    expectSuperAdminOnly('activate');
  });

  it('create يمرر DTO وactor وIdempotency-Key إلى الخدمة', async () => {
    const dto: CreateUserDto = {
      name: 'سارة أحمد',
      email: 'sara@factory.com',
      password: 'Pass@123',
      role: UserRole.INVENTORY_MANAGER,
    };
    await controller.createUser(dto, 'admin-1', 'user-key-1');

    expect(service.createUser).toHaveBeenCalledWith(
      dto,
      'admin-1',
      'user-key-1',
    );
    // بلا مفتاح: undefined يُمرَّر كما في نمط suppliers
    await controller.createUser(dto, 'admin-1');
    expect(service.createUser).toHaveBeenLastCalledWith(
      dto,
      'admin-1',
      undefined,
    );
  });

  it('list يمرر الـ Query DTO إلى الخدمة', async () => {
    const query = { page: 2, limit: 50 } as never;
    await controller.listUsers(query);
    expect(service.listUsers).toHaveBeenCalledWith(query);
  });

  it('changeRole يمرر id والدور الجديد وactor وIdempotency-Key', async () => {
    const dto: ChangeUserRoleDto = { role: UserRole.ACCOUNTANT };
    await controller.changeRole('u-9', dto, 'admin-1', 'role-key-1');

    expect(service.changeUserRole).toHaveBeenCalledWith(
      'u-9',
      UserRole.ACCOUNTANT,
      'admin-1',
      'role-key-1',
    );
  });

  it('deactivate/activate يمرران id وactor وIdempotency-Key', async () => {
    await controller.deactivate('u-9', 'admin-1', 'off-key');
    expect(service.deactivateUser).toHaveBeenCalledWith(
      'u-9',
      'admin-1',
      'off-key',
    );

    await controller.activate('u-9', 'admin-1', 'on-key');
    expect(service.activateUser).toHaveBeenCalledWith(
      'u-9',
      'admin-1',
      'on-key',
    );
  });
});
