import 'reflect-metadata';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { IS_PUBLIC_KEY } from './public.decorator';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('AuthController — الوصول العام والتفويض (GF-0003)', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock };

  const dto: LoginDto = { email: 'admin@factory.com', password: 'Pass@123' };

  beforeEach(() => {
    authService = {
      login: jest
        .fn()
        .mockResolvedValue({ access_token: 't', user: { id: 'u-1' } }),
    };
    controller = new AuthController(authService as unknown as AuthService);
  });

  it('يفوّض تسجيل الدخول إلى الخدمة بالـ DTO كما ورد', async () => {
    const result = await controller.login(dto);
    expect(authService.login).toHaveBeenCalledWith(dto);
    expect(result.access_token).toBe('t');
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
});
