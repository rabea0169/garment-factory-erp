# Handoff 002

## Status
- Branch: `stabilization/baseline-and-security`
- Commit: 84a46e7
- Phase: 1 — Security & Stabilization
- Task ID: GF-0002
- Date: 2026-08-25

## Completed
- `JwtAuthGuard` عالمي عبر `APP_GUARD` — كل مسار يتطلب JWT إلا `@Public()`.
- `@Public()` فقط على `POST /auth/login` و `GET /`.
- `RolesGuard` مفعّل عالميًا + `@Roles()` على كل مسار كتابة حساس وفق المصفوفة الموثقة في `API_CONTRACT.md` (SUPER_ADMIN يتجاوز).
- إزالة fallback سر `'secret'` من `jwt.strategy.ts` — رمي خطأ واضح عند غياب `JWT_SECRET`.
- `assertRequiredEnv()` في `main.ts` — فشل إقلاع exit 1 عند: غياب `JWT_SECRET`/`DATABASE_URL` (أي بيئة)، سر <32 حرفًا أو CORS `*`/مفقود (production فقط).
- CORS من `CORS_ORIGINS` في البيئة.
- `prisma.service.ts` + `prisma/seed.ts`: `DATABASE_URL` من البيئة فقط — لا connection strings في الكود.
- `@CurrentUser('id')` decorator — الهوية من الجلسة في sales/accounting/production (تجاهل قيم body).
- إصلاح خلل قديم: تسجيل `AppController`/`AppService` في `AppModule` (كان `GET /` يرجع 404).
- 31 اختبارًا جديدًا: 15 unit (guards + env validation) + 16 e2e (supertest مع PrismaService mocked).
- `backend/.env` محلي (غير منشور، gitignored) بسر JWT عشوائي 48+ حرفًا.
- تحديث: `API_CONTRACT.md` (مصفوفة الأدوار مفعّلة)، `SECURITY_BASELINE.md` (إغلاق P0-01/02/04 + جزئي 03 + P1-01)، `PROJECT_STATE.md`.

## Files Changed
**جديدة (7):** `jwt-auth.guard.ts`، `public.decorator.ts`، `current-user.decorator.ts`، `jwt-auth.guard.spec.ts`، `roles.guard.spec.ts`، `src/main.spec.ts`، `test/auth-guard.e2e-spec.ts`
**معدّلة (22):** `app.module.ts`، `main.ts`، `app.controller.ts`، `prisma.service.ts`، `prisma/seed.ts`، `jwt.strategy.ts`، `roles.guard.ts`، `auth.controller.ts` + 9 controllers أخرى (decorators فقط) + sales/accounting/production services (توقيع الهوية)
**خارج Allowed Files الأصلية — مبرر سلفًا:** الـ controllers والـ services الثلاثة كانت ضرورة لمعايير القبول 1 و2 و5 (لا يمكن حماية المسارات أو استخراج الهوية دون تعديلها). التعديلات decorators وتوقيعات فقط — لا منطق أعمال جديد.
**docs:** `API_CONTRACT.md`، `SECURITY_BASELINE.md`، `PROJECT_STATE.md`، هذا الملف.

## Database/API Impact
- **Database:** لا تغيير schema ولا migration. تغيير تشغيلي واحد: الاتصال الآن من `DATABASE_URL` فقط.
- **API:** نفس العقد الناجح (2xx)؛ إضافة 401 (بلا/توكن فاسد) و403 (دور خاطئ) على المسارات المحمية. `GET /` أصبح يرجع 200 (كان 404 — إصلاح خلل). أي عميل بلا Bearer token سيُرفض الآن — **Flutter غير جاهز بعد (GF-0010)**.

