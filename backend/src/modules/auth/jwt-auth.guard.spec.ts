import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

describe('JwtAuthGuard (GF-0002 — fail-closed)', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const makeContext = (): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => ({}),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
  });

  it('يسمح بالمرور للمسار المعلّم بـ @Public() دون أي توكن', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('يفحص بيانات isPublic على مستوى الـ handler والـ class معًا', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = makeContext();
    void guard.canActivate(ctx);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });

  // ملاحظة: رفض المسار المحمي (401) يُثبت فعليًا في test/auth-guard.e2e-spec.ts
  // حيث JwtStrategy مسجلة ضمن تطبيق كامل — 7 سيناريوهات 401 هناك.
});
