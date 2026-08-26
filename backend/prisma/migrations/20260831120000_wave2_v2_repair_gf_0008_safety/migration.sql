-- Wave 2 v2 — SCHEMA-F04: Safety net for the destructive `gf_0008` migration.
--
-- Background (audit AUDIT-V3-1, SCHEMA-F04):
--   `20260825102934_gf_0008_bom_versions_and_work_order_sku` performs three
--   destructive operations: DROP TABLE `bom_items`, DROP COLUMN `productId`
--   on `work_orders`, and ADD COLUMN `bomVersionId`/`productVariantId` TEXT
--   NOT NULL with NO default. The latter would fail on a non-empty
--   `work_orders` table because Postgres cannot fill NOT NULL columns with
--   no default for existing rows.
--
--   The original migration is immutable (already shipped). This corrective
--   migration is a SAFETY NET:
--     * If `gf_0008` ran successfully, the columns already exist with no
--       default — this migration's `ADD COLUMN IF NOT EXISTS` is a no-op
--       and the `DROP DEFAULT` is also a no-op (no default exists).
--     * If `gf_0008` partially failed (columns missing on a recovered DB),
--       this migration adds them with a safe `DEFAULT ''` so existing rows
--       can be backfilled, then drops the default to match the original
--       schema shape.
--     * A NOTICE is raised if any rows still have the empty placeholder,
--       indicating manual backfill is required (the FK constraint added by
--       `gf_0008` will reject empty strings as invalid BomVersion/ProductVariant
--       references, so these rows must be repaired before they can be used).
--
-- NOTE: This migration cannot restore the dropped `bom_items` table or the
-- dropped `productId` column on `work_orders`. Those data losses are
-- irreversible — see the audit SCHEMA-F04 recommendation for archival
-- strategy. This migration only ensures the schema is in a consistent state.

-- 1. Add the columns with a safe default if missing.
--    The `IF NOT EXISTS` clause makes this a no-op when the columns already
--    exist (the normal post-gf_0008 state).
ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "bomVersionId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "productVariantId" TEXT NOT NULL DEFAULT '';

-- 2. Drop the default to restore the original schema shape (matches gf_0008
--    output: NOT NULL with no default). Idempotent — `DROP DEFAULT` on a
--    column with no default is a no-op in Postgres.
ALTER TABLE "work_orders" ALTER COLUMN "bomVersionId" DROP DEFAULT;
ALTER TABLE "work_orders" ALTER COLUMN "productVariantId" DROP DEFAULT;

-- 3. NOTICE if any rows still have the empty placeholder (only possible if
--    step 1 actually added the columns with the default on a non-empty table).
--    These rows need manual backfill — they cannot satisfy the FK constraint
--    (no BomVersion/ProductVariant has id='').
DO $$
DECLARE
  placeholder_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO placeholder_count FROM "work_orders"
    WHERE "bomVersionId" = '' OR "productVariantId" = '';
  IF placeholder_count > 0 THEN
    RAISE NOTICE
      'work_orders has % row(s) with empty bomVersionId/productVariantId placeholder. Manual backfill required — these rows violate the FK to bom_versions/product_variants.',
      placeholder_count;
  END IF;
END $$;
