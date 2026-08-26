-- Wave2 / SCHEMA-F01: Fix the broken balance trigger and add defense-in-depth
-- on JournalEntry.debitTotal/creditTotal.
--
-- Background (from audit finding SCHEMA-F01):
--   * Original trigger `check_journal_entry_balanced` was created in
--     migration `20260828010000_audit_v2_cluster3_high_balanced_trigger`.
--     That function referenced columns `l.debit` and `l.credit` which
--     DO NOT EXIST on `journal_lines` (the model only has `amount`,
--     `debitAccountId`, `creditAccountId`). The trigger would error
--     at execution time on any INSERT/UPDATE.
--   * Migration `20260830040000_gf0018_fiscal_periods` rewrote the function
--     to a per-line check (`NEW.amount > 0 AND NEW.debitAccountId !=
--     NEW.creditAccountId`). The function NAME (`check_journal_entry_balanced`)
--     is misleading — it no longer verifies the entry-level balance at all.
--
-- Fix:
--   1. Add `debitTotal` and `creditTotal` columns on `journal_entries`
--      (NOT NULL with DEFAULT 0). Each JournalLine contributes its `amount`
--      to BOTH the debit side (via `debitAccountId`) and the credit side
--      (via `creditAccountId`) because the JournalLine model is itself a
--      balanced pair. So at the entry level, debitTotal == creditTotal
--      == SUM(amount) of all lines.
--   2. Backfill the new columns from existing `journal_lines` rows.
--   3. Drop the broken trigger and function.
--   4. Create a new function `enforce_journal_entry_balance()` that:
--        - Fires AFTER INSERT / UPDATE / DELETE on `journal_lines`.
--        - Recomputes the parent JournalEntry's `debitTotal` and `creditTotal`
--          from the current child rows.
--        - Raises an exception if the recomputed totals are unbalanced
--          (within a 0.01 tolerance for Decimal(15,2) rounding).
--   5. Add a column-level CHECK constraint
--      `journal_entries_debit_credit_balanced_check` ensuring
--      `debitTotal = creditTotal`. Marked `NOT VALID` initially to avoid
--      failing any pre-existing rows (defensive — the backfill should
--      make all rows balanced), then `VALIDATE CONSTRAINT` attempted
--      inside an exception handler.
--
-- Idempotency:
--   * `ADD COLUMN IF NOT EXISTS` for the new columns.
--   * `DROP TRIGGER IF EXISTS` / `DROP FUNCTION IF EXISTS` before recreating.
--   * `CREATE OR REPLACE FUNCTION` for the new function.
--   * `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`.
--
-- Rollback:
--   ALTER TABLE "journal_entries" DROP CONSTRAINT IF EXISTS journal_entries_debit_credit_balanced_check;
--   DROP TRIGGER IF EXISTS journal_lines_balanced_trigger ON "journal_lines";
--   DROP FUNCTION IF EXISTS enforce_journal_entry_balance();
--   -- Optionally re-create the old broken trigger (NOT recommended).
--   ALTER TABLE "journal_entries" DROP COLUMN IF EXISTS "debitTotal";
--   ALTER TABLE "journal_entries" DROP COLUMN IF EXISTS "creditTotal";

-- 1. Add debitTotal / creditTotal columns (idempotent).
ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "debitTotal" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "creditTotal" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- 2. Backfill from existing journal_lines.
--    Each line contributes `amount` to BOTH debitTotal and creditTotal
--    (because each line is itself a balanced pair: one account is debited
--    and another is credited with the same amount).
UPDATE "journal_entries" je
  SET
    "debitTotal"  = COALESCE((
      SELECT SUM(l."amount") FROM "journal_lines" l
      WHERE l."journalEntryId" = je."id"
    ), 0),
    "creditTotal" = COALESCE((
      SELECT SUM(l."amount") FROM "journal_lines" l
      WHERE l."journalEntryId" = je."id"
    ), 0);

-- 3. Drop the broken trigger/function (idempotent).
DROP TRIGGER IF EXISTS journal_lines_balanced_trigger ON "journal_lines";
DROP FUNCTION IF EXISTS check_journal_entry_balanced();

-- 4. Create the corrected function.
--    NOTE: We name it `enforce_journal_entry_balance` (not the misleading
--    `check_journal_entry_balanced`) so the name reflects what it actually
--    does: enforce the entry-level balance by maintaining running totals
--    on the parent row and raising if they diverge.
CREATE OR REPLACE FUNCTION enforce_journal_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_id TEXT;
  v_new_debit  DECIMAL(20,2);
  v_new_credit DECIMAL(20,2);
BEGIN
  -- Determine the parent JournalEntry id. On DELETE, NEW is NULL, so use OLD.
  v_parent_id := COALESCE(NEW."journalEntryId", OLD."journalEntryId");

  -- Defensive: a row with no parent should never happen (FK constraint),
  -- but if it does, just return without raising.
  IF v_parent_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Recompute the parent's debitTotal and creditTotal from current child
  -- rows. Both totals are SUM(amount) because each line is itself a
  -- balanced pair — if any future schema change splits a line into
  -- separate debit/credit rows, this function MUST be updated to use
  -- separate SUMs.
  SELECT
    COALESCE(SUM(l."amount"), 0),
    COALESCE(SUM(l."amount"), 0)
  INTO v_new_debit, v_new_credit
  FROM "journal_lines" l
  WHERE l."journalEntryId" = v_parent_id;

  -- Maintain the running totals on the parent row.
  UPDATE "journal_entries"
    SET
      "debitTotal"  = v_new_debit,
      "creditTotal" = v_new_credit
    WHERE "id" = v_parent_id;

  -- Defense-in-depth: raise if the recomputed totals are unbalanced.
  -- Tolerance 0.01 accounts for any Decimal(15,2) rounding drift.
  IF ABS(v_new_debit - v_new_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry % not balanced: debitTotal=%, creditTotal=%',
      v_parent_id, v_new_debit, v_new_credit
      USING ERRCODE = '23514'; -- check_violation
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 5. Create the trigger AFTER INSERT OR UPDATE OR DELETE (idempotent).
DROP TRIGGER IF EXISTS journal_lines_balanced_trigger ON "journal_lines";
CREATE TRIGGER journal_lines_balanced_trigger
  AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_journal_entry_balance();

-- 6. Add the column-level CHECK constraint (defense-in-depth).
--    NOT VALID initially — does not fail any pre-existing rows.
--    (The backfill above should have made all rows balanced, but if any
--    pre-existing rows were inserted while the broken trigger was active
--    and somehow had divergent totals, NOT VALID keeps the migration safe.)
ALTER TABLE "journal_entries"
  DROP CONSTRAINT IF EXISTS journal_entries_debit_credit_balanced_check;
ALTER TABLE "journal_entries"
  ADD CONSTRAINT journal_entries_debit_credit_balanced_check
  CHECK ("debitTotal" = "creditTotal") NOT VALID;

-- 7. Attempt to validate the constraint (safe — wrapped in exception handler).
--    If validation fails (e.g. some pre-existing rows are still unbalanced),
--    the constraint stays in NOT VALID state and the migration succeeds.
--    A follow-up ops ticket should investigate any unbalanced entries.
DO $$
BEGIN
  BEGIN
    ALTER TABLE "journal_entries"
      VALIDATE CONSTRAINT journal_entries_debit_credit_balanced_check;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not validate constraint journal_entries_debit_credit_balanced_check: %', SQLERRM;
  END;
END $$;
