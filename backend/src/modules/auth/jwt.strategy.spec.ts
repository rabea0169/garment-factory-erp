import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AUTH-8: فجوة اختبار JwtStrategy — validate هو خط الدفاع الأول للنظام
 * (توكن صالح / مستخدم غائب / مستخدم غير مفعل / عدم تطابق v / غياب v)
 * ولم يكن له أي مواصفة وحدة. كل حالة هنا تُستدعى مباشرة على الاستراتيجية
 * (لا عبر HTTP) كي تُفحص الشروط المنطقية بمعزل عن إطار passport.
 */

const TEST_JWT_SECRET = 'x'.repeat(48); // 48 حرفًا — يتجاوز حد الإنتاج (32)

/** مستخدم نشط قياسي — jwtVersion=0 كما تزرعه البذرة الحالية */
const activeUser = {
  id: 'u-1',
  name: 'مدير',
  email: 'admin@factory.com',
  phone: '01000000000',
  role: 'SUPER_ADMIN',
  isActive: true,
  jwtVersion: 0,
  password: 'hashed-secret',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeConfig(env: Record<string, string | undefined> = {}) {
  return {
    get: (key: string) => env[key] ?? undefined,
  };
}

function makeStrategy(
  user: typeof activeUser | null,
  env: Record<string, string | undefined> = { JWT_SECRET: TEST_JWT_SECRET },
) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
  };
  const strategy = new JwtStrategy(
    makeConfig(env) as never,
    prisma as unknown as PrismaService,
  );
  return { strategy, prisma };
}

describe('JwtStrategy — SEC-F04 revoke-by-version (AUTH-6/AUTH-8)', () => {
  it('توكن صالح: مستخدم نشط و v يطابق jwtVersion → يعيد المستخدم بلا كلمة المرور', async () => {
    const { strategy } = makeStrategy(activeUser);
    const result = await strategy.validate({
      sub: 'u-1',
      email: 'admin@factory.com',
      v: 0,
    });
    expect(result).toMatchObject({ id: 'u-1', role: 'SUPER_ADMIN' });
    expect(result).not.toHaveProperty('password');
  });

  it('مستخدم غائب → 401', async () => {
    const { strategy } = makeStrategy(null);
    await expect(
      strategy.validate({ sub: 'ghost', email: 'ghost@t.co', v: 0 }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('مستخدم غير مفعل (isActive=false) → 401', async () => {
    const { strategy } = makeStrategy({ ...activeUser, isActive: false });
    await expect(
      strategy.validate({ sub: 'u-1', email: 'admin@factory.com', v: 0 }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('عدم تطابق v (توكن صدر قبل logout) → 401', async () => {
    // jwtVersion ارتفع إلى 1 بعد logout — التوكن القديم ما زال v=0
    const { strategy } = makeStrategy({ ...activeUser, jwtVersion: 1 });
    await expect(
      strategy.validate({ sub: 'u-1', email: 'admin@factory.com', v: 0 }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('AUTH-6: توكن بلا حقل v إطلاقًا → 401 (يعامل الغياب كعدم تطابق)', async () => {
    const { strategy } = makeStrategy(activeUser);
    await expect(
      strategy.validate({
        sub: 'u-1',
        email: 'admin@factory.com',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('AUTH-6: v قيمة غير رقمية (string) → 401 — لا يُقبل التلاعب بالنوع', async () => {
    const { strategy } = makeStrategy(activeUser);
    await expect(
      strategy.validate({
        sub: 'u-1',
        email: 'admin@factory.com',
        v: '0',
      } as unknown as { sub: string; email: string; v?: number }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('AUTH-6: v رقم غير منتهٍ (NaN) → 401', async () => {
    const { strategy } = makeStrategy(activeUser);
    await expect(
      strategy.validate({ sub: 'u-1', email: 'admin@factory.com', v: NaN }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('يفشل الإقلاع عند غياب JWT_SECRET (fail-closed — بلا fallback)', () => {
    expect(() => makeStrategy(activeUser, {})).toThrow(/JWT_SECRET غير معرف/);
  });
});
