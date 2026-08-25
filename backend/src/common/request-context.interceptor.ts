import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * C8: RequestContextInterceptor — يضيف requestId لكل طلب ويُمرره للـ logger
 * ولاستجابة الخطأ (الـ GlobalExceptionFilter يستهلكه). يبقى الـ header
 * X-Request-Id إن أرسله العميل، وإلا نُولّد UUID جديد.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { requestId?: string }>();
    const incoming = req.headers['x-request-id'] as string | undefined;
    req.requestId = incoming ?? randomUUID();
    return next.handle();
  }
}
