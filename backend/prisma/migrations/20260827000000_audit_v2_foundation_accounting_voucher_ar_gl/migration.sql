-- Audit v2 Foundation (A1+A2+A3 + E1) — double-entry accounting core.
--
-- هذا الـ migration يُضيف:
-- 1. JournalEntry.createdById (E1 — audit trail: من أنشأ القيد).
-- 2. Voucher.journalEntryId/treasuryId/counterpartyType/counterpartyId
--    (A3 — ربط السند بقيد مالي حقيقي + خزينة + طرف مقابل).
--
-- الأثر على البيانات القائمة: كلها أعمدة اختيارية (NULL) — لا تكسر الـ seed.
-- لا enum جديد (SalesOrderStatus موجود بالفعل من GF-0011).
--
-- Rollback: ALTER TABLE ... DROP COLUMN لكل ما أُضيف + DROP INDEX + DROP CONSTRAINT.

-- E1: audit trail على JournalEntry.
ALTER TABLE "journal_entries" ADD COLUMN "createdById" TEXT;

-- AddForeignKey: journal_entries.createdById -> users.id (ON DELETE SET NULL — لا تُحذف القيود عند حذف المستخدم).
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index لتسريع البحث عن قيود مستخدم معيّن (audit history).
CREATE INDEX IF NOT EXISTS "journal_entries_createdById_idx" ON "journal_entries"("createdById");

-- A3: أعمدة السند الجديدة.
ALTER TABLE "vouchers" ADD COLUMN "journalEntryId"   TEXT;
ALTER TABLE "vouchers" ADD COLUMN "treasuryId"       TEXT;
ALTER TABLE "vouchers" ADD COLUMN "counterpartyType" TEXT;
ALTER TABLE "vouchers" ADD COLUMN "counterpartyId"   TEXT;

-- AddForeignKey: vouchers.journalEntryId -> journal_entries.id
-- (ON DELETE SET NULL — السند يبقى موجودًا لكنه يُفقد الرابط إذا حُذف القيد؛
--  القيود لا تُحذف عاديًا في النظام لكن يُسمح بالصيانة اليدوية).
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: vouchers.treasuryId -> treasuries.id
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_treasuryId_fkey"
  FOREIGN KEY ("treasuryId") REFERENCES "treasuries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes لتسريع البحث عن سندات مرتبطة بخزينة/قيد معيّن.
CREATE INDEX IF NOT EXISTS "vouchers_journalEntryId_idx" ON "vouchers"("journalEntryId");
CREATE INDEX IF NOT EXISTS "vouchers_treasuryId_idx"     ON "vouchers"("treasuryId");
CREATE INDEX IF NOT EXISTS "vouchers_counterparty_idx"  ON "vouchers"("counterpartyType", "counterpartyId");

-- A1: Chart of Accounts seed — يُضاف في seed.ts (لا هنا) لأنه بيانات مرجعية لا schema.
