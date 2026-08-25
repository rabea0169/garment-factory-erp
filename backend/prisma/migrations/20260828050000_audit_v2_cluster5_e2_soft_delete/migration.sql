-- E2: Soft-delete columns on Customer / Supplier / Product / Treasury.
-- Adds deleted_at TIMESTAMP + composite index (is_active, deleted_at) on each.
-- Schema-only — services continue using isActive for now. Future PR will switch
-- delete operations to set deletedAt = now() (preserves audit trail).

-- 1. ADD COLUMN IF NOT EXISTS on all 4 tables (idempotent).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "treasuries" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- 2. Composite indexes (idempotent).
-- These complement (do not replace) the existing is_active-only indexes for now;
-- the new (is_active, deleted_at) is preferred for the common filter pattern.
CREATE INDEX IF NOT EXISTS "customers_isActive_deletedAt_idx" ON "customers"("isActive", "deletedAt");
CREATE INDEX IF NOT EXISTS "suppliers_isActive_deletedAt_idx" ON "suppliers"("isActive", "deletedAt");
CREATE INDEX IF NOT EXISTS "products_isActive_deletedAt_idx" ON "products"("isActive", "deletedAt");
CREATE INDEX IF NOT EXISTS "treasuries_isActive_deletedAt_idx" ON "treasuries"("isActive", "deletedAt");
