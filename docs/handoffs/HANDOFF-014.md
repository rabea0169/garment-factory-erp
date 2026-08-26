# Handoff 014

## Status

- Branch: `phase4/gf0014-quality-waste-v2`
- Commit: `9e8ffcc` (merge commit for PR #25; implementation `2a56602`)
- Phase: 4 — Quality and Waste
- Task ID: `GF-0014`
- Date: 2026-08-26
- Base: `origin/main@90c37f6`; PR #25 merged into `main@9e8ffcc`.

## Completed

- استعادة schema GF-0014 بصورة additive دون إعادة تنسيق شامل للـschema.
- إضافة `QualityWasteReason` و`QualityCheckStatus` وحقول الهالك والتكلفة والحالة والفاعل وidempotency.
- ربط فحص الجودة بـ`ProductionStageRun` وفرض فحص نهائي واحد لكل `stageRunId` غير فارغ.
- فرض `checkedQty = passedQty + rejectedQty + wasteQty`، والكميات غير السالبة، وسبب الهالك/الرفض عند الحاجة.
- السماح بالفحص النهائي بعد `COMPLETED` فقط، ورفض `PENDING` و`IN_PROGRESS` و`CANCELLED`.
- حساب `wasteCost` من تكلفة الخادم، وتسجيل actor وActivityLog، ودعم replay عبر `Idempotency-Key`.
- إضافة `GET /quality/kpis` بتجميع PostgreSQL حقيقي، مرشحات stage/workOrder/date، وإرجاع totals وrates بلا mock fallback.
- إضافة migration وunit/controller/HTTP/PostgreSQL integration tests وتحديث API/DB/ADR.

## Files Changed

- `backend/prisma/schema.prisma` — نماذج GF-0014 والعلاقات والقيد الفريد.
- `backend/prisma/migrations/20260830000000_gf0014_quality_waste/migration.sql` — migration additive وCHECK/FK/indexes.
- `backend/src/modules/quality/quality.service.ts` — قواعد المجال والتكلفة وKPI وidempotency.
- `backend/src/modules/quality/quality.controller.ts` — POST الجودة وGET KPI المحميان بـJWT.
- `backend/src/modules/quality/dto/create-quality-check.dto.ts` — عقد الكتابة والتحقق.
- `backend/src/modules/quality/dto/quality-kpi-query.dto.ts` — عقد مرشحات KPI.
- اختبارات quality و`backend/test/quality.integration-spec.ts` و`backend/test/auth-guard.e2e-spec.ts` وmock Prisma.
- `backend/package.json` و`backend/package-lock.json` — تثبيت `dotenv` كاعتماد مباشر مطلوب لـ`prisma.config.ts`.
- `docs/API_CONTRACT.md` و`docs/DATA_AND_MIGRATIONS.md` و`docs/adr/ADR-0014-quality-and-waste-model.md`.

## Database/API Impact

Migration `20260830000000_gf0014_quality_waste` تضيف enums وحقولًا وعلاقات وفهارس وقيودًا دون حذف بيانات. الصفوف القديمة تحصل على defaults آمنة، وتبقى `stageRunId` وحقول التدقيق nullable للتوافق. قيود CHECK معلنة `NOT VALID` لتفادي كسر البيانات التاريخية، مع فرضها على الصفوف الجديدة. القيد الفريد على `stageRunId` يسمح بقيم NULL التاريخية ويمنع أكثر من فحص جديد لنفس تنفيذ المرحلة. لا تكتب GF-0014 إلى المخزون أو المحاسبة.

## Checks

| Check | Result | Notes |
|---|---|---|
| Prisma validate | PASS | schema valid بعد rebase |
| Prisma generate | PASS | Prisma Client 7.9.1 regenerated |
| Format check | PASS |  جميع ملفات TypeScript المطابقة |
| Typecheck | PASS | `tsc --noEmit` |
| Lint | PASS | ESLint بلا أخطاء |
| Build | PASS | `npm run build` |
| Backend unit tests | PASS | 27 suites / 144 tests |
| Backend E2E tests | PASS | 3 suites / 46 tests، وتشمل 401 لمسار KPI |
| PostgreSQL integration | PASS IN CI | 2 suites / 14 tests passed in Run `32926745698` on PostgreSQL 16; local run skipped بسبب غياب Docker و`GF_INTEGRATION_DATABASE_URL` |
| Migration deploy | PASS IN CI | `prisma migrate deploy` passed on disposable PostgreSQL 16 in Run `32926745698` |
| Flutter analyze/test | PASS IN CI | Flutter job passed in Run `32926745698`; not run locally |
| Security scan | PASS | نفس patterns الخاصة بـCI، بلا match |
| `git diff --check` | PASS | بلا whitespace errors |

## Known Issues

- PR #25 مدمج في `main@9e8ffcc`، وCI Run `32926745698` أخضر؛ لا توجد بوابة GF-0014 تقنية متبقية.
- `origin/main` يتضمن بالفعل جزءًا من GF-0015 (`PR #24` attendance). لا يجوز بدء تنفيذ HR/Payroll إضافي قبل مراجعة هذا الدمج ومقارنته بـMASTER_BACKLOG بعد إغلاق GF-0014.
- لا يوجد adjustment/reversal endpoint لفحص مكتمل؛ التصحيح خارج نطاق GF-0014 ويتطلب ADR ومهمة مستقلة.
- اختبارات E2E الحالية mock-backed، بينما إثبات PostgreSQL مطلوب من CI integration suite.

## Not Done

- لا توجد أعمال كود أو بوابات GF-0014 متبقية ضمن هذا التسليم.
- متطلبات التشغيل المؤسسي العامة، وadjustment/reversal، ما زالت خارج نطاق المرحلة.
- يجب مراجعة جزء GF-0015 attendance الموجود في PR #24 قبل تنفيذ HR/Payroll المتبقي.

## Next Exact Task

```text
TASK_ID: GF-0015-RECONCILE
TITLE: Reconcile the already-merged GF-0015 attendance endpoint with the master backlog
OBJECTIVE: فحص PR #24 وملفات HR الحالية مقابل MASTER_BACKLOG، وتحديد أصغر نطاق متبقٍ لـGF-0015 دون تكرار attendance أو خلط payroll قبل إنشاء فرع تنفيذ مستقل.
ALLOWED FILES: قراءة فقط في مرحلة المراجعة؛ عند اعتماد النطاق تُذكر الملفات في بطاقة جديدة قبل تعديلها.
ACCEPTANCE CRITERIA:
1. تقرير يحدد ما أضافه PR #24 وما لم يغطه من attendance/worker production/payroll.
2. لا يوجد تكرار أو تضارب مع endpoint attendance المدمج.
3. تُحدد schema/API/migration المطلوبة فقط، مع سياسة payroll والاعتماد والتسوية.
4. تُكتب مهمة تنفيذ GF-0015 مستقلة بفرع وPR وCI منفصلين، ولا يبدأ الكود قبل اعتماد نطاقها.
```

## Rollback

قبل التطبيق على بيئة مشتركة، خذ backup. للتراجع البرمجي استخدم `git revert` للـmerge commit بعد الدمج. لا تحذف سجلات الجودة أو migration يدويًا؛ أي rollback لقاعدة البيانات يمر عبر backup/restore أو migration عكسية معتمدة، وتبقى السجلات التشغيلية محفوظة.
