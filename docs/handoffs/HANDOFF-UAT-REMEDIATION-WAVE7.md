# Handoff — UAT Remediation Wave 7 (P0: schema drift + CI أحمر)

## Status

- Branch: `fix/uat-remediation-wave7-p0`
- Commit: قاعدة الفرع هي `e72ee94` (main — wave 6)؛ تعديلات الموجة 7 موجودة في working tree ولم تُنشأ كـ commit بعد عند إعداد البطاقة — الـ commit مسؤولية الوكيل الرئيسي وفق قيود التنسيق
- Phase: UAT Remediation — Wave 7 (P0)
- Task ID: 2-c (توثيق الموجة 7) ضمن مسار إصلاح P0
- Date: 2026-09-05

## Completed

**ما اكتُشف (بالأدلة):**

- CI على `main` أحمر: آخر 8 تشغيلات فاشلة منذ 2026-08-28، آخرها Run `33214907002` على `main@e72ee94` (تحقق مباشر عبر GitHub Actions API في 2026-09-05). الموجات 1-3 (PR #73) والموجة 4 (PR #74) والموجة 5 (PR #75) والموجة 6 (PR #76) دُمجت كلها بـ CI أحمر. وظيفتا الفشل: E2E tests وPerformance التي تتوقف عند خطوة Seed.
- السبب الجذري — انحراف schema في migration الموجة 4 `20260902000000_wave4_sec_f04_refresh_tokens`: أنشأ `users.jwt_version` وجدول `refresh_tokens` بأعمدة snake_case بينما `schema.prisma` صرّح بـ camelCase بلا `@map`. رسالة الفشل المسجلة عند `POST /auth/login`: `Invalid prisma.user.findUnique() invocation — The column users.jwtVersion does not exist in the current database` (خطأ P2022).
- الأثر المُعاد إنتاجه محليًا على قاعدة PostgreSQL 16 مبنية من migrations: login يرجع 500، seed يفشل، وكل استعلام يمس User/RefreshToken يفشل بـ P2022 — أي أن SEC-F04 (JWT refresh + revoke) معطل تشغيليًا على أي قاعدة حقيقية.
- اختبارا E2E الفاشلان (62/64): auth-guard عند تسجيل سلفة (mock بلا نموذج worker الذي أضافته الموجة 5)، وproduction-workflow عند وسيط idempotency الثالث في finalizeCost (assertion قديم من قبل RES-F02).

**ما أُصلح (منفذ على الفرع وينتظر التحقق عبر CI — ليس مدمجًا):**

- `backend/prisma/schema.prisma`: إضافة `@map("jwt_version")` لـ `User.jwtVersion` و`@map` لكل حقول `RefreshToken` (user_id/token_hash/expires_at/revoked_at/replaced_by_id/user_agent/ip_address/created_at) لتطابق بنية القاعدة القائمة. لا migration جديد: بنية القاعدة صحيحة أصلًا والخطأ كان في تصريحات النموذج فقط.
- إصلاح اختباري E2E: mock نموذج worker المفقود في auth-guard، وتحديث assertion وسيط idempotency في production-workflow وفق RES-F02.
- تحديث وثائق الحوكمة: `docs/PROJECT_STATE.md` (قسم «تحديث الموجة 7 — إصلاح P0» + جدول الحالة الحالية) و`docs/MASTER_BACKLOG.md` (بند GF-REMAINING-010 + تصويب ملاحظة GF-REMAINING-007).

**ما تحقق منه محليًا على الفرع (2026-09-05، قاعدة PostgreSQL 16 على 5433):**

- `prisma migrate deploy` على قاعدة نظيفة: نجح (36 migration حتى `20260903000000`).
- `npx prisma db seed` على القاعدة النظيفة (نفس خطوة Seed في CI): نجح بالكامل (users/products/BOM/work orders/workers/accounts/currencies).
- `POST /auth/login`: يرجع 200 مع `access_token` و`refresh_token` وإدراج سجل فعلي في `refresh_tokens` (قبل الإصلاح: 500/P2022 على نفس القاعدة).
- دورة SEC-F04 كاملة على قاعدة حقيقية: `POST /auth/refresh` (rotation) يرجع 200 بتوكنات جديدة؛ `POST /auth/logout` بالتوكن الحالي يرجع 200؛ إعادة استخدام refresh token الملغى يرجع 401؛ والـ access token القديم بعد logout يرجع 401 (إبطال jwtVersion يعمل). إعادة تسجيل الدخول بعدها ترجع 200.
- استعلاما `prisma.user.findMany` و`prisma.refreshToken.findMany` على قاعدة مبنية من migrations: يعملان (كانا يفشلان بـ P2022).

## Files Changed

- `backend/prisma/schema.prisma` — إضافة `@map` (تنفيذ وكيل الإصلاح، موثق هنا)
- `backend/test/auth-guard.e2e-spec.ts` — mock نموذج worker (تنفيذ وكيل إصلاح الاختبارات)
- `backend/test/production-workflow-api.e2e-spec.ts` — assertion وسيط idempotency (تنفيذ وكيل إصلاح الاختبارات)
- `docs/PROJECT_STATE.md` — قسم الموجة 7 + تحديث جدول الحالة الحالية
- `docs/MASTER_BACKLOG.md` — GF-REMAINING-010 + تصويب ملاحظة GF-REMAINING-007
- `docs/handoffs/HANDOFF-UAT-REMEDIATION-WAVE7.md` — هذه البطاقة
- `docs/runbooks/BACKUP_RESTORE.md` و`docs/UAT_SCENARIOS.md` — أُنجزا في هذه الموجة (تنفيذ وكيل التطوير)؛ أوامر الـ runbook جُرّبت فعليًا على PostgreSQL 16 محمول (dump/restore/checksum ناجحة)، وسيناريوهات UAT الـ 16 مبنية على API_CONTRACT الفعلي.
- `backend/package-lock.json` — `npm audit fix` غير الكاسر: qs 6.15.3→6.16.0 (إغلاق ثغرتي qs) + Prisma ضمن النطاق 7.9.1→7.10.0؛ package.json نفسه لم يتغير.

## Database/API Impact

- لا migration جديد ولا تغيير في بنية أي قاعدة: التصحيح في تصريحات النموذج فقط (مطابقة أسماء الأعمدة القائمة). أي قاعدة طُبقت عليها migrations تُصبح قابلة للاستعلام كما هي.
- لا تغيير في عقد API: لا endpoint أُضيف أو أُزيل أو تغيّرت استجابته؛ الأثر محصور في إعادة تشغيل login/refresh/logout وseed على قواعد حقيقية.
- قاعدة Railway الإنتاجية: قد تكون متأثرة بنفس الانحراف إذا طُبقت عليها migrations الموجة 4-6 — فحصها بعد الدمج إلزامي قبل أي استخدام (انظر Next Exact Task).

## Checks

| Check | Result | Notes |
|---|---|---|
| Build (npm run build) | PASS | nest build — exit 0 على working tree الفرع |
| Backend unit tests (npm test --runInBand) | PASS | 36 suites / 302 tests |
| Backend E2E (jest-e2e) | PASS | 3 suites / 64 tests بعد إصلاح الاختبارين |
| Lint (npm run lint) | PASS | لا أخطاء |
| Typecheck (tsc --noEmit) | PASS | — |
| Prisma validate | PASS | schema صالح بعد إضافة @map |
| Migrate deploy + seed على قاعدة نظيفة | PASS | PostgreSQL 16 — إعادة إنتاج خطوة Seed الفاشلة في CI |
| Login حقيقي على قاعدة migrations | PASS | 200 + إدراج refresh_tokens (كان 500/P2022) |
| Flutter analyze/test | NOT RUN | الموجة 7 لم تلمس `mobile_app/` — لا تغييرات Flutter في هذا الفرع؛ CI يشغّلها عند فتح PR |
| Security scan | PARTIAL | `npm audit` بعد `npm audit fix` (غير كاسر): أُغلقت ثغرتا qs — المتبقي ثغرتان من سلسلة mysql2 داخل Prisma (high + moderate) لا يُصلحهما إلا تخفيض Prisma إلى 6.x (تغيير كاسر يمنعه قرار MASTER_BACKLOG)؛ mysql2 تبعية Prisma الداخلية والمشروع يستخدم PostgreSQL حصريًا فالمسار غير قابل للاستغلال هنا؛ فحص الأسرار الاعتيادي مسؤولية CI |

## Known Issues

- CI على `main` أحمر منذ 2026-08-28 (آخر 8 تشغيلات) — يُتوقع أن يخضرّ بدمج هذا الفرع، لكن ذلك غير مثبت قبل تشغيل PR.
- `npm audit`: بعد `npm audit fix` غير الكاسر (qs 6.15.3→6.16.0 داخل lockfile، وPrisma ضمن النطاق 7.9.1→7.10.0 مع نجاح كل البوابات) تبقى ثغرتا سلسلة mysql2 داخل Prisma؛ الإصلاح الوحيد `npm audit fix --force` يثبّت Prisma 6.19.3 (تغيير كاسر) وهو مؤجل بقرار موثق في `MASTER_BACKLOG.md` (قرارات قبل المهام التابعة) لأن mysql2 غير مستخدمة في مسار PostgreSQL.
- قاعدة Railway الإنتاجية لم تُفحص من الانحراف بعد.
- GF-REMAINING-007 (الأداء): وظيفة Performance تسقط حاليًا عند Seed بسبب الانحراف نفسه؛ تعمل بعد إغلاق GF-REMAINING-010.

## Not Done

- مراجعة PR لفرع `fix/uat-remediation-wave7-p0` ورفعه وتشغيل CI على GitHub (التحقق المحلي أعلاه لا يعوّض CI).
- الدمج في main بموافقة المالك الصريحة، والتحقق من اخضرار CI على merge commit.
- فحص قاعدة بيانات Railway الإنتاجية (schema + login + refresh) لأنها قد تحمل الانحراف نفسه.
- UAT فعلي بتنفيذ سيناريوهات `docs/UAT_SCENARIOS.md` الـ 16 على جهاز Android فعلي.
- GF-REMAINING-008 (barcode/Flutter/offline) وrehearsal الفعلي لـ backup/restore وفق `docs/runbooks/BACKUP_RESTORE.md` (البروفة الموثقة لم تُنفذ بعد) وPilot وGo/No-Go.
- ثغرتا سلسلة mysql2 داخل Prisma المتبقيتان (تتطلبان قرار `npm audit fix --force` بتخفيض كاسر — مؤجلة بقرار موثق).

## Next Exact Task

```text
TASK_ID: GF-REMAINING-010-VERIFY
TITLE: مراجعة ورفع PR الموجة 7 وتشغيل CI ثم الدمج بموافقة المالك وفحص قاعدة Railway
OBJECTIVE: تحويل إصلاح P0 المنفذ على fix/uat-remediation-wave7-p0 إلى حالة مدمجة وCI أخضر على main،
           ثم التحقق من أن قاعدة Railway الإنتاجية لا تعاني انحراف schema نفسه.
ALLOWED FILES: لا تعديلات كودية جديدة (مهمة مراجعة وتشغيل)؛ يسمح فقط بتصحيحات موثقة السبب لو كشف CI
              خللًا في هذا الفرع، مع إعادة توثيق PROJECT_STATE/MASTER_BACKLOG عند أي تغيير.
ACCEPTANCE CRITERIA:
  1. PR مفتوح على fix/uat-remediation-wave7-p0 مراجَع (diff مفهوم: @map فقط + اختباران + docs).
  2. CI على PR أخضر: E2E 64/64 وخطوة Seed في Performance تنجح وintegration على PostgreSQL 16.
  3. دمج بموافقة المالك الصريحة ثم CI أخضر على merge commit في main.
  4. فحص قاعدة Railway: وجود الأعمدة snake_case ونجاح login — إن كانت متأثرة، فالإصلاح نفسه (prisma generate + deploy) كافٍ بلا migration، ويُوثَّق النتيج.
```

## Rollback

التراجع آمن بلا أي migration عكسي: التغيير في تصريحات النموذج فقط ولا يمس بيانات أي قاعدة. إذا فشل PR أو ظهر خلل بعد الدمج، يُرجع عبر `git revert` لـ merge commit (أو إسقاط الفرع قبل الدمج) ثم `npx prisma generate` لإعادة توليد العميل — لا حاجة لأي خطوة على قواعد البيانات نفسها، والقاعدة تظل صحيحة البنية.
