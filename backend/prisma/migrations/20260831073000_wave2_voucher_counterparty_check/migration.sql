-- Wave2 / SCHEMA-F02: Add DB-level CHECK constraint on Voucher.counterpartyType.
--
-- Background (from audit finding SCHEMA-F02):
--   The `Voucher` model has polymorphic counterparty fields:
--     * `counterpartyType String?`
--     * `counterpartyId   String?`
--   These are intentionally polymorphic (the counterparty can be a Customer,
--   Supplier, Worker, Treasury, or NONE). A real FK cannot be created on a
--   polymorphic field. However, the absence of ANY constraint allows:
--     * Free-text values for `counterpartyType` (e.g. 'Custmer', '...').
--     * Vouchers pointing to non-existent entities (no referential integrity).
--
-- Fix (defense-in-depth at DB level):
--   1. Add a CHECK constraint that restricts `counterpartyType` to a known
--      set of enum values: 'CUSTOMER', 'SUPPLIER', 'WORKER', 'TREASURY',
--      'NONE'. NULL is also allowed (no counterparty specified).
--   2. The CHECK is marked NOT VALID initially to avoid failing any rows
--      that may already have invalid `counterpartyType` values. A follow-up
--      ops ticket should backfill or fix those rows before VALIDATE.
--
--   NOTE: Runtime validation that `counterpartyId` references an existing
--   entity of the given `counterpartyType` is the responsibility of the
--   service layer. That runtime check is NOT implemented in this migration
--   (it requires service-layer code changes which are out of scope for
--   this schema-only fix — see the constraint "DO NOT modify any other
--   source files" in the Wave2-A task spec). The TODO is documented in
--   the Voucher schema comment.
--
-- Idempotency:
--   * `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`.
--
-- Rollback:
--   ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS vouchers_counterparty_type_check;

-- Normalize any pre-existing lowercase / case-variant `counterpartyType`
-- values BEFORE adding the CHECK constraint. This is a best-effort cleanup:
--   'customer' -> 'CUSTOMER', 'Supplier' -> 'SUPPLIER', etc.
-- If any rows still have unrecognized values, the CHECK (with NOT VALID)
-- will not fail at ADD time, but those rows will be unvalidatable.
UPDATE "vouchers"
  SET "counterpartyType" = UPPER("counterpartyType")
  WHERE "counterpartyType" IS NOT NULL
    AND "counterpartyType" != UPPER("counterpartyType");

-- Add the CHECK constraint (idempotent + NOT VALID for safety).
ALTER TABLE "vouchers"
  DROP CONSTRAINT IF EXISTS vouchers_counterparty_type_check;
ALTER TABLE "vouchers"
  ADD CONSTRAINT vouchers_counterparty_type_check
  CHECK (
    "counterpartyType" IS NULL
    OR "counterpartyType" IN ('CUSTOMER', 'SUPPLIER', 'WORKER', 'TREASURY', 'NONE')
  ) NOT VALID;

-- Attempt to validate the constraint (safe — wrapped in exception handler).
-- If validation fails (e.g. some pre-existing rows have unrecognized values),
-- the constraint stays NOT VALID and the migration succeeds. A follow-up ops
-- ticket should fix the remaining rows.
DO $$
BEGIN
  BEGIN
    ALTER TABLE "vouchers"
      VALIDATE CONSTRAINT vouchers_counterparty_type_check;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not validate constraint vouchers_counterparty_type_check: %', SQLERRM;
  END;
END $$;
