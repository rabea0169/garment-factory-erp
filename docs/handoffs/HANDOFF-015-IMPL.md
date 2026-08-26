# Handoff 015 — Payroll Implementation

## Status

- Branch: `phase5/gf0015-payroll`
- Base: `main@eae3f7e` (يتضمن GF-0014، توثيق backlog، وGF-0016 الجزئي المدمج عبر PR #27)
- Phase: GF-0015 HR and Payroll
- Task: `GF-0015-IMPL`
- Status: تنفيذ محلي مكتمل، ينتظر commit وPR وCI PostgreSQL
- Date: 2026-08-26

## Completed

أضيفت دورة payroll MVP دون إعادة تنفيذ attendance الموجود في PR #24. يستقبل endpoint العامل والفترة والملاحظات فقط، ويحسِب gross من `DailyProduction.totalAmount`، ويحسب خصم السلف داخل الفترة مع cap عند gross، ويترك absence deduction بصفر وفق ADR-0015 لعدم وجود سياسة راتب ثابت معتمدة. صارت الحالة `DRAFT` ثم `APPROVED`، ولا يسمح المسار بالدفع أو الترحيل المالي.

أضيف actor من JWT، وتسجيل ActivityLog، وIdempotency-Key للإنشاء والاعتماد، وقيد فريد للعامل والفترة، ومعالجة التعارض المتزامن كـ409. تستخدم الفترة حد نهاية حصريًا داخليًا لضمان احتساب كل وقت في اليوم الأخير. لا تقبل الخدمة gross/net أو أي خصم محسوب من العميل.

## Files Changed

| File | Purpose |
|---|---|
| `backend/prisma/schema.prisma` | `PayrollStatus`، علاقات actor/idempotency، حقول approval، worker-period uniqueness، indexes |
| `backend/prisma/migrations/20260830010000_gf0015_payroll_controls/migration.sql` | migration additive مع FKs وCHECK constraints وindexes |
| `backend/src/modules/hr/dto/create-payroll.dto.ts` | DTO typed للفترة والعامل والملاحظات |
| `backend/src/modules/hr/hr.service.ts` | server-side calculation، cap، draft/approval، actor، idempotency، concurrency guard |
| `backend/src/modules/hr/hr.controller.ts` | `POST /hr/payrolls` و`POST /hr/payrolls/:id/approve` والصلاحيات |
| `backend/src/modules/hr/payroll.service.spec.ts` | اختبارات الحساب، cap، الفترة، التكرار، replay، approval immutability |
| `backend/src/modules/hr/hr.controller.spec.ts` | اختبارات تفويض وتمرير actor/key |
| `backend/test/payroll.integration-spec.ts` | PostgreSQL tests للحساب، cap، replay، approval، concurrent uniqueness |
| `backend/test/auth-guard.e2e-spec.ts` | 401/403/400 لمسارات payroll |
| `backend/test/helpers/prisma-mock.ts` | Prisma methods اللازمة لاختبارات payroll |
| `docs/API_CONTRACT.md` | عقد endpoints وقواعد الحساب والصلاحيات |
| `docs/DATA_AND_MIGRATIONS.md` | أثر migration وpreflight وrollback |
| `docs/adr/ADR-0015-hr-payroll-scope-and-calculation.md` | القرار الحاكم للحساب والاعتماد والدفع |
| `docs/handoffs/HANDOFF-015-IMPL.md` | هذه البطاقة |

## Database/API Impact

Migration `20260830010000_gf0015_payroll_controls` تضيف enum وحقولًا nullable أو ذات default، ولا تحذف سجلات. تضيف worker-period uniqueness؛ يجب فحص التكرارات القديمة قبل تطبيقها على أي بيئة مشتركة. تضيف القيود المالية وapproval بصيغة `NOT VALID` للتوافق مع legacy rows. لا تكتب GF-0015 مخزونًا ولا journal ولا payment.

## Checks

| Check | Result | Notes |
|---|---|---|
| Prisma validate | PASS | schema valid |
| Prisma generate | PASS | Prisma Client 7.9.1 |
| Format check | PASS | all matched files |
| Typecheck | PASS | `tsc --noEmit` |
| Lint | PASS | ESLint بلا أخطاء |
| Build | PASS | `nest build` |
| Backend unit tests | PASS | 28 suites / 157 tests |
| Backend E2E tests | PASS | 3 suites / 50 tests، تتضمن payroll 401/403/400 |
| PostgreSQL integration | NOT RUN LOCALLY | 3 suites / 18 tests skipped لغياب Docker و`GF_INTEGRATION_DATABASE_URL` |
| Flutter analyze/test | NOT RUN LOCALLY | لا تغييرات Flutter؛ مطلوب CI |
| Secret scan | PENDING PR CI | لا أسرار مضافة؛ يجب تشغيل الفحص في CI |
| `git diff --check` | PENDING COMMIT | يجب تشغيله قبل push |

## Known Issues and boundaries

التكامل الحقيقي وmigration deploy لم يُشغلا محليًا، ولا يجوز إعلان نجاحهما إلا من CI. لا توجد سياسة خصم غياب مالي في النموذج؛ `absenceDeduct = 0` قرار MVP موثق وليس حسابًا ضمنيًا. دفع الراتب والقيد المحاسبي مؤجلان إلى GF-0018. آلية reversal/recalculation بعد approval غير موجودة وتحتاج مهمة مستقلة.

الفرع الأساسي يحتوي GF-0016 جزئيًا من PR #27؛ لا يُعاد تنفيذ ملفات الاستلام، لكن يجب تدقيقه وإكماله ضمن مهمة GF-0016 مستقلة بعد إغلاق GF-0015.

## Next Exact Task

رفع فرع `phase5/gf0015-payroll` وفتح PR مستقل فوق `main@eae3f7e`، ثم انتظار Backend migration/integration وFlutter وSecret Scan CI. بعد نجاحه يدمج المستخدم PR GF-0015، ويُتحقق من main CI وmerge SHA، ثم تُفتح بطاقة GF-0016 لتدقيق واستكمال PR #27 الجزئي.

## Rollback

للكود استخدم `git revert` للـPR بعد الدمج. لا تسقط أعمدة أو تحذف payrolls يدويًا؛ في بيئة مشتركة يلزم backup/restore أو migration عكسية معتمدة بعد إيقاف endpoints الجديدة. قبل migration يجب تنفيذ preflight لتكرارات العامل والفترة.
