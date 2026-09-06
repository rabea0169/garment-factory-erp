import Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * CC-7 (GF-IMP-W3): مواصفة وحدة لـ RedisThrottlerStorage بمحاكاة عميل
 * ioredis — تتحقق من: توقيع increment الفعلي لـ @nestjs/throttler v6،
 * ذراعية استدعاء EVAL الواحد (مفتاحا hits/block + الثلاث معاملات)، تحويل
 * الرد إلى ThrottlerStorageRecord، الاحتياط اللين في الذاكرة عند فشل
 * Redis، قاطع الدائرة، واستعادة Redis بعد النافذة.
 */

// ioredis مُحاكى بالكامل — لا اتصال حقيقي في أي اختبار
jest.mock('ioredis', () => {
  const makeClient = () => ({
    on: jest.fn(),
    eval: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  });
  const RedisCtor = jest.fn().mockImplementation(() => makeClient());
  return { __esModule: true, default: RedisCtor };
});

/** عميل mock خارجي (ملكية المستدعي — لا يُغلق عند الإيقاف) */
function makeExternalClient() {
  return {
    on: jest.fn(),
    eval: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  };
}

describe('RedisThrottlerStorage — CC-7 تخزين موزع لحدود المعدل', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (Redis as unknown as jest.Mock).mockClear();
  });

  it('increment يستدعي EVAL واحدًا ذريًا بمفتاحي hits/block والمعاملات الثلاثة', async () => {
    const client = makeExternalClient();
    client.eval.mockResolvedValue([3, 42, 0, 0]);
    const storage = new RedisThrottlerStorage(client as unknown as Redis);

    const record = await storage.increment(
      'key-1',
      60_000,
      100,
      60_000,
      'default',
    );

    expect(client.eval).toHaveBeenCalledTimes(1);
    const [script, numKeys, hitsKey, blockKey, ttl, limit, blockDuration] =
      client.eval.mock.calls[0] as unknown[];
    expect(script).toContain('INCR');
    expect(script).toContain('PEXPIRE');
    expect(numKeys).toBe(2);
    expect(hitsKey).toBe('gf:throttler:hits:key-1');
    expect(blockKey).toBe('gf:throttler:block:key-1');
    expect(ttl).toBe(60_000);
    expect(limit).toBe(100);
    expect(blockDuration).toBe(60_000);
    expect(record).toEqual({
      totalHits: 3,
      timeToExpire: 42,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('يحوّل رد Lua الحجب (1) إلى isBlocked=true مع timeToBlockExpire — ويحتمل ردودًا نصية', async () => {
    const client = makeExternalClient();
    // ioredis قد يعيد عناصر جدول Lua نصوصًا — Number() يجب أن يحتملها
    client.eval.mockResolvedValue(['7', '13', '1', '25']);
    const storage = new RedisThrottlerStorage(client as unknown as Redis);

    const record = await storage.increment(
      'key-1',
      60_000,
      5,
      30_000,
      'default',
    );

    expect(record).toEqual({
      totalHits: 7,
      timeToExpire: 13,
      isBlocked: true,
      timeToBlockExpire: 25,
    });
  });

  it('فشل Redis → احتياط الذاكرة يعمل (عداد + حجب) مع تحذير واحد', async () => {
    const client = makeExternalClient();
    client.eval.mockRejectedValue(new Error('connection refused'));
    const storage = new RedisThrottlerStorage(client as unknown as Redis);

    // ثلاث ضربات بلا Redis — الاحتياط يعدّ داخليًا
    const r1 = await storage.increment('k', 60_000, 2, 30_000, 'default');
    const r2 = await storage.increment('k', 60_000, 2, 30_000, 'default');
    expect(r1.totalHits).toBe(1);
    expect(r2.totalHits).toBe(2);

    // الضربة الثالثة تتجاوز الحد → حجب
    const r3 = await storage.increment('k', 60_000, 2, 30_000, 'default');
    expect(r3.isBlocked).toBe(true);
    expect(r3.timeToBlockExpire).toBeGreaterThan(0);
    expect(r3.timeToBlockExpire).toBeLessThanOrEqual(30);

    // قاطع الدائرة: فشل واحد فقط يصل Redis فعليًا (البقية احتياط مباشر)
    expect(client.eval).toHaveBeenCalledTimes(1);
  });

  it('قاطع الدائرة: خلال نافذة 5s بعد الفشل لا نضرب Redis إطلاقًا ثم نستعيد', async () => {
    const client = makeExternalClient();
    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');
    client.eval.mockRejectedValueOnce(new Error('timeout'));
    const storage = new RedisThrottlerStorage(client as unknown as Redis);

    nowSpy.mockReturnValue(realNow);
    await storage.increment('k', 60_000, 100, 60_000, 'default');
    expect(client.eval).toHaveBeenCalledTimes(1);

    // بعد الفشل مباشرة — قاطع الدائرة مفتوح: لا محاولة
    nowSpy.mockReturnValue(realNow + 1_000);
    client.eval.mockResolvedValue([5, 30, 0, 0]);
    await storage.increment('k', 60_000, 100, 60_000, 'default');
    expect(client.eval).toHaveBeenCalledTimes(1); // لم يُستدعَ

    // بعد انقضاء نافذة القاطع — Redis يعمل ويعاد الضبط
    nowSpy.mockReturnValue(realNow + 5_100);
    const record = await storage.increment('k', 60_000, 100, 60_000, 'default');
    expect(client.eval).toHaveBeenCalledTimes(2);
    expect(record.totalHits).toBe(5);
  });

  it('احتياط الذاكرة: انتهاء النافذة يعيد العد من 1، وانتهاء الحجب يعيد العد نظيفًا', async () => {
    const client = makeExternalClient();
    client.eval.mockRejectedValue(new Error('down'));
    const storage = new RedisThrottlerStorage(client as unknown as Redis);
    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow);

    // نافذة أولى: 3 ضربات (الحد 2 → محجوب من الضربة الثالثة)
    await storage.increment('k', 60_000, 2, 30_000, 'default');
    await storage.increment('k', 60_000, 2, 30_000, 'default');
    const blocked = await storage.increment('k', 60_000, 2, 30_000, 'default');
    expect(blocked.isBlocked).toBe(true);

    // الحجب انتهى (30s مضت) — إعادة عد نظيفة
    nowSpy.mockReturnValue(realNow + 31_000);
    const fresh = await storage.increment('k', 60_000, 2, 30_000, 'default');
    expect(fresh.isBlocked).toBe(false);
    expect(fresh.totalHits).toBe(1);
  });

  it('onApplicationShutdown يغلق العميل فقط عندما نملكه (أنشأناه من URL)', async () => {
    // إنشاء عبر URL — ioredis مُحاكى فيُنشئ عميل mock داخلي
    const storage = new RedisThrottlerStorage('redis://localhost:6379');
    const ctor = Redis as unknown as jest.Mock;
    expect(ctor).toHaveBeenCalledWith('redis://localhost:6379', {
      maxRetriesPerRequest: 1,
    });
    const ownedClient = ctor.mock.results[0]?.value as ReturnType<
      typeof makeExternalClient
    >;

    // مستمع error مُلحق — يمنع انفجار أحداث الخطأ بلا مستمع
    expect(ownedClient.on).toHaveBeenCalledWith('error', expect.any(Function));

    await storage.onApplicationShutdown();
    expect(ownedClient.quit).toHaveBeenCalledTimes(1);

    // عميل خارجي — لا نملكه فلا نغلقه
    const external = makeExternalClient();
    const storageExternal = new RedisThrottlerStorage(
      external as unknown as Redis,
    );
    await storageExternal.onApplicationShutdown();
    expect(external.quit).not.toHaveBeenCalled();
  });

  it('فشل quit أثناء الإيقاف يتراجع إلى disconnect (لا استثناء يمنع الإطفاء)', async () => {
    const storage = new RedisThrottlerStorage('redis://localhost:6379');
    const ctor = Redis as unknown as jest.Mock;
    const ownedClient = ctor.mock.results[0]?.value as ReturnType<
      typeof makeExternalClient
    >;
    ownedClient.quit.mockRejectedValue(new Error('already closed'));

    await expect(storage.onApplicationShutdown()).resolves.toBeUndefined();
    expect(ownedClient.disconnect).toHaveBeenCalledTimes(1);
  });
});
