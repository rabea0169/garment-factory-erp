import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard, ROLES_KEY, Roles } from './roles.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

describe('RolesGuard (GF-0002)', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock; get: jest.Mock };

  const makeContext = (
    user?: { role?: UserRole; permissions?: unknown },
    method = 'GET',
  ): ExecutionContext => {
    // SELIM-ERP W4: هويات مميزة للمعالج والمتحكم — كي يميز mock الـ reflector
    // بين استدعائي get('path', class) و get('path', handler).
    const handler = { __handler: true };
    const klass = { __class: true };
    return {
      getHandler: () => handler,
      getClass: () => klass,
      switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
    } as unknown as ExecutionContext;
  };

  const setupMetadata = (options: {
    isPublic?: boolean;
    roles?: UserRole[];
    controllerPath?: string;
    handlerPath?: string;
  }) => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return options.isPublic ?? false;
      if (key === ROLES_KEY) return options.roles;
      return undefined;
    });
    // SELIM-ERP W4: مسارات المتحكم/المعالج لاستنتاج المورد.
    reflector.get.mockImplementation((key: string) => {
      if (key === 'path') {
        return undefined;
      }
      return undefined;
    });
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn(), get: jest.fn() };
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

  // ------------------------------------------------------------------
  // SELIM-ERP W4 — الطبقة الثانية: صلاحية صريحة تفتح مسارًا فوق الدور
  // (نفس checkPermission في المرجع SPRINT 81).
  // ------------------------------------------------------------------

  const setupRoute = (
    ctx: ExecutionContext,
    controllerPath: string,
    handlerPath?: string,
  ) => {
    reflector.get.mockImplementation((key: string, target: unknown) => {
      if (key !== 'path') {
        return undefined;
      }
      if (target === ctx.getClass()) {
        return controllerPath;
      }
      if (target === ctx.getHandler()) {
        return handlerPath;
      }
      return undefined;
    });
  };

  it('W4: صلاحية صريحة مطابقة تفتح المسار رغم عدم توفر الدور', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT] });
    const ctx = makeContext(
      {
        role: UserRole.CASHIER,
        permissions: [{ resource: 'sales', action: 'READ' }],
      },
      'GET',
    );
    setupRoute(ctx, 'sales', undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('W4: صلاحية بإجراء مختلف لا تفتح المسار (READ لا تفتح POST)', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT] });
    const ctx = makeContext(
      {
        role: UserRole.CASHIER,
        permissions: [{ resource: 'sales', action: 'READ' }],
      },
      'POST',
    );
    setupRoute(ctx, 'sales', undefined);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('W4: البدل *:* يفتح كل شيء لغير SUPER_ADMIN إن مُنح صراحةً', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT] });
    const ctx = makeContext(
      {
        role: UserRole.VIEWER,
        permissions: [{ resource: '*', action: '*' }],
      },
      'GET',
    );
    setupRoute(ctx, 'financial-reports', 'customer-statement');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('W4: مورد مختلف عن المسار لا يفتحه (لا تسريب عرضي)', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT] });
    const ctx = makeContext(
      {
        role: UserRole.VIEWER,
        permissions: [{ resource: 'sales', action: 'READ' }],
      },
      'GET',
    );
    setupRoute(ctx, 'users', undefined);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('W4: استنتاج المورد يفك الأسماء البديلة (purchasing→purchases)', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT] });
    const ctx = makeContext(
      {
        role: UserRole.VIEWER,
        permissions: [{ resource: 'purchases', action: 'CREATE' }],
      },
      'POST',
    );
    setupRoute(ctx, 'purchasing', undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('W4: مورد فرعي من مسار المعالج (system/audit-logs)', () => {
    setupMetadata({ roles: [UserRole.GENERAL_MANAGER] });
    const ctx = makeContext(
      {
        role: UserRole.VIEWER,
        permissions: [{ resource: 'audit-logs', action: 'READ' }],
      },
      'GET',
    );
    setupRoute(ctx, 'system', 'audit-logs');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('W4: صلاحيات JSON دخيلة (بنية غير صفيف) لا تفتح شيئًا', () => {
    setupMetadata({ roles: [UserRole.ACCOUNTANT] });
    const ctx = makeContext(
      {
        role: UserRole.CASHIER,
        permissions: { resource: 'sales', action: 'READ' },
      },
      'GET',
    );
    setupRoute(ctx, 'sales', undefined);
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
