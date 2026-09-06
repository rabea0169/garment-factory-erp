import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import type { ThrottlerStorage } from '@nestjs/throttler';

/**
 * شكل سجل العد — مطابق بنيويًا لواجهة ThrottlerStorageRecord داخل
 * @nestjs/throttler v6.5.0 (totalHits/timeToExpire/isBlocked/timeToBlockExpire).
 * النوع ThrottlerStorageRecord نفسه غير معاد تصديره من جذر الحزمة (ملف
 * throttler-storage-record.interface لا يُعاد تصديره في index) فنعيده
 * محليًا — التوافق النوعي الهيكلي يضمن قبول ThrottlerGuard له بلا تحويل.
 */
export interface RedisThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * CC-7 (GF-IMP-W3): تخزين موزع لحدود المعدل فوق Redis — ينفذ واجهة
 * ThrottlerStorage في @nestjs/throttler v6 (increment(key, ttl, limit,
 * blockDuration, throttlerName) → { totalHits, timeToExpire, isBlocked,
 * timeToBlockExpire }) فيعمل مع ThrottlerGuard القياسي بلا أي حارس مخصص.
 *
 * الذرية: INCR + PEXPIRE + فحص/ضبط الحجب تجري كلها في سكربت Lua واحد
 * (redis EVAL) — تنفيذ ذري على الخادم فلا سباق بين نسختين متزامنتين
 * (المشكلة الجوهرية التي يغلقها هذا المخزن عند التوسع الأفقي).
 *
 * دلالات النافذة: نافذة ثابتة (fixed window) — أول ضربة تفتح النافذة بـ
 * PEXPIRE ttl، وتجاوز الحد يضبط مفتاح حجب منفصل بمدة blockDuration؛
 * انتهاء الحجب يحذف مفتاحه ويبدأ نافذة عدّ نظيفة (مطابقة إعادة الضبط في
 * ThrottlerStorageService الافتراضي). timeToExpire/timeToBlockExpire
 * بالثواني (مطابقة ThrottlerStorageService).
 *
 * أخطاء لينة (soft-fail): فشل Redis (انقطاع/إعادة جدولة) لا يُسقط حدود
 * المعدل — نتحول مؤقتًا إلى عدّ في-memory داخل العملية (نفس سلوك النشر
 * أحادي النسخة الحالي) مع Logger.warning واحد لكل نافذة فشل، وقاطع
 * دائرة بسيط (5 ثوان) يمنع طلبًا معلقًا لكل hit أثناء العطل.
 *
 * ملاحظة ملكية: إذا مررت عميل Redis خاصًا فالملكية لك (لا نُغلق الاتصال)؛
 * إذا مررت URL فنحن ننشئ العميل ونغلقه في onApplicationShutdown.
 */

/** بادئة مفاتيح Redis — عزل عن أي استخدام آخر لنفس الخدمة */
const KEY_PREFIX = 'gf:throttler';
/** مدة قاطع الدائرة بعد فشل Redis (مللي ثانية) قبل إعادة المحاولة */
const REDIS_RETRY_BACKOFF_MS = 5_000;
/** سقف مدخلات الاحتياط في الذاكرة — إخلاء كامل عند بلوغه (نادر عمليًا) */
const FALLBACK_MAX_ENTRIES = 10_000;

/**
 * سكربت Lua الذري — KEYS[1] = مفتاح العدّاد، KEYS[2] = مفتاح الحجب،
 * ARGV[1] = ttl (ms)، ARGV[2] = الحد، ARGV[3] = مدة الحجب (ms).
 * يعيد { totalHits, timeToExpire(s), isBlocked(0/1), timeToBlockExpire(s) }.
 */
const INCREMENT_SCRIPT = `
local blockExists = redis.call('EXISTS', KEYS[2])
local isBlocked = false
local blockPttl = 0
if blockExists == 1 then
  blockPttl = redis.call('PTTL', KEYS[2])
  if blockPttl > 0 then
    isBlocked = true
  else
    -- الحجب انتهى: نحذفه ونبدأ نافذة عدّ نظيفة (مطابقة المخزن الافتراضي)
    redis.call('DEL', KEYS[2])
    redis.call('DEL', KEYS[1])
  end
end
local hits
local pttl
if isBlocked then
  hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  pttl = redis.call('PTTL', KEYS[1])
  if pttl < 0 then pttl = 0 end
else
  hits = redis.call('INCR', KEYS[1])
  if hits == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  pttl = redis.call('PTTL', KEYS[1])
  if pttl < 0 then
    redis.call('SET', KEYS[1], 1, 'PX', ARGV[1])
    hits = 1
    pttl = tonumber(ARGV[1])
  end
  if hits > tonumber(ARGV[2]) then
    redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
    isBlocked = true
    blockPttl = tonumber(ARGV[3])
  end
end
local timeToBlockExpire = 0
if isBlocked then
  timeToBlockExpire = math.ceil(blockPttl / 1000)
end
return { hits, math.ceil(pttl / 1000), isBlocked and 1 or 0, timeToBlockExpire }
`;

