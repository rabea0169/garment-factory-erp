import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { RequestContextInterceptor } from './common/request-context.interceptor';

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

async function bootstrap() {
  // GF-0002: fail-closed — لا إقلاع بلا متغيرات بيئة كافية
  const problems = assertRequiredEnv();
  if (problems.length > 0) {
    console.error('[startup] فشل التحقق من متغيرات البيئة (fail-closed):');
    for (const problem of problems) {
      console.error('  -', problem);
    }
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';

  // C2: Helmet — security headers. في dev نعطّل CSP كي يعمل Swagger UI.
  app.use(helmet(isProd ? undefined : { contentSecurityPolicy: false }));

  // C8: GlobalExceptionFilter — لف أي استثناء غير HttpException في
  // استجابة موحدة بـ requestId (قابل للتتبع في الـ logs).
  app.useGlobalFilters(new GlobalExceptionFilter());

  // C8: RequestContextInterceptor — يضيف requestId لكل طلب.
  app.useGlobalInterceptors(new RequestContextInterceptor());

  // تفعيل التحقق من صحة البيانات عالمياً
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS من البيئة فقط (GF-0002 / P1-01):
  // قائمة origins مفصولة بفواصل؛ في غير الإنتاج وغياب القيمة يسمح بالكل للراحة التطويرية
  const corsOrigins = (configService.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // C6: Swagger gating — مُعطّل في الإنتاج افتراضياً، يُفعَّل عبر SWAGGER_ENABLED=true.
  const swaggerEnabled =
    configService.get<string>('SWAGGER_ENABLED', isProd ? 'false' : 'true') ===
    'true';
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Garment Factory ERP API')
      .setDescription('نظام ERP لإدارة مصنع الملابس الجاهزة — توثيق الـ API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  // C3: graceful shutdown — يستجيب لـ SIGTERM/SIGINT ويسمح بإغلاق
  // الـ DB pool والـ event listeners بأمان قبل الخروج.
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3000);
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

// يُشغَّل bootstrap فقط عند التشغيل المباشر (node dist/main) —
// يسمح باستيراد assertRequiredEnv في الاختبارات دون إقلاع الخادم
if (require.main === module) {
  void bootstrap();
}
