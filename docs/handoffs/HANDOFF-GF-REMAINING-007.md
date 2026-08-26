# Handoff — GF-REMAINING-007: Repeatable performance benchmark

## 1. Scope and verdict

- **Task ID:** GF-REMAINING-007
- **Base:** `origin/main@0b34949` after merge of GF-REMAINING-006.
- **Branch:** `phase2/gf-remaining-007-performance`
- **Scope:** قياس الأداء على خادم backend فعلي متصل بـPostgreSQL 16، مع حمل ثابت موثق على health/readiness/dashboard، وإنتاج artifact JSON يحوي p95 وthroughput وpool saturation.
- **Status:** complete on PR #62; the initial CI defects were corrected without disabling security, and the final PostgreSQL-backed benchmark passed on CI run `32954663324`. The PR is ready for merge authorization.

## 2. Changes

أضيف `backend/test/performance/dashboard-load.mjs` باستخدام Node.js built-in fetch و`pg`. يسجل latency (min/p50/p95/p99/max)، throughput، error rate، status counts، وقياس الاتصالات النشطة من `pg_stat_activity` مقابل `DB_POOL_MAX`.

يختبر benchmark ثلاثة مسارات: `GET /health` كخط أساس للعملية، `GET /health/ready` كمسار قاعدة البيانات، و`GET /dashboard/stats` كمسار تقارير ERP محمي بالمصادقة. يسجل الدخول بحساب seed الإداري ولا يستخدم token أو بيانات ثابتة خارج بيئة الاختبار.

أضيف `npm run test:performance`، وjob مستقل في CI ينشئ PostgreSQL 16، يطبق migrations، يشغل seed، يبني الخادم ويشغله، ينتظر readiness، ثم ينفذ benchmark ويرفع JSON كـartifact. كما صُحح `start:prod` من `dist/main` إلى مسار Nest build الفعلي `dist/src/main.js` بعد أن كشف أول تشغيل CI أن المسار القديم يفشل بـ`MODULE_NOT_FOUND`.

كشف أول benchmark صالح أن 120 طلباً لكل مسار كانت تتجاوز rate limiter العام وتنتج 429، وهو رفض أمني صحيح لا فشل أداء. كما كشف التشغيل الثاني أن named throttler باسم `auth` كان يُطبَّق عالمياً، فكانت كل المسارات تتوقف تقريباً بعد 10 طلبات. صُحح ذلك بجعل limiter واحد باسم `default` وتضييقه على login فقط عبر `@Throttle({ default: ... })`. خُفّض الحمل الموثق إلى 30 طلباً لكل مسار و10 متزامنة وبدون warm-up، أي 90 طلباً إجمالاً، حتى يقيس الأداء الفعلي دون تعطيل الحماية أو إدخال استثناء خاص بالاختبار.

لا تُفرض thresholds تخمينية. يمكن لمالك البيئة ضبط `PERF_MAX_P95_MS` أو `PERF_MIN_THROUGHPUT_RPS` أو `PERF_MAX_ERROR_RATE` صراحة؛ بدونها تكون المرحلة قياساً baseline لا قرار SLA.

## 3. Verified local gates

| Gate | Result | Evidence |
|---|---|---|
| Production entrypoint | PASS locally | `npm run build` produces `dist/src/main.js`; `start:prod` now points to it |
| Node syntax check | PASS | `node --check test/performance/dashboard-load.mjs` |
| Backend format check | PASS | `npm run format:check` |
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Build | PASS | `npm run build` |
| Unit tests | PASS | 32 suites / 197 tests |
| E2E tests | PASS | 3 suites / 64 tests |
| Throttler regression tests | PASS | 7 targeted tests: login override and health/readiness skip metadata |
| Runtime benchmark | PASS | CI run `32954663324`; PostgreSQL 16 + seed + live backend; artifact `dashboard-load.json` uploaded |

## 4. Final CI benchmark evidence

| Endpoint | Requests | Concurrency | Error rate | p95 latency | Throughput |
|---|---:|---:|---:|---:|---:|
| `/health` | 30 | 10 | 0% | 25.00 ms | 645.92 req/s |
| `/health/ready` | 30 | 10 | 0% | 37.75 ms | 557.21 req/s |
| `/dashboard/stats` | 30 | 10 | 0% | 103.76 ms | 194.50 req/s |

Pool saturation sampling observed 5 samples, with `maxActiveConnections=0` and `configuredPoolMax=20` (`ratio=0`). هذا القياس لا يثبت أن pool لم يُستخدم؛ بل يعني أن عينات `pg_stat_activity` لم تلتقط اتصالاً نشطاً لحظة الاستعلام، ولذلك يجب عدم تفسير ratio=0 كإثبات سعة غير محدودة. رابط التشغيل: [CI run 32954663324](https://github.com/rabea0169/garment-factory-erp/actions/runs/32954663324). artifact المرفوع هو المصدر الخام للنتائج.

## 5. CI acceptance criteria

يجب أن ينجح job الأداء من قاعدة PostgreSQL جديدة مع `prisma migrate deploy` وseed وتشغيل الخادم، وأن ينتج artifact JSON صالحاً. يجب أن تكون مسارات القياس الثلاثة بلا أخطاء HTTP، وأن يحتوي الملف على latency وthroughput وpool saturation، مع عرض `sampleCount` و`maxActiveConnections` و`configuredPoolMax`. وقد تحقق ذلك في CI run `32954663324`. لا توجد عتبات SLA مفروضة؛ اعتمادها يحتاج قرار مالك المنتج.

نتيجة benchmark لا تعني اعتماد الإنتاج تلقائياً. اعتماد thresholds يحتاج مقارنة ببيئة تشغيل مماثلة وقرار UAT/Go-No-Go يشمل حجم البيانات وعدد نسخ الخدمة وحدود pool ومواصفات البنية.

## 6. Known limitations

القياس الحالي baseline single-instance على runner واحد، ولا يقيس توزيع الحمل بين عدة replicas أو cache hit ratio أو network latency الخارجي. لا توجد thresholds في CI حتى لا يتم تحويل قياس runner إلى SLA غير معتمد.

## 7. Next exact task

راجع artifact مع مالك المنتج وحدد baseline/thresholds، ثم ادمج PR #62 بتفويض صريح. بعد الدمج تُستكمل Backup/Restore Drill وUAT وGo/No-Go؛ Production يبقى No-Go حتى إغلاق Prisma Compute/npm audit وrelease gates.
