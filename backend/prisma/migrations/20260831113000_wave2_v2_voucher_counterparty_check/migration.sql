-- Wave 2 v2 — SCHEMA-F02: Voucher polymorphic counterparty CHECK.
--
-- Background (audit AUDIT-V3-1, SCHEMA-F02):
--   `Voucher.counterpartyType` (TEXT, nullable) and `Voucher.counterpartyId`
--   (TEXT, nullable) implement a polymorphic counterparty reference with NO
--   FK and NO CHECK on the value of `counterpartyType`. Any string is allowed
--   (`'CUSTOMER'`, `'customer'`, `'Customer'`, `'VENDOR'`, `''`, ...). This
--   means a voucher can be created pointing at a non-existent entity without
--   any database-level rejection.
--
-- This migration:
--   1. Normalizes existing `counterpartyType` values to UPPER case so the
--      CHECK constraint will accept them (the whitelist is uppercase).
--   2. Adds a column-level CHECK that `counterpartyType` must be NULL or one
--      of ('CUSTOMER','SUPPLIER','WORKER','TREASURY','NONE') as NOT VALID,
--      so existing rows that violate the whitelist are not rejected.
--   3. Attempts VALIDATE CONSTRAINT in a DO block (try/catch). If existing
--      rows still violate (e.g., a custom type was used), the validation is
--      skipped with a NOTICE — operators must repair data manually.
--
-- NOTE: This migration does NOT add real FKs for the polymorphic relation.
-- Adding three nullable FKs (customerId/supplierId/workerId) with an XOR
-- CHECK is a larger refactor that requires backfill of existing rows.
-- For now, the runtime entity-check is the responsibility of the service
-- layer (VoucherService) — see the TODO comment added to the Voucher model
-- in schema.prisma.

-- 1. Normalize existing values to UPPER.
UPDATE "vouchers"
  SET "counterpartyType" = UPPER("counterpartyType")
  WHERE "counterpartyType" IS NOT NULL
    AND "counterpartyType" <> UPPER("counterpartyType");

-- 2. Add the CHECK constraint (NOT VALID — existing rows are skipped).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vouchers_counterpartyType_check'
      AND conrelid = '"vouchers"'::regclass
  ) THEN
    ALTER TABLE "vouchers"
      ADD CONSTRAINT "vouchers_counterpartyType_check"
      CHECK (
        "counterpartyType" IS NULL
        OR "counterpartyType" IN ('CUSTOMER','SUPPLIER','WORKER','TREASURY','NONE')
      ) NOT VALID;
  END IF;
END $$;

-- 3. Attempt to validate the constraint (may fail if rows use other types).
DO $$
BEGIN
  ALTER TABLE "vouchers"
    VALIDATE CONSTRAINT "vouchers_counterpartyType_check";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'Could not validate vouchers_counterpartyType_check: %. Manual data repair required (update or NULL out invalid counterpartyType values).',
    SQLERRM;
END $$;
