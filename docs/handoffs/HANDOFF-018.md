# Handoff 018 — Fiscal Periods and Journal Entries

## Status

- Branch: `docs/post-gf0018-state`
- Base: `main@5dfa0fe` بعد دمج PR #36
- Phase: GF-0018 Accounting
- Status: مكتملة ومُدمجة؛ main CI أخضر

## Completed

أضيف نموذج `FiscalPeriod` بحالتي OPEN/CLOSED وقيد تاريخي وفهارس، وربط اختياري بـ`JournalEntry` للحفاظ على القيود القديمة. أضيفت endpoints لإنشاء الفترة وإغلاقها وإنشاء قيد متعدد البنود. يمنع محرك FinancialPostingService الترحيل في فترة مغلقة أو بتاريخ خارجها، ويتحقق من الحسابات النشطة وتوازن البنود، بينما يمر إغلاق الفترة داخل transaction ويسجل actor في ActivityLog.

أضيفت integration suite لـPostgreSQL لقيد فترة مفتوحة ومنع القيد بعد الإغلاق، واختبارات unit/controller. فشل CI الأول بسبب trigger قديم يشير إلى أعمدة `debit` و`credit` غير الموجودة؛ أصلحت migration GF-0018 trigger ليطابق `debitAccountId` و`creditAccountId` و`amount`. نجح CI بعد الإصلاح، ثم دُمج PR #36 وأثبت Run `32933591101` migration deploy وPostgreSQL integration. لا يضيف هذا slice دفعًا أو VAT أو ترحيلًا آليًا للرواتب والمشتريات، ولا يعيد تصميم JournalLine الحالي؛ ذلك قرار لاحق.

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
| Build/full unit/E2E | PASS | Run PR #36 وmain Run `32933591101` |
| PostgreSQL integration | PASS | migration deploy و6 suites / 24 tests على PostgreSQL في CI |
| Flutter | PASS | Run PR #36 وmain Run `32933591101` |
| Secret scan | PASS | Run PR #36 وmain Run `32933591101` |

## Not Done / Boundaries

الترحيل التلقائي من purchase/payroll/sales، VAT split، payment settlement، وتقارير reconciliation ليست ضمن هذا PR. لا تُستخدم `db push` ولا تُحذف قيود أو أرصدة قديمة.

## Next Exact Task

تم تشغيل البوابات الكاملة محليًا، ثم فتح PR #36 ونجح CI بعد إصلاح trigger القديم، ودُمج PR #36 إلى `main@5dfa0fe`. Run `32933591101` على main أخضر بكل البوابات. الخطوة التالية هي مراجعة أي نطاق GF-0019 ظاهر في فرع مستقل؛ لا يبدأ تنفيذ جديد تلقائيًا.

## Rollback

استخدم `git revert` للشفرة وbackup/restore أو migration عكسية معتمدة للقاعدة. لا تحذف JournalEntry أو Account.balance يدويًا.
