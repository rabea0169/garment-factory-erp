# Handoff — GF-REMAINING-006: PostgreSQL and RBAC quality gates

## 1. Scope and verdict

- **Task ID:** GF-REMAINING-006
- **Base:** `origin/main@1bc1fc4` after merge of PR #55.
- **Scope:** منع تجاوز integration tests بصمت، وإضافة تغطية RBAC للمسارات الجديدة في Dashboard واستلام المشتريات.
- **Status:** production stage-output concurrency regression fixed locally; full local gates pass; PostgreSQL CI rerun required before merge.

## 2. Changes

أضيفت `backend/test/integration-gate.ts` كـ`setupFiles` مركزي لـJest integration. عندما يكون `GF_REQUIRE_INTEGRATION=1` ولا يوجد `GF_INTEGRATION_DATABASE_URL` تفشل suite برسالة صريحة بدلاً من اعتبار كل الاختبارات skipped نجاحاً.

أضيف الأمر `npm run test:integration:required`، وتم تحويل workflow إلى استخدامه بعد تشغيل PostgreSQL 16 و`prisma migrate deploy`. بقي الأمر `npm run test:integration` اختيارياً للتطوير المحلي الآمن عندما لا تتوفر قاعدة بيانات.

أضيفت حالات E2E لمسار `GET /dashboard/stats` ومسار إنشاء receipt للمشتريات: بلا توكن تعاد 401، وVIEWER ممنوع من إنشاء receipt وتعاد 403.

أثناء أول CI للمرحلة، كشف الاختبار الحقيقي على PostgreSQL أن طلبين متزامنين متطابقين لـ`recordStageOutput` قد يقرأان المرحلة كـ`IN_PROGRESS` ثم يفشل أحدهما بدلاً من replay. أضيف قفل صف `ProductionStageRun` وإعادة فحص مفتاح idempotency بعد القفل، مع حفظ `response` داخل نفس transaction؛ بذلك ينتظر الطلب الخاسر ثم يعيد النتيجة المخزنة بلا إكمال أو ActivityLog إضافي. أظهر التشغيل الثاني أن القفل وحده كان يرى مفتاحاً بلا response، وتم إغلاق هذه الفجوة في التصحيح النهائي.

## 3. Verification

| Gate | Result | Evidence |
|---|---|---|
| Prettier format check | PASS | all tracked TS files formatted |
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Build | PASS | `npm run build` |
| E2E | PASS | 3 suites / 63 tests |
| Production unit tests after concurrency fix | PASS | 3 suites / 18 tests | `recordStageOutput` behavior remains type-safe |
| Full unit tests after concurrency fix | PASS | 32 suites / 192 tests | no regression in backend unit suite |
| Required integration without DB | EXPECTED FAIL | explicit `GF_REQUIRE_INTEGRATION` guard message; proves no silent skip |
| PostgreSQL integration | FAILED then fixed locally | CI run `32950566598` exposed stage-output race; row-lock fix added; rerun required |
| Secret scan | PASS | CI run `32950566598`; no hardcoded secret detected |

## 4. Acceptance criteria

يجب أن يمر CI على PostgreSQL 16 من الصفر، بما في ذلك `prisma migrate deploy` و`npm run test:integration:required`، وأن تنجح كل اختبارات RBAC الجديدة واختبار الطلبين المتزامنين لـ`recordStageOutput`. يجب ألا يعتمد نجاح workflow على suite متجاوزة بسبب غياب URL.

## 5. Known limitations

اختبارات التطوير المحلية الاختيارية ما زالت تسمح بـskip متعمد عندما لا توجد قاعدة بيانات؛ هذا سلوك مقصود لتجنب الاتصال بقاعدة غير معروفة، بينما CI والأمر required fail-closed. لا تشمل هذه المهمة اختبارات ضغط أو قياسات p95؛ المهمة التالية GF-REMAINING-007.

## 6. Next exact task

بعد الدمج، نفذ GF-REMAINING-007: اختبار أداء قابل للتكرار على حمل موثق، مع قياس p95 وthroughput وpool saturation، ثم أضف حدود قبول تعتمد قراراً موثقاً لا رقماً تخمينياً.
