-- A10: VAT 14% Egyptian on sales orders.
-- Adds subtotal / vatRate / vatAmount to sales_orders.
-- totalAmount semantics changes from "pre-VAT total" to "post-VAT total"
-- (= subtotal - discount + vatAmount).

-- 1. Add columns idempotently. Defaults allow existing rows to remain valid
--    (they'll need a separate backfill script to recompute historical VAT, but
--    that's a one-time data migration run after deploy, not a schema concern).
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(5,4) NOT NULL DEFAULT 0;
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "vatAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- 2. Backfill existing rows: assume historical rows had no VAT (vatRate=0),
--    and reuse existing totalAmount as subtotal so totals are consistent.
--    This is conservative — historical orders don't get retroactive VAT.
UPDATE "sales_orders"
  SET "subtotal" = "totalAmount" - "discount"
  WHERE "subtotal" = 0;

-- 3. Index for VAT reporting (which orders had VAT, by rate) — idempotent.
CREATE INDEX IF NOT EXISTS "sales_orders_vatRate_idx" ON "sales_orders"("vatRate");
