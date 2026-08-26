-- Cluster 5 corrective migration: finished-good unit cost for stock valuation.
-- Existing balances are backfilled with zero because the legacy table has no
-- authoritative historical valuation; future PACKING receipts must provide cost.

ALTER TABLE "finished_good_stocks"
  ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "finished_good_stocks_productVariantId_unitCost_idx"
  ON "finished_good_stocks" ("productVariantId", "unitCost");

-- Backfill the authoritative WH-FG balance from the legacy aggregate once.
-- IDs are TEXT in this schema, so deterministic legacy IDs avoid relying on
-- optional PostgreSQL UUID extensions.
INSERT INTO "finished_good_stocks"
  ("id", "warehouseId", "productVariantId", "quantity", "unitCost", "createdAt", "updatedAt")
SELECT
  'legacy-fg-' || fg."id",
  w."id",
  fg."productVariantId",
  fg."quantity",
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "finished_goods" fg
JOIN "warehouses" w ON w."code" = 'WH-FG' AND w."isActive" = true
WHERE fg."quantity" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "finished_good_stocks" s
    WHERE s."warehouseId" = w."id"
      AND s."productVariantId" = fg."productVariantId"
  );

INSERT INTO "stock_ledger_entries"
  ("id", "entryCode", "type", "warehouseId", "productVariantId", "quantityDelta", "balanceAfter", "unitCost", "totalValue", "reference", "notes", "createdAt")
SELECT
  'legacy-fg-ledger-' || fg."id",
  'SLE-LEGACY-FG-' || fg."id",
  'RECEIVE',
  w."id",
  fg."productVariantId",
  fg."quantity",
  fg."quantity",
  0,
  0,
  'LEGACY-FINISHED-GOOD-BACKFILL',
  'Opening balance migrated from finished_goods',
  CURRENT_TIMESTAMP
FROM "finished_goods" fg
JOIN "warehouses" w ON w."code" = 'WH-FG' AND w."isActive" = true
WHERE fg."quantity" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "stock_ledger_entries" l
    WHERE l."entryCode" = 'SLE-LEGACY-FG-' || fg."id"
  );
