import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * C4 + C5: PrismaService مُحصَّن للإنتاج.
 *
 * C4: connection pool قابل للضبط عبر متغيرات البيئة (DB_POOL_MAX / DB_POOL_IDLE
 *     / DB_POOL_TIMEOUT_MS). الافتراضات: max=20, idle=5s, timeout=30s
 *     (vs pg's defaults: max=10, idle=10s, timeout=0). الهدف: تحمّل أحمال إنتاج
 *     أعلى دون connection starvation.
 *
 * C5: withRetry() helper — يعيد تنفيذ دالة 3 مرات بـ exponential backoff
 *     (100/200/400ms) على أخطاء Prisma transient (P1001_BROKER_CONNECTION,
 *     P1002_PEER_CONNECTION, P1017_TRANSACTION_CONFLICT). الـ caller يُمرر
 *     lambda ويحصل على النتيجة أو الخطأ الأخير.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  // C5: قائمة الأخطاء التي تُعاد محاولتها (transient — عابرة).
  private static readonly RETRYABLE_CODES = new Set<string>([
    'P1001', // cannot reach database server
    'P1002', // server reached but invalid
    'P1017', // transaction conflict (typically serializable isolation violation)
  ]);

  // C5: محاولات إعادة + أزمنة backoff.
  private static readonly MAX_RETRIES = 3;
  private static readonly BACKOFF_MS = [100, 200, 400];

  constructor() {
    // GF-0002 / P0-03: DATABASE_URL من البيئة فقط — لا connection string افتراضي في الكود
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL مفقود — لا يوجد fallback. انسخ backend/.env.example إلى backend/.env واضبط قيمة الاتصال.',
      );
    }
    // C4: pool config قابل للضبط — الافتراضات أكثر تحملاً من pg's defaults.
    const max = parseInt(process.env['DB_POOL_MAX'] ?? '20', 10);
    const idleTimeoutMillis = parseInt(
      process.env['DB_POOL_IDLE'] ?? '5000',
      10,
    );
    const connectionTimeoutMillis = parseInt(
      process.env['DB_POOL_TIMEOUT_MS'] ?? '30000',
      10,
    );
    const pool = new Pool({
      connectionString,
      max: Number.isFinite(max) && max > 0 ? max : 20,
      idleTimeoutMillis:
        Number.isFinite(idleTimeoutMillis) && idleTimeoutMillis > 0
          ? idleTimeoutMillis
          : 5000,
      connectionTimeoutMillis:
        Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis > 0
          ? connectionTimeoutMillis
          : 30000,
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(
      `Connected (pool max=${process.env['DB_POOL_MAX'] ?? '20'}, ` +
        `idle=${process.env['DB_POOL_IDLE'] ?? '5000'}ms, ` +
        `timeout=${process.env['DB_POOL_TIMEOUT_MS'] ?? '30000'}ms)`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected');
  }

  /**
   * C5: يُعيد تنفيذ الدالة مع backoff عند الأخطاء transient.
   *
   * @example
   *   const order = await this.prisma.withRetry(() =>
   *     this.prisma.salesOrder.update({ where: { id }, data: { ... } })
   *   );
   *
   * الأخطاء غير transient (P2002 unique, P2025 not found, P2014 relation, ...)
   * لا تُعاد — يرميها مباشرة.
   */
  async withRetry<T>(fn: () => Promise<T>, label = 'query'): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= PrismaService.MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        // تحقق من نوع الخطأ — هل هو transient؟
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          PrismaService.RETRYABLE_CODES.has(error.code)
        ) {
          if (attempt < PrismaService.MAX_RETRIES) {
            const delay = PrismaService.BACKOFF_MS[attempt];
            this.logger.warn(
              `${label} attempt ${attempt + 1} failed with ${error.code} — ` +
                `retrying in ${delay}ms`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }
        // خطأ غير retryable أو تجاوز عدد المحاولات — ارمِ.
        throw error;
      }
    }
    // unreachable — lastError دائماً مُعيَّن لو وصلنا هنا
    throw lastError;
  }
}
