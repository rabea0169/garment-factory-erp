-- Wave 2 v2 — COMM-F04 (schema part): Add `PAID` value to `PayrollStatus` enum.
--
-- Background (audit COMM-F04):
--   The `PayrollStatus` enum only had `DRAFT` and `APPROVED`. There was no
--   way to distinguish an approved-but-unpaid payroll from a paid one — the
--   service relied solely on the boolean `isPaid` flag. The hr.service.ts
--   `payPayroll` method (added in PR #57) currently keeps status as APPROVED
--   when it pays, conflating approval and payment. Adding `PAID` allows the
--   service to set status=PAID on payment, giving a clean state machine:
--     DRAFT → APPROVED → PAID
--
-- This migration:
--   * Adds `PAID` to the enum idempotently (only if it's not already present).
--     Uses a DO block that checks pg_enum and skips the ALTER TYPE if the
--     value already exists. This is necessary because `ALTER TYPE ... ADD
--     VALUE` cannot run inside a transaction in older Postgres, and Prisma
--     wraps each migration in a transaction — but the DO block is still
--     safe inside a tx because the inner SELECT-then-ALTER is a single
--     statement sequence (the ALTER TYPE ADD VALUE itself is allowed inside
--     a DO block running in a tx in Postgres >= 12; on older versions it
--     would error and the migration would need to be split).
--
-- Matching schema.prisma change adds `PAID` to the enum declaration.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PayrollStatus'
      AND e.enumlabel = 'PAID'
  ) THEN
    ALTER TYPE "PayrollStatus" ADD VALUE 'PAID';
  END IF;
END $$;