/** حالة الاحتياط في الذاكرة لكل مفتاح (نافذة ثابتة) */
interface FallbackEntry {
  totalHits: number;
  expiresAt: number;
  blockExpiresAt: number;
}

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;
  /** هل نحن مالكو العميل (أُنشئ من URL) فيجب إغلاقه عند الإيقاف */
  private readonly ownsConnection: boolean;
  /** قاطع الدائرة: لا نضرب Redis قبل هذه اللحظة بعد فشل */
  private redisDownUntil = 0;

  private readonly fallbackStorage = new Map<string, FallbackEntry>();

  constructor(redisOrUrl: Redis | string) {
    // تضييق النوع قبل الإنشاء — ioredis overloads لا تقبل اتحاد string|Redis
    if (typeof redisOrUrl === 'string') {
      this.ownsConnection = true;
      this.redis = new Redis(redisOrUrl, {
        // فشل سريع بدل تعليق الطلبات: محاولة إعادة واحدة لكل أمر
        maxRetriesPerRequest: 1,
      });
    } else {
      this.ownsConnection = false;
      this.redis = redisOrUrl;
    }
    // مستمع خطأ صامت — يمنع انفجار 'error' بلا مستمع على انقطاع الاتصال
    // (التحذير الفعلي يحدث مرة لكل نافذة فشل في increment)
    this.redis.on('error', (error: Error) => {
      this.logger.debug(`Redis throttler connection error: ${error.message}`);
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<RedisThrottlerRecord> {
    // قاطع الدائرة مفتوح — احتياط الذاكرة مباشرة بلا محاولة Redis
    if (Date.now() >= this.redisDownUntil) {
      try {
        const result = await this.redis.eval(
          INCREMENT_SCRIPT,
          2,
          `${KEY_PREFIX}:hits:${key}`,
          `${KEY_PREFIX}:block:${key}`,
          ttl,
          limit,
          blockDuration,
        );
        this.redisDownUntil = 0;
        const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] =
          result as number[];
        return {
          totalHits: Number(totalHits),
          timeToExpire: Number(timeToExpire),
          isBlocked: Number(isBlocked) === 1,
          timeToBlockExpire: Number(timeToBlockExpire),
        };
      } catch (error) {
        // خطأ لين: تحذير واحد لكل نافذة، ثم احتياط الذاكرة — حدود المعدل
        // لا تسقط مع سقوط Redis (تنخفض جودتها إلى نطاق العملية فقط)
        this.redisDownUntil = Date.now() + REDIS_RETRY_BACKOFF_MS;
        this.logger.warn(
          `Redis throttler storage فشل (${(error as Error).message}) — ` +
            `التحول إلى العد في الذاكرة لمدة ${REDIS_RETRY_BACKOFF_MS / 1000}s ` +
            `(حدود المعدل تعمل داخل هذه النسخة فقط حتى عودة Redis)`,
        );
      }
    }
    return this.fallbackIncrement(key, ttl, limit, blockDuration);
  }

  /**
   * احتياط الذاكرة — نافذة ثابتة مطابقة دلاليًا لسكربت Redis: عدّاد حتى
   * انتهاء النافذة، وحجب منفصل حتى انتهاء مدته، وإعادة عد نظيفة بعده.
   */
  private fallbackIncrement(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): RedisThrottlerRecord {
    const now = Date.now();
    let entry = this.fallbackStorage.get(key);
    if (!entry || entry.expiresAt <= now) {
      if (this.fallbackStorage.size >= FALLBACK_MAX_ENTRIES) {
        this.fallbackStorage.clear();
      }
      entry = { totalHits: 0, expiresAt: now + ttl, blockExpiresAt: 0 };
      this.fallbackStorage.set(key, entry);
    } else if (entry.blockExpiresAt !== 0 && entry.blockExpiresAt <= now) {
      // الحجب انتهى — نافذة عدّ نظيفة (نفس إعادة الضبط في سكربت Lua أعلاه
      // وفي ThrottlerStorageService الافتراضي) بدل إعادة حجب فورية
      entry = { totalHits: 0, expiresAt: now + ttl, blockExpiresAt: 0 };
      this.fallbackStorage.set(key, entry);
    }

    const isBlocked = entry.blockExpiresAt > now;
    if (!isBlocked) {
      entry.totalHits += 1;
      if (entry.totalHits > limit) {
        entry.blockExpiresAt = now + blockDuration;
      }
    }

    const blockedAfterUpdate = entry.blockExpiresAt > now;
    return {
      totalHits: entry.totalHits,
      timeToExpire: Math.max(0, Math.ceil((entry.expiresAt - now) / 1000)),
      isBlocked: blockedAfterUpdate,
      timeToBlockExpire: blockedAfterUpdate
        ? Math.max(0, Math.ceil((entry.blockExpiresAt - now) / 1000))
        : 0,
    };
  }

  /** إغلاق اتصال Redis الذي نملكه فقط — عميل خارجي يبقى لمالكه */
  async onApplicationShutdown(): Promise<void> {
    if (this.ownsConnection) {
      await this.redis.quit().catch(() => this.redis.disconnect());
    }
  }
}
