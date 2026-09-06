import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * C8: GlobalExceptionFilter — يلف أي استثناء غير HttpException في استجابة
 * موحدة بـ request ID للبحث في الـ logs، ويرفض تسريب التفاصيل الداخلية
 * في الإنتاج (D8: رسائل أخطاء عامة لا تكشف معلومات حساسة).
 *
 * النمط: { requestId, statusCode, message, timestamp }. الـ request ID يُولَّد
 * عند الاستلام (RequestContext) ويُطبع في logs — فيمكن الـ ops تتبع الخطأ
 * بمعرف واحد عبر كل الطلبات المتتالية.
 *
 * PROD-1 (ب): حماية صافية تحوّل أخطاء Prisma المعروفة (P2025/P2003/P2002)
 * إلى استجابات HTTP عربية موحدة قبل المعالجة العامة — تلتقط ما لم يعالجه
 * الموديولات بنفسها (مسارات idempotency القائمة تلتقط P2002 قبل وصولها
 * هنا فلا يوجد تعارض). أي شفرة أخرى تبقى على المسار العام (500).
 */

/** شفرات Prisma المعروفة → استجابة HTTP موحدة برسالة عربية. */
const PRISMA_ERROR_MAP: Record<
  string,
  { status: HttpStatus; message: string }
> = {
  // السجل المطلوب حذفه/تحديثه غير موجود
  P2025: { status: HttpStatus.NOT_FOUND, message: 'السجل المطلوب غير موجود' },
  // قيد مفتاح أجنبي فشل (سجل مرتبط غير موجود)
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    message: 'مفتاح أجنبي غير صالح — السجل المرتبط غير موجود',
  },
  // تعارض قيد فريد (قيمة مكررة)
  P2002: {
    status: HttpStatus.CONFLICT,
    message: 'تعارض قيد فريد — القيمة مستخدمة مسبقًا',
  },
};

/**
 * قراءة شفرة خطأ Prisma المعروف إن وُجدت — instanceof أولًا، ثم duck-typing
 * على خاصية code (نفس نهج inventory.service) لأن نسخ runtime متعددة تهزم
 * instanceof؛ والقبول مشروط بمطابقة الشفرة لجدول التحويل كي لا نلتقط
 * أخطاءً عادية تحمل خاصية code (مثل أكواد Node مثل ENOENT).
 */
function mapPrismaKnownError(
  exception: unknown,
): { status: HttpStatus; message: string; code: string } | null {
  let code: string | undefined;
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    code = exception.code;
  } else if (typeof exception === 'object' && exception !== null) {
    const candidate = (exception as { code?: unknown }).code;
    if (
      typeof candidate === 'string' &&
      Object.prototype.hasOwnProperty.call(PRISMA_ERROR_MAP, candidate)
    ) {
      code = candidate;
    }
  }
  if (!code) return null;
  const mapped = PRISMA_ERROR_MAP[code];
  return mapped ? { ...mapped, code } : null;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'خطأ داخلي في الخادم';
    let detail: unknown = undefined;

    // PROD-1 (ب): التحويل قبل المعالجة العامة — HttpException أولًا (سلوك
    // الموديولات المدروس له الأولوية)، ثم شفرات Prisma المعروفة، ثم العام.
    const prismaMapped = mapPrismaKnownError(exception);

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, unknown>;
        message =
          typeof r.message === 'string'
            ? r.message
            : Array.isArray(r.message)
              ? r.message.join('; ')
              : message;
        detail = r.error ?? r.detail;
      }
    } else if (prismaMapped) {
      status = prismaMapped.status;
      message = prismaMapped.message;
      // الشفرة وحدها آمنة للعميل (لا تكشف أعمدة أو قيمًا) — meta تُسجَّل فقط.
      detail = { prismaCode: prismaMapped.code };
      const meta =
        exception instanceof Prisma.PrismaClientKnownRequestError
          ? JSON.stringify(exception.meta ?? {})
          : '';
      this.logger.warn(
        `Prisma known error [${requestId}] ${prismaMapped.code}${meta ? ` meta=${meta}` : ''}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (exception instanceof Error) {
      // D8: في الإنتاج لا تُكشف message الـ Error الخام — قد تحوي أسرار.
      if (process.env.NODE_ENV !== 'production') {
        message = exception.message;
      }
      this.logger.error(
        `Unhandled exception [${requestId}]: ${exception.message}`,
        exception.stack,
      );
    }

    // C8: structured log مع الـ requestId — قابل للاستهلاك في أي log aggregator.
    this.logger.error(
      JSON.stringify({
        requestId,
        method: request.method,
        url: request.url,
        statusCode: status,
        message,
      }),
    );

    response.status(status).json({
      requestId,
      statusCode: status,
      message,
      ...(detail !== undefined ? { detail } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
