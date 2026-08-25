import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
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
 */
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
