#!/usr/bin/env node
/**
 * GF-OPS-MONITOR — فحص صحة الإنتاج من خارج الخادم.
 *
 * الغرض: سكربت بلا اعتماديات (Node 20+ fetch) يعمل من أي آلة أو cron،
 * يتحقق من أربع طبقات متدرجة:
 *   1) GET /health        — العملية حية وتستجيب
 *   2) GET /health/ready  — الاعتماديات الأساسية متصلة (قاعدة البيانات)
 *   3) POST /auth/login   — المسار الحرج الكامل يعمل (توكن صالح)
 *   4) GET /system/backup/summary — الاستعلام الفعلي على قاعدة البيانات
 *
 * الاستخدام:
 *   MONITOR_BASE_URL=https://... MONITOR_EMAIL=... MONITOR_PASSWORD=... \
 *     node scripts/monitor-health.mjs
 *
 * متغيرات البيئة:
 *   MONITOR_BASE_URL  (اختياري) — افتراضيًا رابط Railway للإنتاج
 *   MONITOR_EMAIL     (اختياري) — بريد SUPER_ADMIN لفحص تسجيل الدخول العميق.
 *                                 عند غيابه تُفحص الطبقتان 1-2 فقط.
 *   MONITOR_PASSWORD  (اختياري) — كلمة المرور المقابلة
 *   MONITOR_WEBHOOK   (اختياري) — عند الفشل يُرسل POST JSON إلى هذا الرابط
 *                                 (يعمل مع Slack/Discord/أي endpoint عام)
 *   MONITOR_TIMEOUT_MS (اختياري) — مهلة كل طلب، افتراضي 15000
 *
 * رموز الخروج: 0 = صحة كاملة، 1 = فشل واحد على الأقل (مناسب لـ cron/alerting).
 * ملاحظة أمان: لا يطبع السكربت كلمة المرور أو التوكن أبدًا — فقط أرقام
 * الحالة وأعداد الصفوف.
 */

const BASE_URL = (
  process.env.MONITOR_BASE_URL ??
  'https://garment-factory-erp-production.up.railway.app'
).replace(/\/+$/, '');
const EMAIL = process.env.MONITOR_EMAIL;
const PASSWORD = process.env.MONITOR_PASSWORD;
const WEBHOOK = process.env.MONITOR_WEBHOOK;
const TIMEOUT_MS = Number(process.env.MONITOR_TIMEOUT_MS ?? 15000);

/** نتيجة فحص واحد موحّدة. */
function check(name) {
  return { name, ok: false, status: null, detail: '', ms: 0 };
}

async function timedFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { res, ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const results = [];
  let accessToken = null;

  // 1) health — العملية حية
  const health = check('GET /health');
  try {
    const { res, ms } = await timedFetch(`${BASE_URL}/health`);
    health.status = res.status;
    health.ms = ms;
    const body = await res.json().catch(() => ({}));
    health.ok = res.status === 200 && body.status === 'ok';
    health.detail = health.ok
      ? `uptime=${Math.round(body.uptime ?? 0)}s`
      : `status=${res.status} body=${JSON.stringify(body).slice(0, 120)}`;
  } catch (err) {
    health.detail = err.name === 'AbortError' ? 'مهلة' : err.message;
  }
  results.push(health);

  // 2) ready — الاعتماديات (قاعدة البيانات)
  const ready = check('GET /health/ready');
  try {
    const { res, ms } = await timedFetch(`${BASE_URL}/health/ready`);
    ready.status = res.status;
    ready.ms = ms;
    ready.ok = res.status === 200;
    if (!ready.ok) ready.detail = `status=${res.status}`;
    else ready.detail = 'جاهز';
  } catch (err) {
    ready.detail = err.name === 'AbortError' ? 'مهلة' : err.message;
  }
  results.push(ready);

  // 3) login — المسار الحرج (إن وُفرت بيانات الاعتماد)
  if (EMAIL && PASSWORD) {
    const login = check('POST /auth/login');
    try {
      const { res, ms } = await timedFetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // العميل غير المتصفّحي لا يرسل Origin — مسموح بالتصميم (SEC-F07)
          'x-client-type': 'monitor-script',
        },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      login.status = res.status;
      login.ms = ms;
      const body = await res.json().catch(() => ({}));
      login.ok = res.status === 200 && Boolean(body.access_token);
      if (login.ok) {
        accessToken = body.access_token;
        login.detail = 'توكن صادر';
      } else {
        login.detail = `status=${res.status} message=${String(body.message ?? '').slice(0, 120)}`;
      }
    } catch (err) {
      login.detail = err.name === 'AbortError' ? 'مهلة' : err.message;
    }
    results.push(login);

    // 4) استعلام فعلي على قاعدة البيانات — أعمق طبقة قابلة للفحص من الخارج
    if (accessToken) {
      const db = check('GET /system/backup/summary');
      try {
        const { res, ms } = await timedFetch(
          `${BASE_URL}/system/backup/summary`,
          { headers: { authorization: `Bearer ${accessToken}` } },
        );
        db.status = res.status;
        db.ms = ms;
        const body = await res.json().catch(() => ({}));
        db.ok = res.status === 200 && Number(body.totalRows ?? 0) >= 0;
        db.detail = db.ok
          ? `tables=${body.tables} totalRows=${body.totalRows}`
          : `status=${res.status}`;
      } catch (err) {
        db.detail = err.name === 'AbortError' ? 'مهلة' : err.message;
      }
      results.push(db);
    }
  } else {
    results.push({
      ...check('POST /auth/login'),
      ok: true,
      detail: 'تخطي (لم تُضبط MONITOR_EMAIL/MONITOR_PASSWORD)',
    });
  }

  // التقرير
  const failed = results.filter((r) => !r.ok);
  const allOk = failed.length === 0;
  for (const r of results) {
    const icon = r.ok ? 'PASS' : 'FAIL';
    // eslint-disable-next-line no-console
    console.log(`[${icon}] ${r.name} — ${r.detail}${r.ms ? ` (${r.ms}ms)` : ''}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    allOk
      ? `النتيجة: سليم ${results.length}/${results.length}`
      : `النتيجة: فشل ${failed.length}/${results.length} — ${failed.map((f) => f.name).join(', ')}`,
  );

  // تنبيه webhook عند الفشل (best-effort — فشل التنبيه لا يغيّر رمز الخروج)
  if (!allOk && WEBHOOK) {
    try {
      await fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: `🔴 تنبيه Garment ERP: فشل فحص الصحة — ${failed
            .map((f) => `${f.name}: ${f.detail}`)
            .join(' | ')} — ${new Date().toISOString()}`,
          severity: 'critical',
          source: 'monitor-health.mjs',
          baseUrl: BASE_URL,
          checkedAt: new Date().toISOString(),
          failures: failed.map((f) => ({ check: f.name, detail: f.detail })),
        }),
      });
    } catch {
      // تجاهل مقصود — التنبيه طبقة تحسين لا شرط صحة
    }
  }

  process.exit(allOk ? 0 : 1);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('خطأ غير متوقع في فحص الصحة:', err.message);
  process.exit(1);
});
