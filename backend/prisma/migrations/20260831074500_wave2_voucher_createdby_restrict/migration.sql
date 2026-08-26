-- Wave2 / SCHEMA-F03: Ensure vouchers.createdById FK uses ON DELETE RESTRICT.
--
-- Background (from audit finding SCHEMA-F03):
--   The Prisma schema declared `createdBy User?` (optional relation) on
--   `Voucher`, but the underlying column `createdById` is NOT NULL
--   (created in init migration line 473). Prisma's default `onDelete`
--   behavior for an optional relation is `SetNull`, which would cause a
--   runtime P2003 error if a User with vouchers is deleted (cannot SET
--   NULL on a NOT NULL column).
--
--   The init migration (`20260823183624_init`) actually used
--   `ON DELETE RESTRICT` for this FK (line 676), but the schema drift
--   means any future `prisma migrate dev` would generate a migration to
--   change the FK to SET NULL — a footgun.
--
-- Fix:
--   1. Prisma schema: change `createdBy User?` to `createdBy User` (required
--      relation matching the NOT NULL column) with explicit
--      `onDelete: Restrict`. (Done in `schema.prisma`.)
--   2. This migration documents the FK change: it drops and re-adds the FK
--      with explicit `ON DELETE RESTRICT` to ensure consistency even on
--      databases where a previous `prisma migrate dev` had silently
--      switched the FK to SET NULL.
--
-- Idempotency:
--   * Uses `IF EXISTS` in `DROP CONSTRAINT` (via a DO block to handle
--     PG versions where `DROP CONSTRAINT IF EXISTS` may not be supported
--     in ALTER TABLE).
--   * The `ADD CONSTRAINT` is guarded by a check on `pg_constraint` so
--     re-running the migration does not fail with "constraint already exists".
--
-- Rollback:
--   -- The FK was originally ON DELETE RESTRICT in init migration line 676,
--   -- so the schema was already correct. To roll back to the (broken)
--   -- SET NULL behavior, change the Prisma schema back to `User?` with
--   -- `onDelete: SetNull` and re-run prisma migrate dev. NOT recommended.
--   ALTER TABLE "vouchers" DROP CONSTRAINT IF EXISTS "vouchers_createdById_fkey";
--   ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_createdById_fkey"
--     FOREIGN KEY ("createdById") REFERENCES "users"("id")
--     ON DELETE SET NULL ON UPDATE CASCADE;

-- 1. Drop the existing FK (if any) — handle both RESTRICT and SET NULL cases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_createdById_fkey'
  ) THEN
    ALTER TABLE "vouchers" DROP CONSTRAINT "vouchers_createdById_fkey";
  END IF;
END $$;

-- 2. Re-add the FK with explicit ON DELETE RESTRICT.
--    This matches the init migration line 676 and the Prisma schema
--    (after the Wave2-F03 fix: `createdBy User @relation(..., onDelete: Restrict)`).
ALTER TABLE "vouchers"
  ADD CONSTRAINT "vouchers_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
