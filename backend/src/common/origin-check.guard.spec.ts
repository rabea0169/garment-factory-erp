import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OriginCheckGuard } from './origin-check.guard';

type MockReq = {
  method?: string;
  path?: string;
  headers: Record<string, string | undefined>;
};

class TestReflector {
  constructor(public isPublic: boolean) {}
  getAllAndOverride<T>(_key: string, _targets: unknown[]): T {
    return (this.isPublic ? true : false) as unknown as T;
  }
}

class TestConfigService {
  constructor(
    private corsOrigins: string,
    private nodeEnv: string = 'production',
  ) {}
  get<T>(key: string, defaultVal?: T): T {
    if (key === 'NODE_ENV') return this.nodeEnv as unknown as T;
    if (key === 'CORS_ORIGINS')
      return (this.corsOrigins ?? defaultVal ?? '') as unknown as T;
    return (defaultVal ?? '') as unknown as T;
  }
}

function makeContext(req: MockReq, _isPublic = false): ExecutionContext {
  const handler = { __originCheck: true };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: req.method ?? 'GET',
        path: req.path ?? '/',
        headers: req.headers,
      }),
    }),
    getHandler: () => handler,
    getClass: () => ({}) as never,
  } as unknown as ExecutionContext;
  return ctx;
}

describe('OriginCheckGuard — SEC-F07 CSRF defense-in-depth', () => {
  it('يسمح بطلبات GET/HEAD/OPTIONS دون فحص', () => {
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService('https://app.example.com') as unknown as never,
    );
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const ctx = makeContext({ method, headers: {} });
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('يسمح بمسار @Public على POST (مثل /auth/login)', () => {
    const guard = new OriginCheckGuard(
      new TestReflector(true) as unknown as Reflector,
      new TestConfigService('https://app.example.com') as unknown as never,
    );
    const ctx = makeContext({ method: 'POST', headers: {} });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('في الإنتاج — يقبل Origin في قائمة CORS_ORIGINS', () => {
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService(
        'https://app.example.com,https://admin.example.com',
      ) as unknown as never,
    );
    const ctx = makeContext({
      method: 'POST',
      headers: { origin: 'https://app.example.com' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('في الإنتاج — يرفض Origin خارج القائمة بـ 403', () => {
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService('https://app.example.com') as unknown as never,
    );
    const ctx = makeContext({
      method: 'POST',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('في الإنتاج — يرفض غياب Origin و Referer بـ 403', () => {
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService('https://app.example.com') as unknown as never,
    );
    const ctx = makeContext({ method: 'POST', headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('يقبل Referer صحيح عندما لا يوجد Origin مباشر', () => {
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService('https://app.example.com') as unknown as never,
    );
    const ctx = makeContext({
      method: 'POST',
      headers: { referer: 'https://app.example.com/orders/123' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('يرفض Referer بمضيف مختلف بـ 403', () => {
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService('https://app.example.com') as unknown as never,
    );
    const ctx = makeContext({
      method: 'POST',
      headers: { referer: 'https://evil.example.com/path' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('في dev (NODE_ENV=development) — يسمح بغياب Origin (curl)', () => {
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService('', 'development') as unknown as never,
    );
    const ctx = makeContext({ method: 'POST', headers: {} });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('في dev — يسمح بأي Origin (CORS_ORIGINS فارغة)', () => {
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService('', 'development') as unknown as never,
    );
    const ctx = makeContext({
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('يسمح بالتخطي الطارئ عبر ORIGIN_CHECK_BYPASS header', () => {
    process.env.ORIGIN_CHECK_BYPASS = 'test-bypass-secret-1234';
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService('https://app.example.com') as unknown as never,
    );
    const ctx = makeContext({
      method: 'POST',
      headers: { 'x-origin-check-bypass': 'test-bypass-secret-1234' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
    delete process.env.ORIGIN_CHECK_BYPASS;
  });

  it('يتجاهل bypass secret قصيرة (<16)', () => {
    process.env.ORIGIN_CHECK_BYPASS = 'short';
    const guard = new OriginCheckGuard(
      new TestReflector(false) as unknown as Reflector,
      new TestConfigService('https://app.example.com') as unknown as never,
    );
    const ctx = makeContext({
      method: 'POST',
      headers: { 'x-origin-check-bypass': 'short' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    delete process.env.ORIGIN_CHECK_BYPASS;
  });
});
