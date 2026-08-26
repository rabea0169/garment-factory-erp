# Handoff 014

## Status

- Branch: `phase4/gf0014-quality-waste-v2`
- Commit: `2a56602`
- Phase: 4 — Quality and Waste
- Task ID: `GF-0014`
- Date: 2026-08-26
- Base: `origin/main@90c37f6`; تمت إعادة تأسيس الفرع فوق main الأحدث الذي يتضمن PR #23 وPR #24.

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
| PostgreSQL integration | NOT RUN LOCALLY | 2 suites / 14 tests skipped لغياب `GF_INTEGRATION_DATABASE_URL` وDocker غير متاح؛ يجب إثباتها في CI |
| Migration deploy | PENDING CI | لم تُطبق على قاعدة فعلية محلية |
| Flutter analyze/test | NOT RUN LOCALLY | التغيير Backend-only؛ يجب أن يمر job Flutter في CI |
| Security scan | PASS | نفس patterns الخاصة بـCI، بلا match |
| `git diff --check` | PASS | بلا whitespace errors |

## Known Issues

- لم يُفتح PR GF-0014 بعد، ولم يُرفع commit `2a56602`، وCI PostgreSQL هو بوابة الإغلاق المتبقية.
- `origin/main` يتضمن بالفعل جزءًا من GF-0015 (`PR #24` attendance). لا يجوز بدء تنفيذ HR/Payroll إضافي قبل مراجعة هذا الدمج ومقارنته بـMASTER_BACKLOG بعد إغلاق GF-0014.
- لا يوجد adjustment/reversal endpoint لفحص مكتمل؛ التصحيح خارج نطاق GF-0014 ويتطلب ADR ومهمة مستقلة.
- اختبارات E2E الحالية mock-backed، بينما إثبات PostgreSQL مطلوب من CI integration suite.

## Not Done

- رفع الفرع وفتح PR مستقل بعنوان GF-0014.
- انتظار نجاح CI الكامل: `npm ci`، migrate deploy على PostgreSQL، integration، Flutter، وSecret Scan.
- دمج PR والتحقق من merge commit وCI على main.
- تحديث `PROJECT_STATE.md` بعد رقم PR وSHA النهائيين.

## Next Exact Task

```text
TASK_ID: GF-0014-CLOSE
TITLE: Push and merge the isolated GF-0014 quality/waste PR
OBJECTIVE: رفع phase4/gf0014-quality-waste-v2، فتح PR مستقل فوق main@90c37f6، وإغلاقه فقط بعد CI أخضر يتضمن migrate deploy وPostgreSQL integration، ثم التحقق من main.
ALLOWED FILES: لا تغييرات كود جديدة؛ عند الحاجة فقط docs/PROJECT_STATE.md وdocs/handoffs/HANDOFF-014.md لتسجيل PR ونتيجته.
ACCEPTANCE CRITERIA:
1. PR مستقل يحتوي commit GF-0014 دون تعديلات main مباشرة.
2. CI ينجح في Prisma validate/generate، build، unit، E2E، migrate deploy، integration PostgreSQL، Flutter، وSecret Scan.
3. migration تُطبق على قاعدة CI نظيفة وتنجح اختبارات one-check-per-stageRun وKPI وCHECK constraints.
4. بعد الدمج يُتحقق من merge SHA وCI على main وتُحدّث PROJECT_STATE.
5. لا يبدأ GF-0015 الجديد إلا بعد مراجعة ما هو موجود في PR #24 وتحديد الفجوة المتبقية رسميًا.
```

## Rollback

قبل التطبيق على بيئة مشتركة، خذ backup. للتراجع البرمجي استخدم `git revert` للـmerge commit بعد الدمج. لا تحذف سجلات الجودة أو migration يدويًا؛ أي rollback لقاعدة البيانات يمر عبر backup/restore أو migration عكسية معتمدة، وتبقى السجلات التشغيلية محفوظة.
