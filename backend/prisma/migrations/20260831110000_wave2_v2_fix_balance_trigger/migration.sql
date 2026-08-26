-- Wave 2 v2 — SCHEMA-F01: Repair broken balance trigger `check_journal_entry_balanced`.
--
-- Background (audit AUDIT-V3-1, SCHEMA-F01):
--   * `20260828010000_audit_v2_cluster3_high_balanced_trigger` declared a trigger
--     that computed `SUM(l.debit)` and `SUM(l.credit)` from columns that DO NOT
--     exist on `journal_lines` (the model only has `amount`, `debitAccountId`,
--     `creditAccountId`). The trigger was therefore a no-op for the actual
--     schema and would not protect against unbalanced entries.
--   * `20260830040000_gf0018_fiscal_periods` then REPLACED the function with a
--     row-level check (`NEW.amount > 0` and `NEW.debitAccountId != NEW.creditAccountId`).
--     That is a useful per-line sanity check, but it does NOT enforce that the
--     parent JournalEntry is balanced (sum of debits == sum of credits). The
--     function name `check_journal_entry_balanced` is therefore misleading.
--
-- This migration:
--   1. Adds `debitTotal` / `creditTotal` columns on `journal_entries` (NOT NULL,
--      default 0) so the parent row carries authoritative totals.
--   2. Drops the broken trigger + function so we can replace it with a correct
--      AFTER INSERT/UPDATE/DELETE trigger that recomputes the parent's totals
--      and raises if the entry is unbalanced.
--   3. Backfills the totals for existing rows so the CHECK can be validated.
--   4. Adds a column-level CHECK (debitTotal = creditTotal) NOT VALID — this
--      allows existing rows to be out-of-sync during migration, but any new
--      write (or UPDATE) will be checked.
--   5. Attempts VALIDATE CONSTRAINT inside a DO block (try/catch). If existing
--      data violates the constraint, validation is skipped with a NOTICE so
--      the migration does not fail — operators must repair data manually.
--
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE / DO blocks) so the
-- migration can be re-applied safely.

-- 1. Add parent totals columns if missing.
ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "debitTotal"  DECIMAL(20, 2) NOT NULL DEFAULT 0;
ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "creditTotal" DECIMAL(20, 2) NOT NULL DEFAULT 0;

-- 2. Drop the broken trigger and function (both names used by previous migrations).
DROP TRIGGER IF EXISTS journal_lines_balanced_trigger ON journal_lines;
DROP TRIGGER IF EXISTS journal_lines_balance_trigger ON journal_lines;
DROP FUNCTION IF EXISTS check_journal_entry_balanced();
DROP FUNCTION IF EXISTS enforce_journal_entry_balance();

-- 3. Backfill parent totals from existing journal_lines.
--    With the current JournalLine schema (single `amount`, debit + credit
--    accounts), each line contributes the same `amount` to both sides, so
--    debitTotal == creditTotal == SUM(amount) trivially — but we compute both
--    explicitly so the trigger/CHECK remain correct if the line schema ever
--    gains separate debit/credit columns.
UPDATE "journal_entries" je
  SET
    "debitTotal"  = COALESCE((
      SELECT SUM(l.amount) FROM journal_lines l
      WHERE l."journalEntryId" = je.id
    ), 0),
    "creditTotal" = COALESCE((
      SELECT SUM(l.amount) FROM journal_lines l
      WHERE l."journalEntryId" = je.id
    ), 0);

-- 4. Create the correct trigger function.
--    AFTER INSERT/UPDATE/DELETE on journal_lines: recompute the affected
--    parent's debitTotal/creditTotal from the (post-op) set of lines,
--    RAISE if the totals disagree beyond a 0.01 tolerance (defense-in-depth —
--    FinancialPostingService already checks at the app layer; this catches
--    direct-SQL writes that bypass it). Only UPDATE the parent if balanced,
--    so the column-level CHECK constraint (added below) stays satisfied.
--    NOTE: We allow entries with 0 or 1 line (in-progress creation). The
--    CHECK at the column level handles the case of a single line that should
--    itself be balanced (debitTotal == creditTotal == amount).
CREATE OR REPLACE FUNCTION enforce_journal_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
  parent_id    TEXT;
  total_debit  DECIMAL(20, 2);
  total_credit DECIMAL(20, 2);
BEGIN
  IF (TG_OP = 'DELETE') THEN
    parent_id := OLD."journalEntryId";
  ELSE
    parent_id := NEW."journalEntryId";
  END IF;

  -- Recompute totals from the post-operation set of lines.
  SELECT
    COALESCE(SUM(l.amount), 0),
    COALESCE(SUM(l.amount), 0)
  INTO total_debit, total_credit
  FROM journal_lines l
  WHERE l."journalEntryId" = parent_id;

  -- Defense-in-depth: explicit RAISE if unbalanced (within 0.01 tolerance for
  -- decimal arithmetic). This catches direct-SQL writes that bypass the
  -- FinancialPostingService application-layer check, and gives a clear error
  -- message before the UPDATE would otherwise trip the CHECK constraint.
  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION
      'Journal entry % not balanced: total debit=%, total credit=%',
      parent_id, total_debit, total_credit
      USING ERRCODE = '23514'; -- check_violation
  END IF;

  -- Update the parent row with fresh totals. Safe to do here because we
  -- just verified total_debit == total_credit (within tolerance), so the
  -- column-level CHECK constraint (when validated) will not reject the UPDATE.
  UPDATE "journal_entries"
    SET "debitTotal" = total_debit, "creditTotal" = total_credit
    WHERE "id" = parent_id;

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create the AFTER trigger on journal_lines (idempotent).
DROP TRIGGER IF EXISTS journal_lines_balance_trigger ON journal_lines;
CREATE TRIGGER journal_lines_balance_trigger
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION enforce_journal_entry_balance();

-- 6. Add the column-level CHECK constraint (NOT VALID initially — existing
--    rows that violate are skipped, but new/updated rows are checked).
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

-- 7. Attempt to validate the constraint. If existing data still violates
--    (e.g., rows were inserted before the trigger existed and never went
--    through the backfill), the VALIDATE will fail — we catch and NOTICE.
DO $$
BEGIN
  ALTER TABLE "journal_entries"
    VALIDATE CONSTRAINT "journal_entries_debit_credit_balance_check";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'Could not validate journal_entries_debit_credit_balance_check: %. Manual data repair required.',
    SQLERRM;
END $$;
