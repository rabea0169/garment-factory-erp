import 'reflect-metadata';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { IS_PUBLIC_KEY } from './public.decorator';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('AuthController — الوصول العام والتفويض (GF-0003 + SEC-F04)', () => {
  let controller: AuthController;
  let authService: {
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
  };

  const dto: LoginDto = { email: 'admin@factory.com', password: 'Pass@123' };

  beforeEach(() => {
    authService = {
      login: jest.fn().mockResolvedValue({
        access_token: 't',
        refresh_token: 'r',
        user: { id: 'u-1' },
      }),
      refresh: jest.fn().mockResolvedValue({
        access_token: 't2',
        refresh_token: 'r2',
        user: { id: 'u-1' },
      }),
      logout: jest.fn().mockResolvedValue({ revoked: true, reason: 'revoked' }),
    };
    controller = new AuthController(authService as unknown as AuthService);
  });

  it('يفوّض تسجيل الدخول إلى الخدمة بالـ DTO كما ورد', async () => {
    const result = await controller.login(dto);
    expect(authService.login).toHaveBeenCalledWith(dto, {});
    expect(result.access_token).toBe('t');
    // SEC-F04: يجب أن يرجع refresh_token ضمن الـ response
    expect(result.refresh_token).toBe('r');
  });

  it('يعيد profile المستخدم الحالي من سياق JWT', () => {
    const user = {
      id: 'u-1',
      email: 'viewer@factory.com',
      role: 'VIEWER',
    };

    expect(controller.me(user)).toEqual(user);
  });

  it('مسار login معلّم @Public — يجب أن يبقى عامًا وإلا انكسرت المصادقة كلها', () => {
    const isPublic = getMethodMetadata<boolean>(
      IS_PUBLIC_KEY,
      AuthController.prototype,
      'login',
    );
    expect(isPublic).toBe(true);
  });

  it('يضيّق login الـdefault throttler إلى 10 محاولات/دقيقة فقط', () => {
    expect(
      getMethodMetadata<number>(
        'THROTTLER:LIMITdefault',
        AuthController.prototype,
        'login',
      ),
    ).toBe(10);
    expect(
      getMethodMetadata<number>(
        'THROTTLER:TTLdefault',
        AuthController.prototype,
        'login',
      ),
    ).toBe(60_000);
  });

  // SEC-F04: مسار /auth/refresh
  it('يدور /auth/refresh الـ refresh token إلى access+refresh جديدين', async () => {
    const refreshDto: RefreshDto = { refresh_token: 'r'.repeat(96) };
    const result = await controller.refresh(refreshDto);
    expect(authService.refresh).toHaveBeenCalledWith(
      refreshDto.refresh_token,
      {},
    );
    expect(result.access_token).toBe('t2');
    expect(result.refresh_token).toBe('r2');
  });

  it('/auth/refresh معلّم @Public — callable دون access token صالح', () => {
    expect(
      getMethodMetadata<boolean>(
        IS_PUBLIC_KEY,
        AuthController.prototype,
        'refresh',
      ),
    ).toBe(true);
  });

  it('/auth/refresh مقيّد بـ throttle 30/دقيقة', () => {
    expect(
      getMethodMetadata<number>(
        'THROTTLER:LIMITdefault',
        AuthController.prototype,
        'refresh',
      ),
    ).toBe(30);
    expect(
      getMethodMetadata<number>(
        'THROTTLER:TTLdefault',
        AuthController.prototype,
        'refresh',
      ),
    ).toBe(60_000);
  });

  // SEC-F04: مسار /auth/logout
  it('/auth/logout يفوّض الإلغاء إلى AuthService', async () => {
    const logoutDto: RefreshDto = { refresh_token: 'r'.repeat(96) };
    const result = await controller.logout(logoutDto);
    expect(authService.logout).toHaveBeenCalledWith(logoutDto.refresh_token);
    expect(result.revoked).toBe(true);
  });

  it('/auth/logout معلّم @Public — callable حتى بـ access token منتهٍ', () => {
    expect(
      getMethodMetadata<boolean>(
        IS_PUBLIC_KEY,
        AuthController.prototype,
        'logout',
      ),
    ).toBe(true);
  });
});
