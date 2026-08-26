import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { RequestContextInterceptor } from './common/request-context.interceptor';

/**
 * تهيئة HTTP المشتركة بين التشغيل التقليدي وVercel Functions.
 * لا تستدعي listen حتى يمكن إعادة استخدام نفس التطبيق داخل serverless runtime.
 */
export async function createConfiguredApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';

  // C2: Helmet — security headers. في dev نعطّل CSP كي يعمل Swagger UI.
  app.use(helmet(isProd ? undefined : { contentSecurityPolicy: false }));

  // C8: GlobalExceptionFilter — لف الاستثناءات باستجابة موحدة وrequestId.
  app.useGlobalFilters(new GlobalExceptionFilter());

  // C8: RequestContextInterceptor — يضيف requestId لكل طلب.
  app.useGlobalInterceptors(new RequestContextInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS من البيئة فقط (GF-0002 / P1-01).
  const corsOrigins = (configService.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // C6: Swagger gating — مُعطّل في الإنتاج افتراضياً.
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

  app.enableShutdownHooks();
  return app;
}

export function getStartupLogContext(app: INestApplication): {
  nodeEnv: string;
  swaggerEnabled: boolean;
} {
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const swaggerEnabled =
    configService.get<string>(
      'SWAGGER_ENABLED',
      nodeEnv === 'production' ? 'false' : 'true',
    ) === 'true';
  return { nodeEnv, swaggerEnabled };
}
