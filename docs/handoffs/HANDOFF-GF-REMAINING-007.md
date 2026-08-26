# Handoff — GF-REMAINING-007: Repeatable performance benchmark

## 1. Scope and verdict

- **Task ID:** GF-REMAINING-007
- **Base:** `origin/main@0b34949` after merge of GF-REMAINING-006.
- **Branch:** `phase2/gf-remaining-007-performance`
- **Scope:** قياس الأداء على خادم backend فعلي متصل بـPostgreSQL 16، مع حمل ثابت موثق على health/readiness/dashboard، وإنتاج artifact JSON يحوي p95 وthroughput وpool saturation.
- **Status:** implementation complete locally; benchmark runtime and PostgreSQL-backed artifact are pending CI.

## 2. Changes

أضيف `backend/test/performance/dashboard-load.mjs` باستخدام Node.js built-in fetch و`pg`. يسجل latency (min/p50/p95/p99/max)، throughput، error rate، status counts، وقياس الاتصالات النشطة من `pg_stat_activity` مقابل `DB_POOL_MAX`.

يختبر benchmark ثلاثة مسارات: `GET /health` كخط أساس للعملية، `GET /health/ready` كمسار قاعدة البيانات، و`GET /dashboard/stats` كمسار تقارير ERP محمي بالمصادقة. يسجل الدخول بحساب seed الإداري ولا يستخدم token أو بيانات ثابتة خارج بيئة الاختبار.

أضيف `npm run test:performance`، وjob مستقل في CI ينشئ PostgreSQL 16، يطبق migrations، يشغل seed، يبني الخادم ويشغله، ينتظر readiness، ثم ينفذ benchmark ويرفع JSON كـartifact.

لا تُفرض thresholds تخمينية. يمكن لمالك البيئة ضبط `PERF_MAX_P95_MS` أو `PERF_MIN_THROUGHPUT_RPS` أو `PERF_MAX_ERROR_RATE` صراحة؛ بدونها تكون المرحلة قياساً baseline لا قرار SLA.

## 3. Verified local gates

| Gate | Result | Evidence |
|---|---|---|
| Node syntax check | PASS | `node --check test/performance/dashboard-load.mjs` |
| Backend format check | PASS | `npm run format:check` |
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Build | PASS | `npm run build` |
| Unit tests | PASS | 32 suites / 197 tests |
| E2E tests | PASS | 3 suites / 64 tests |
| Runtime benchmark | PENDING CI | local sandbox has no PostgreSQL/backend runtime environment |

## 4. CI acceptance criteria

يجب أن ينجح job الأداء من قاعدة PostgreSQL جديدة مع `prisma migrate deploy` وseed وتشغيل الخادم، وأن ينتج artifact JSON صالحاً. يجب أن تكون مسارات القياس الثلاثة بلا أخطاء HTTP، وأن يحتوي الملف على latency وthroughput وpool saturation، مع عرض `sampleCount` و`maxActiveConnections` و`configuredPoolMax`.

نتيجة benchmark لا تعني اعتماد الإنتاج تلقائياً. اعتماد thresholds يحتاج مقارنة ببيئة تشغيل مماثلة وقرار UAT/Go-No-Go يشمل حجم البيانات وعدد نسخ الخدمة وحدود pool ومواصفات البنية.

## 5. Known limitations

القياس الحالي baseline single-instance على runner واحد، ولا يقيس توزيع الحمل بين عدة replicas أو cache hit ratio أو network latency الخارجي. لا توجد thresholds في CI حتى لا يتم تحويل قياس runner إلى SLA غير معتمد.

## 6. Next exact task

بعد نجاح CI، راجع artifact وحدد baseline مع مالك المنتج، ثم افتح PR للدمج. بعد الدمج تُستكمل Backup/Restore Drill وUAT وGo/No-Go؛ Production يبقى No-Go حتى إغلاق Prisma Compute/npm audit وrelease gates.