## Checks
| Check | Result | Notes |
|---|---|---|
| Build (`npm run build`) | ✅ PASS | |
| Prisma validate | ✅ PASS | |
| اختبارات جديدة unit | ✅ 15/15 | 3 suites جديدة |
| اختبارات جديدة e2e | ✅ 16/16 | `auth-guard.e2e-spec.ts` — 401×7، 403×3، هوية-من-الجلسة، عام×2 |
| Fail-closed boot | ✅ مثبت سلوكيًا | production بلا env → exit 1؛ سر قصير → رفض |
| ESLint على الملفات الجديدة | ✅ صفر أخطاء | |
| Backend tests كاملة | ❌ 18 فاشلة قديمة (كما هي) | نطاق GF-0003 — لم تتأثر بتغييراتي |
| Lint كامل | ❌ 16 خطأ قديمة | نطاق GF-0003 |
| Flutter analyze/test | ⚠️ غير مشغّلة | لا SDK — كما هو موثق في CI |
| git diff review | ✅ | 19 معدّل + 7 جديدة، لا أسرار جديدة، .env غير متتبع |

## Known Issues
- **Flutter سيرفضه الخادم الآن** على كل المسارات المحمية (لا auth interceptor بعد) — أولوية GF-0010 العاجلة.
- CI secret-scan يبقى أحمر على `docker-compose.yml`/`README.md`/`seed.ts` (كلمات مرور قديمة منشورة) — عن قصد حتى GF-0006.
- `app.e2e-spec.ts` القديم يفشل بلا DB (كان كذلك قبل GF-0002) — يُعالج في GF-0003 مع بقية القوالب.
- تغيير fileMode البيئي (100644→100755) ظهر على كل الملفات في بيئة العمل — عولج بـ `git config core.fileMode false` محليًا (لا يُدفع إلى Git).
- **الدفع إلى GitHub لم يتم**: بيئة العمل بلا صلاحيات دفع — نفّذ يدويًا: `git push -u origin stabilization/baseline-and-security`.

## Not Done
- P0-05 (DTOs لكل مسارات الكتابة) — GF-0004.
- rate limiting على login (P2-08) — GF-0021.
- توثيق Swagger للأدوار الجديدة (ApiOperation للأدوار) — تحسين لاحق.

## Next Exact Task
```text
TASK_ID: GF-0003
TITLE: إصلاح الاختبارات الـ 18 الفاشلة وأخطاء lint القديمة
PHASE: 1
OBJECTIVE: حزمة اختبارات خضراء بالكامل تثبت قواعد الأعمال الحالية،
          وCI يخضرّ في فحوصات lint/test (يبقى secret-scan أحمر حتى GF-0006).

ALLOWED FILES:
- backend/src/modules/**/*.spec.ts (الـ 18 القوالب)
- backend/test/app.e2e-spec.ts (استبدال القالب باختبار يعمل بلا DB عبر overrideProvider)
- backend/test/helpers/ (جديد: mocks مشتركة لـ PrismaService)
- backend/package.json (فصل lint عن lint:fix فقط — بلا إضافة dependencies)
- docs/TESTING_STRATEGY.md، docs/PROJECT_STATE.md، docs/handoffs/HANDOFF-003.md

ACCEPTANCE CRITERIA:
1. npm test -- --runInBand: صفر فشل (قوالب القديمة إما specs سلوكية فعلية بـ PrismaService mocked أو حُذفت بوثائق سبب — لا حذف صامت).
2. npm run lint: صفر errors (تحذيرات موثقة في TESTING_STRATEGY مسموحة مؤقتًا).
3. كل spec جديد يختبر سلوكًا حقيقيًا (401/403/حساب/حالة) لا "toBeDefined" الشكلي.
4. npm run test:e2e يعمل بدون قاعدة بيانات (PrismaService overridden) وapp.e2e-spec ينجح.
5. لا إخفاء فشل: ممنوع || true أو skip جماعي.
6. تحديث TESTING_STRATEGY.md وPROJECT_STATE.md وHANDOFF-003.
```

## Rollback
- `git revert 84a46e7` — يعيد الحالة إلى ما بعد GF-0001 (docs فقط). التغييرات سلوكية لكن معزولة: guards + decorators + توقيعات، بلا schema ولا migrations.
- إن ظهر كسر في Flutter جراء الحماية (متوقع حتى GF-0010): يمكن تعطيل مؤقت `APP_GUARD` في `app.module.ts` كسر فوري موثق — **لا تفعل** في الإنتاج؛ أصلح الـ interceptor بدل ذلك.
