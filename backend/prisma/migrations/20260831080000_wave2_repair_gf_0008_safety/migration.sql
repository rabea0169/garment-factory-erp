-- Wave2 / SCHEMA-F04: Safety repair for destructive migration gf_0008.
--
-- Background (from audit finding SCHEMA-F04):
--   Migration `20260825102934_gf_0008_bom_versions_and_work_order_sku` did:
--     (1) DROP TABLE `bom_items` (data lost — no archive).
--     (2) DROP COLUMN `work_orders.productId` (data lost).
--     (3) ADD COLUMN `work_orders.bomVersionId`   TEXT NOT NULL (no default).
--     (4) ADD COLUMN `work_orders.productVariantId` TEXT NOT NULL (no default).
--     (5) ADD COLUMN `work_orders.wasteQty`       INTEGER NOT NULL DEFAULT 0 (safe).
--   Operations (3) and (4) FAIL on any non-empty `work_orders` table because
--   PostgreSQL cannot add a NOT NULL column without a default to a table
--   that has rows.
--
-- This migration is a defensive safety net. It does NOT undo gf_0008
-- (irreversible — bom_items data is gone, work_orders.productId is gone).
-- Instead, it ensures the `bomVersionId` and `productVariantId` columns
-- exist on `work_orders` (in case gf_0008 failed partway and was rolled
-- back), with a safe default that allows NOT NULL to succeed on a
-- non-empty table. The default is then DROPPED so the column matches
-- the Prisma schema (NOT NULL, no default — values must be provided by
-- the application layer on every INSERT).
--
-- Idempotency:
--   * `ADD COLUMN IF NOT EXISTS` for both columns.
--   * `DROP DEFAULT IF EXISTS` is implicit — `ALTER COLUMN ... DROP DEFAULT`
--     is a no-op if no default exists (PG does not raise an error).
--
-- Important note on data integrity:
--   If gf_0008 was applied to an EMPTY `work_orders` table (dev/test DB),
--   all subsequent rows will have been inserted with explicit values by
--   the application layer (e.g. seed.ts, the WorkOrder service). This
--   migration's UPDATE statements (commented out below) are a no-op.
--   If gf_0008 was applied to a NON-EMPTY table (production) and somehow
--   succeeded (e.g. via `--create-only` + manual application with the
--   default temporarily set), this migration ensures consistency.
--
-- Rollback:
--   -- This migration is purely additive (ensures columns exist with safe
--   -- defaults then drops the defaults). No rollback needed.
--   -- The original gf_0008 is irreversible: bom_items data and
--   -- work_orders.productId are gone. To restore them, you would need
--   -- a DB backup from before gf_0008 was applied.

-- 1. Ensure `bomVersionId` column exists (idempotent).
--    DEFAULT '' makes ADD COLUMN NOT NULL safe even on a non-empty table.
--    If the column already exists (from gf_0008), this is a no-op.
ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "bomVersionId" TEXT NOT NULL DEFAULT '';

-- 2. Ensure `productVariantId` column exists (idempotent).
ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "productVariantId" TEXT NOT NULL DEFAULT '';

-- 3. Defensive backfill (idempotent — only updates rows with the placeholder
--    empty string). In practice on a database where gf_0008 ran on an empty
--    table, no rows will have the placeholder.
--    We DO NOT auto-assign a random BomVersion/ProductVariant id here because
--    that would silently attach work orders to the WRONG bom/variant. The
--    correct backfill is a manual ops task that maps each work_order to the
--    right bom_version and product_variant. This block is left as a
--    documentation hint for ops:
--    -- UPDATE "work_orders" SET "bomVersionId" = '<manual lookup per row>'
--    --   WHERE "bomVersionId" = '';
--    -- UPDATE "work_orders" SET "productVariantId" = '<manual lookup per row>'
--    --   WHERE "productVariantId" = '';

-- 4. Drop the temporary DEFAULT so the column matches the Prisma schema
--    (NOT NULL, no default — the application layer must provide values).
--    `ALTER COLUMN ... DROP DEFAULT` is a no-op if no default exists.
ALTER TABLE "work_orders" ALTER COLUMN "bomVersionId" DROP DEFAULT;
ALTER TABLE "work_orders" ALTER COLUMN "productVariantId" DROP DEFAULT;

-- 5. Safety check: if any rows still have the empty placeholder, raise a
--    NOTICE (do not fail the migration — ops should manually fix).
DO $$
DECLARE
  v_empty_bv  INTEGER;
  v_empty_pv  INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_empty_bv FROM "work_orders" WHERE "bomVersionId" = '';
  SELECT COUNT(*) INTO v_empty_pv FROM "work_orders" WHERE "productVariantId" = '';
  IF v_empty_bv > 0 OR v_empty_pv > 0 THEN
    RAISE NOTICE
      'work_orders has rows with empty bomVersionId (%) or productVariantId (%). ' ||
      'These must be manually backfilled before the schema is consistent.',
      v_empty_bv, v_empty_pv;
  END IF;
END $$;
