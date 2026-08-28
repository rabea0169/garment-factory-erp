-- Wave 6 — COMM-F07 (HIGH): Customer credit limit + SCHEMA-F01 follow-up.
--
-- Background:
--   * Audit v3 finding COMM-F07 (HIGH, NEW): Customer model had no creditLimit
--     field. confirmOrder in SalesService did not check the customer's open AR
--     balance + new order total against any ceiling. A customer with EGP 100,000
--     of unpaid AR could be issued a EGP 1,000,000 credit order with no system
--     guard. This migration adds the column + the related credit terms field,
--     and SalesService.confirmOrder gets a credit ceiling check.
--   * Audit v3 finding SCHEMA-F01 (CRITICAL, marked STILL-OPEN — actually
--     already fixed by migration 20260831110000_wave2_v2_fix_balance_trigger
--     but the columns debitTotal/creditTotal were never exposed in
--     schema.prisma, so prisma generate would not surface them and app code
--     could not verify the trigger did its job). This migration is a no-op at
--     the DB layer for those columns (they already exist) — its purpose is to
--     document that schema.prisma now matches the live DB and to re-assert
--     idempotency of the original trigger migration so a fresh apply still
--     succeeds. We deliberately DO NOT touch the existing trigger or CHECK
--     constraint here; they are correct.
--
-- All statements are idempotent (IF NOT EXISTS / DO blocks) so the migration
-- can be re-applied safely.

-- ============================================================================
-- 1. COMM-F07 — Customer credit limit + credit terms days.
-- ============================================================================
-- creditLimit is NULLABLE on purpose: NULL means "no limit" (preserves the
-- historical behavior for existing customers). A non-NULL value caps the
-- total of (outstanding AR balance + new credit order total) at confirm time.
-- creditTermsDays defaults to 0 (= immediate payment). It is informational
-- today and will be used in a future wave to compute due dates automatically.

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "creditLimit" DECIMAL(12, 2);

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "creditTermsDays" INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing rows get NULL creditLimit (= unlimited) which is the
-- safe historical default. The ALTER above already leaves NULLs untouched
-- for existing rows; no UPDATE is needed.

-- ============================================================================
-- 2. SCHEMA-F01 follow-up — verify journal_entries.debitTotal / creditTotal
--    are present (added by the 20260831110000 migration; this is a defensive
--    re-assert in case the migration was skipped in a partial restore).
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'debitTotal'
  ) THEN
    ALTER TABLE "journal_entries"
      ADD COLUMN "debitTotal" DECIMAL(20, 2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'creditTotal'
  ) THEN
    ALTER TABLE "journal_entries"
      ADD COLUMN "creditTotal" DECIMAL(20, 2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Backfill totals for any journal_entries row whose totals are still 0 but
-- which does have lines (in case the trigger was added after rows were
-- written via raw SQL). This mirrors the same backfill in the original
-- migration and is safe to re-run.
UPDATE "journal_entries" je
  SET
    "debitTotal"  = COALESCE((
      SELECT SUM(l.amount) FROM journal_lines l
      WHERE l."journalEntryId" = je.id
    ), 0),
    "creditTotal" = COALESCE((
      SELECT SUM(l.amount) FROM journal_lines l
      WHERE l."journalEntryId" = je.id
    ), 0)
  WHERE je."debitTotal" = 0 AND je."creditTotal" = 0
    AND EXISTS (
      SELECT 1 FROM journal_lines l WHERE l."journalEntryId" = je.id
    );

-- ============================================================================
-- 3. Verification helper (defensive only — adds the CHECK constraint if it
--    somehow is missing). The 20260831110000 migration already creates it as
--    NOT VALID then VALIDATEs in a try/catch; we re-assert it here.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'journal_entries_debit_credit_balance_check'
      AND conrelid = '"journal_entries"'::regclass
  ) THEN
    ALTER TABLE "journal_entries"
      ADD CONSTRAINT "journal_entries_debit_credit_balance_check"
      CHECK ("debitTotal" = "creditTotal") NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE "journal_entries"
    VALIDATE CONSTRAINT "journal_entries_debit_credit_balance_check";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'Could not validate journal_entries_debit_credit_balance_check: %. Manual data repair required.',
    SQLERRM;
END $$;
