import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../modules/auth/public.decorator';
import type { Request } from 'express';

/**
 * SEC-F07 — OriginCheckGuard (Defense-in-Depth CSRF).
 *
 * لماذا؟ الـ API يعتمد على Bearer token (Authorization header) ولا يستعمل
 * cookies، فالـ CSRF الكلاسيكي غير قابل للاستغلال (المتصفح لا يُرسل
 * Authorization تلقائيًا). لكن دفاعًا في عمق المعزّز:
 *   - على كل طلب State-changing (POST/PUT/PATCH/DELETE) لمسار غير @Public،
 *     نتحقق أن header Origin (أو Referer احتياطيًا) موجود ومُدرج في قائمة
 *     CORS_ORIGINS المسموح بها.
 *   - المتصفح يُرسل Origin/Referer دائمًا لطلبات same-origin و cross-site
 *     القابلة للـpreflight؛ غيابه يعني طلبًا غير متصفّحي (curl/scripts) —
 *     هذا متوقع للعملاء المشروعين خارج المتصفح، لذا نُفعّل الحماية عبر
 *     metadata decorator `@CheckOrigin()` لكل متحكم يريد فرضها،
 *     بدلًا من فرضها عالميًا وكاسر الـ unit tests.
 *
 * INF-6 (GF-IMP-W3): الحارس موصول عالميًا الآن عبر APP_GUARD في app.module.ts
 * بعد JwtAuthGuard وRolesGuard (الترتيب: throttler ← auth ← roles ← origin) —
 * كان قبل ذلك كودًا مكتملًا ومختبرًا وميت التفعيل. المسارات @Public (مثل
 * /auth/login) معفاة أصلًا، وطلبات القراءة (GET/HEAD/OPTIONS) تمر بلا فحص.
 *
 * الـ config:
 *   - CORS_ORIGINS (env): قائمة origins مفصولة بفواصل. لازم في الإنتاج.
 *   - في dev (NODE_ENV !== 'production') وعند غياب CORS_ORIGINS نسمح بالكل
 *     (لمطابقة behavior الـ CORS dev).
 *   - ORIGIN_CHECK_BYPASS (env): قيمة سرية لتخطي الفحص (للتشخيل الطارئ فقط).
 */
const ORIGIN_CHECK_BYPASS_HEADER = 'x-origin-check-bypass';

@Injectable()
export class OriginCheckGuard implements CanActivate {
  private readonly logger = new Logger(OriginCheckGuard.name);
  private readonly allowedOrigins: Set<string>;
  private readonly isProd: boolean;

  constructor(
    private readonly reflector: Reflector,
    configService: ConfigService,
  ) {
    this.isProd =
      configService.get<string>('NODE_ENV', 'development') === 'production';
    const raw = (configService.get<string>('CORS_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    this.allowedOrigins = new Set(raw);
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const method = (req.method ?? 'GET').toUpperCase();

    // SEC-F07: نطبّق على State-changing methods فقط.
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    // التخطي الطارئ للاختبار/التشخيل (قيمة سرية من البيئة)
    const bypassSecret = process.env.ORIGIN_CHECK_BYPASS;
    if (
      bypassSecret &&
      bypassSecret.length >= 16 &&
      req.headers[ORIGIN_CHECK_BYPASS_HEADER] === bypassSecret
    ) {
      this.logger.warn(
        `OriginCheckGuard bypassed via ${ORIGIN_CHECK_BYPASS_HEADER} — method=${method} path=${req.path}`,
      );
      return true;
    }

    const origin = req.headers['origin'] ?? null;
    const referer = req.headers['referer'] ?? null;
    const source = origin ?? this.extractOriginFromReferer(referer);

    if (!source) {
      // SEC-F07 + INF-6: لا Origin ولا Referer — طلب غير متصفّحي: عميل مشروع
      // خارج المتصفح (تطبيق الجوال Dio لا يرسل Origin، وcurl والتكاملات
      // كذلك). فحص الأصل دفاعٌ ضد المتصفحات العابرة فحسب، لذا نسمح للطلب —
      // الحماية تبقى كاملة للطلبات التي تحمل أصلًا (فوق). الرفض هنا كان
      // سيكسر تطبيق الجوال في الإنتاج بعد الوصل العالمي للحارس.
      return true;
    }

    // قائمة فارغة في غير الإنتاج = اسمح بالكل (matching الـ CORS dev).
    if (!this.isProd && this.allowedOrigins.size === 0) {
      return true;
    }

    if (this.allowedOrigins.has(source)) {
      return true;
    }

    this.logger.warn(
      `OriginCheckGuard rejected — method=${method} path=${req.path} origin=${source}`,
    );
    throw new ForbiddenException(
      `الأصل (Origin) غير مسموح به: ${source}. راجع CORS_ORIGINS في إعدادات الخادم.`,
    );
  }

  private extractOriginFromReferer(referer: string | null): string | null {
    if (!referer) return null;
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      return null;
    }
  }
}
