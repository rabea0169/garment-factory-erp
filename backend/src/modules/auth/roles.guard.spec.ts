import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard, ROLES_KEY, Roles } from './roles.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

describe('RolesGuard (GF-0002)', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const makeContext = (user?: { role?: UserRole }): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const setupMetadata = (options: {
    isPublic?: boolean;
    roles?: UserRole[];
  }) => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return options.isPublic ?? false;
      if (key === ROLES_KEY) return options.roles;
      return undefined;
    });
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('يسمح بالمسارات العامة (@Public) دون فحص أدوار', () => {
    setupMetadata({ isPublic: true, roles: [UserRole.ACCOUNTANT] });
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('يسمح للمسارات بلا @Roles() لأي مستخدم موثّق', () => {
    setupMetadata({});
    expect(guard.canActivate(makeContext({ role: UserRole.VIEWER }))).toBe(
      true,
    );
  });

  it('يرفض حين لا يوجد مستخدم على مسار مقيّد بالأدوار', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT] });
    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });

  it('يرفض الدور غير المدرج في @Roles() (يجب 403)', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT] });
    expect(guard.canActivate(makeContext({ role: UserRole.VIEWER }))).toBe(
      false,
    );
  });

  it('يسمح للدور المدرج في @Roles()', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT, UserRole.CASHIER] });
    expect(guard.canActivate(makeContext({ role: UserRole.CASHIER }))).toBe(
      true,
    );
  });

  it('SUPER_ADMIN يتجاوز قيود الأدوار دائمًا', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT] });
    expect(guard.canActivate(makeContext({ role: UserRole.SUPER_ADMIN }))).toBe(
      true,
    );
  });

  it('decorator @Roles يسجل الأدوار تحت مفتاح ROLES_KEY', () => {
    const meta = Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER);
    expect(ROLES_KEY).toBe('roles');
    expect(typeof meta).toBe('function');
  });
});
