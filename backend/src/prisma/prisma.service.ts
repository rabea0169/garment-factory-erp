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
 * C4 + C5 + B6 + C7: PrismaService مُحصَّن للإنتاج.
 *
 * C4: connection pool قابل للضبط عبر متغيرات البيئة (DB_POOL_MAX / DB_POOL_IDLE
 *     / DB_POOL_TIMEOUT_MS). الافتراضات: max=20, idle=5s, timeout=30s.
 *
 * C5: withRetry() helper — يعيد تنفيذ دالة 3 مرات بـ exponential backoff
 *     (100/200/400ms) على أخطاء Prisma transient (P1001/P1002/P1017).
 *
 * B6: slow-query log — عبر helper logSlowQuery()، يسجّل أي query تتجاوز
 *     SLOW_QUERY_THRESHOLD_MS (default 500ms). معطّل في test environment.
 *
 * C7: cleanupIdempotencyKeys — ينظّف IdempotencyKey rows المنتهية كل ساعة.
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

  // C7: المؤقت الذي ينظّف IdempotencyKey rows كل ساعة.
  private cleanupTimer: NodeJS.Timeout | null = null;
  private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // ساعة واحدة

  // B6: عتبة الـ slow query (0 = معطّل).
  private readonly _slowQueryThresholdMs: number;

  constructor() {
    // GF-0002 / P0-03: DATABASE_URL من البيئة فقط
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL مفقود — لا يوجد fallback. انسخ backend/.env.example إلى backend/.env واضبط قيمة الاتصال.',
      );
    }
    const max = parseInt(process.env['DB_POOL_MAX'] ?? '20', 10);
    const idleTimeoutMillis = parseInt(
      process.env['DB_POOL_IDLE'] ?? '5000',
      10,
    );
    const connectionTimeoutMillis = parseInt(
      process.env['DB_POOL_TIMEOUT_MS'] ?? '30000',
      10,
    );
    const transactionTimeoutMs = parseInt(
      process.env['DB_TX_TIMEOUT_MS'] ?? '10000',
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
    super({
      adapter,
      transactionOptions: {
        timeout:
          Number.isFinite(transactionTimeoutMs) && transactionTimeoutMs > 0
            ? transactionTimeoutMs
            : 10000,
      },
    });

    // B6: عتبة الـ slow query من البيئة. معطّل في test.
    const slowThresholdMs = parseInt(
      process.env['SLOW_QUERY_THRESHOLD_MS'] ?? '500',
      10,
    );
    const enableSlowLog =
      process.env['NODE_ENV'] !== 'test' &&
      Number.isFinite(slowThresholdMs) &&
      slowThresholdMs > 0;
    this._slowQueryThresholdMs = enableSlowLog ? slowThresholdMs : 0;
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(
      `Connected (pool max=${process.env['DB_POOL_MAX'] ?? '20'}, ` +
        `idle=${process.env['DB_POOL_IDLE'] ?? '5000'}ms, ` +
        `timeout=${process.env['DB_POOL_TIMEOUT_MS'] ?? '30000'}ms, ` +
        `tx_timeout=${process.env['DB_TX_TIMEOUT_MS'] ?? '10000'}ms, ` +
        `slow_query_threshold=${this._slowQueryThresholdMs || 'disabled'}ms)`,
    );

    // C7: ابدأ المؤقت لتنظيف IdempotencyKey rows المنتهية كل ساعة.
    // unref() يسمح للـ Node.js بالخروج دون انتظار المؤقت.
    this.cleanupTimer = setInterval(
      () => void this.cleanupIdempotencyKeys(),
      PrismaService.CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref();
  }

  async onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
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
   */
  async withRetry<T>(fn: () => Promise<T>, label = 'query'): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= PrismaService.MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
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
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * C7: ينظّف IdempotencyKey rows المنتهية (expiresAt < now).
   * يُستدعى تلقائياً كل ساعة، لكن يمكن استدعاؤه يدوياً للأعمدة الطارئة.
   * يعيد عدد الصفوف المحذوفة. لا يرمي — يستمر المؤقت في الدورات التالية.
   */
  async cleanupIdempotencyKeys(): Promise<number> {
    try {
      const result = await this.idempotencyKey.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (result.count > 0) {
        this.logger.log(
          `Cleaned up ${result.count} expired IdempotencyKey rows`,
        );
      }
      return result.count;
    } catch (error) {
      this.logger.warn(
        `Failed to cleanup IdempotencyKey rows: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * B6: يسجّل query بطيئة. الـ middleware الحقيقي سيُضاف مستقبلاً عبر \$extends
   * stable في Prisma 7.x؛ حالياً public method للاختبارات + الاستدعاء اليدوي.
   */
  logSlowQuery(model: string, operation: string, durationMs: number): void {
    if (
      this._slowQueryThresholdMs > 0 &&
      durationMs >= this._slowQueryThresholdMs
    ) {
      this.logger.warn(
        `Slow query: ${model}.${operation} took ${durationMs}ms ` +
          `(threshold=${this._slowQueryThresholdMs}ms)`,
      );
    }
  }
}

export type { Prisma };
