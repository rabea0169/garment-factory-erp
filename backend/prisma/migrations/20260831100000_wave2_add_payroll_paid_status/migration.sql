-- WAVE2-C: COMM-F04 — Add PAID value to PayrollStatus enum.
--
-- Problem: enum PayrollStatus was { DRAFT, APPROVED } only — no endpoint could mark
-- a payroll as paid. COMM-F04 fix in hr.service.ts adds payPayroll() which transitions
-- APPROVED → PAID, but the enum lacked the value.
--
-- Fix: ALTER TYPE ... ADD VALUE. Per Prisma migration conventions, this is the only
-- DDL needed. The new hr.service.payPayroll() sets status='PAID' inside a $transaction
-- with the GL posting for Dr SALARIES_PAYABLE / Cr CASH.
--
-- Idempotency: ALTER TYPE ADD VALUE will fail on re-run if the value already exists,
-- so we wrap it in a DO block that checks pg_enum first.
--
-- Rollback:
--   Postgres does not support removing an enum value once added (PG < 12 had no
--   support; PG 12+ allows but it's expensive — requires table rewrite). To roll back:
--   1. Update all rows with status='PAID' back to 'APPROVED':
--        UPDATE "Payroll" SET status = 'APPROVED' WHERE status = 'PAID';
--   2. Recreate the enum without PAID (requires recreating the type + column).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PayrollStatus' AND e.enumlabel = 'PAID'
  ) THEN
    ALTER TYPE "PayrollStatus" ADD VALUE 'PAID';
  END IF;
END $$;
