import { assertRequiredEnv } from './main';

/**
 * GF-0002 / معيار القبول 3:
 * غياب JWT_SECRET أو قصره عن 32 حرفًا في الإنتاج يجب أن يوقف الإقلاع.
 */
describe('assertRequiredEnv (fail-closed startup validation)', () => {
  const LONG_SECRET = 'a'.repeat(48);
  const SHORT_SECRET = 'short-secret';

  it('يفشل عند غياب JWT_SECRET في أي بيئة', () => {
    const problems = assertRequiredEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/db',
    });
    expect(problems.some((p) => p.includes('JWT_SECRET'))).toBe(true);
  });

  it('يفشل عند غياب DATABASE_URL في أي بيئة', () => {
    const problems = assertRequiredEnv({
      NODE_ENV: 'development',
      JWT_SECRET: LONG_SECRET,
    });
    expect(problems.some((p) => p.includes('DATABASE_URL'))).toBe(true);
  });

  it('يفشل في الإنتاج عندما JWT_SECRET أقصر من 32 حرفًا (معيار القبول 3)', () => {
    const problems = assertRequiredEnv({
      NODE_ENV: 'production',
      JWT_SECRET: SHORT_SECRET,
      DATABASE_URL: 'postgresql://localhost:5432/db',
      CORS_ORIGINS: 'https://app.example.com',
    });
    expect(problems.some((p) => p.includes('32'))).toBe(true);
  });

  it('يفشل في الإنتاج عند غياب CORS_ORIGINS أو قيمته *', () => {
    const noCors = assertRequiredEnv({
      NODE_ENV: 'production',
      JWT_SECRET: LONG_SECRET,
      DATABASE_URL: 'postgresql://localhost:5432/db',
    });
    expect(noCors.some((p) => p.includes('CORS_ORIGINS'))).toBe(true);

    const starCors = assertRequiredEnv({
      NODE_ENV: 'production',
      JWT_SECRET: LONG_SECRET,
      DATABASE_URL: 'postgresql://localhost:5432/db',
      CORS_ORIGINS: '*',
    });
    expect(starCors.some((p) => p.includes('CORS_ORIGINS'))).toBe(true);
  });

  it('يقبل الإعدادات الكاملة الصحيحة في الإنتاج دون أي مشكلات', () => {
    const problems = assertRequiredEnv({
      NODE_ENV: 'production',
      JWT_SECRET: LONG_SECRET,
      DATABASE_URL: 'postgresql://localhost:5432/db',
      CORS_ORIGINS: 'https://app.example.com',
    });
    expect(problems).toHaveLength(0);
  });

  it('يسمح في التطوير بسر أقصر من 32 (تحذير فقط) مع اكتمال البقية', () => {
    const problems = assertRequiredEnv({
      NODE_ENV: 'development',
      JWT_SECRET: SHORT_SECRET,
      DATABASE_URL: 'postgresql://localhost:5432/db',
    });
    expect(problems).toHaveLength(0);
  });
});
