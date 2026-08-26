import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConfiguredApp, getStartupLogContext } from './app-setup';

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * فحص fail-closed لمتغيرات البيئة (GF-0002):
 * يعيد قائمة المشكلات — أي مشكلة توقف الإقلاع قبل فتح أي منفذ.
 */
export function assertRequiredEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const problems: string[] = [];

  const jwtSecret = env['JWT_SECRET'];
  if (!jwtSecret) {
    problems.push(
      'JWT_SECRET مفقود — لا يوجد fallback. انسخ backend/.env.example إلى backend/.env وحدد قيمة عشوائية.',
    );
  } else if (
    nodeEnv === 'production' &&
    jwtSecret.length < MIN_JWT_SECRET_LENGTH
  ) {
    problems.push(
      `JWT_SECRET أقصر من ${MIN_JWT_SECRET_LENGTH} حرفًا (${jwtSecret.length}) — غير مقبول في الإنتاج.`,
    );
  }

  if (!env['DATABASE_URL']) {
    problems.push(
      'DATABASE_URL مفقود — لا يوجد connection string افتراضي في الكود.',
    );
  }

  if (nodeEnv === 'production') {
    const cors = env['CORS_ORIGINS'];
    if (!cors || cors.trim() === '*') {
      problems.push(
        'CORS_ORIGINS مفقود أو "*" في الإنتاج — حدد قائمة النطاقات المسموحة مفصولة بفواصل.',
      );
    }
  }

  return problems;
}

export async function bootstrap(): Promise<void> {
  // GF-0002: fail-closed — لا إقلاع بلا متغيرات بيئة كافية.
  const problems = assertRequiredEnv();
  if (problems.length > 0) {
    console.error('[startup] فشل التحقق من متغيرات البيئة (fail-closed):');
    for (const problem of problems) {
      console.error('  -', problem);
    }
    process.exit(1);
  }

  const app = await createConfiguredApp();
  const { nodeEnv, swaggerEnabled } = getStartupLogContext(app);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000) ?? 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(
    `🚀 Garment Factory ERP Backend is running on: http://localhost:${port}`,
  );
  if (swaggerEnabled) {
    logger.log(`📚 API Docs available at: http://localhost:${port}/api/docs`);
  }
  logger.log(`🌍 NODE_ENV=${nodeEnv} · SWAGGER_ENABLED=${swaggerEnabled}`);
}

// يُشغَّل bootstrap فقط عند التشغيل المباشر، ويسمح باستيراد assertRequiredEnv
// وcreateConfiguredApp من الاختبارات وVercel دون فتح منفذ أثناء الاستيراد.
if (require.main === module) {
  void bootstrap();
}
