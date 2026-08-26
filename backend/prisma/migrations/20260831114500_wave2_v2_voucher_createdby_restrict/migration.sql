-- Wave 2 v2 — SCHEMA-F03: Voucher.createdBy relation drift fix.
--
-- Background (audit AUDIT-V3-1, SCHEMA-F03):
--   `Voucher.createdById` is declared `TEXT NOT NULL` (init migration), but
--   the Prisma relation `createdBy User?` is optional without an explicit
--   `onDelete`. Prisma's default for optional relations is `SetNull`, which
--   would fail at runtime when deleting a User that has vouchers (because
--   the column is NOT NULL → P2003 constraint violation).
--
--   The init migration used `ON DELETE RESTRICT` manually, but any future
--   `prisma migrate dev` on the Voucher model would generate a migration that
--   changes the FK to `SET NULL`, causing runtime failures.
--
-- This migration:
--   1. Drops the existing `vouchers_createdById_fkey` constraint (via DO
--      block so it's safe to re-run).
--   2. Re-adds it with explicit `ON DELETE RESTRICT ON UPDATE CASCADE`,
--      matching the init migration's intent and the schema.prisma update
--      that adds `onDelete: Restrict` explicitly.
--
-- The matching schema.prisma change makes the `createdBy` relation required
-- (`User`, not `User?`) and adds `onDelete: Restrict` explicitly.

-- 1. Drop the existing FK if it exists (idempotent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vouchers_createdById_fkey'
      AND conrelid = '"vouchers"'::regclass
  ) THEN
    ALTER TABLE "vouchers" DROP CONSTRAINT "vouchers_createdById_fkey";
  END IF;
END $$;

-- 2. Re-add with explicit ON DELETE RESTRICT (matches the NOT NULL column
--    and the schema.prisma onDelete: Restrict declaration).
ALTER TABLE "vouchers"
  ADD CONSTRAINT "vouchers_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
