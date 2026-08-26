# Handoff 018 — Fiscal Periods and Journal Entries

## Status

- Branch: `phase9/gf0018-accounting`
- Base: `main@17f765b` بعد CI أخضر لـGF-0017
- Phase: GF-0018 Accounting
- Status: تنفيذ محلي؛ ينتظر commit/PR/CI

## Completed

أضيف نموذج `FiscalPeriod` بحالتي OPEN/CLOSED وقيد تاريخي وفهارس، وربط اختياري بـ`JournalEntry` للحفاظ على القيود القديمة. أضيفت endpoints لإنشاء الفترة وإغلاقها وإنشاء قيد متعدد البنود. يمنع محرك FinancialPostingService الترحيل في فترة مغلقة أو بتاريخ خارجها، ويتحقق من الحسابات النشطة وتوازن البنود، بينما يمر إغلاق الفترة داخل transaction ويسجل actor في ActivityLog.

أضيفت integration suite لـPostgreSQL لقيد فترة مفتوحة ومنع القيد بعد الإغلاق، واختبارات unit/controller. لا يضيف هذا slice دفعًا أو VAT أو ترحيلًا آليًا للرواتب والمشتريات، ولا يعيد تصميم JournalLine الحالي؛ ذلك قرار لاحق.

## Files Changed

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260830040000_gf0018_fiscal_periods/migration.sql`
- `backend/src/core/financial/financial-posting.service.ts`
- `backend/src/modules/accounting/accounting.service.ts`
- `backend/src/modules/accounting/accounting.controller.ts`
- `backend/src/modules/accounting/dto/create-fiscal-period.dto.ts`
- `backend/src/modules/accounting/dto/create-journal-entry.dto.ts`
- `backend/src/modules/accounting/accounting.service.spec.ts`
- `backend/src/modules/accounting/accounting.controller.spec.ts`
- `backend/test/helpers/prisma-mock.ts`
- `backend/test/accounting.integration-spec.ts`
- `docs/adr/ADR-0018-fiscal-periods-and-journal-entries.md`
- `docs/API_CONTRACT.md`
- `docs/DATA_AND_MIGRATIONS.md`
- `docs/handoffs/HANDOFF-018.md`

## Checks

| Check | Result | Notes |
|---|---|---|
| Prisma validate/generate | PASS | schema valid; Client generated |
| Format/typecheck/lint | PASS | local |
| Accounting unit/controller | PASS | 2 suites / 17 tests |
| Build/full unit/E2E | PENDING | بعد التوثيق النهائي |
| PostgreSQL integration | NOT RUN LOCALLY | 6 suites / 24 tests skipped لغياب Docker وGF_INTEGRATION_DATABASE_URL |
| Flutter | NOT RUN LOCALLY | لا تغييرات Flutter؛ مطلوب CI |
| Secret scan | PENDING PR CI | لا secrets جديدة |

## Not Done / Boundaries

الترحيل التلقائي من purchase/payroll/sales، VAT split، payment settlement، وتقارير reconciliation ليست ضمن هذا PR. لا تُستخدم `db push` ولا تُحذف قيود أو أرصدة قديمة.

## Next Exact Task

تشغيل البوابات الكاملة، مراجعة migration/diff والأسرار، commit/push وفتح PR GF-0018، ثم انتظار PostgreSQL migration/integration وFlutter وSecret Scan في CI. بعد الدمج يُحدّث PROJECT_STATE post-merge وتُكتب خلاصة المراحل.

## Rollback

استخدم `git revert` للشفرة وbackup/restore أو migration عكسية معتمدة للقاعدة. لا تحذف JournalEntry أو Account.balance يدويًا.
