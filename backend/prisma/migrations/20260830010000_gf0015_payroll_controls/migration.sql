-- GF-0015: auditable payroll draft/approval controls.
-- Additive migration. No payroll, attendance, or production rows are deleted.
CREATE TYPE "PayrollStatus" AS ENUM (
  'DRAFT',
  'APPROVED'
);

ALTER TABLE "payrolls"
  ADD COLUMN "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "idempotencyKeyId" TEXT;

ALTER TABLE "payrolls"
  ADD CONSTRAINT "payrolls_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payrolls_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payrolls_idempotencyKeyId_fkey"
    FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payrolls_idempotencyKeyId_key" UNIQUE ("idempotencyKeyId"),
  ADD CONSTRAINT "payrolls_worker_period_key" UNIQUE ("workerId", "periodStart", "periodEnd");

-- New and updated rows cannot contain a negative financial result. Existing rows
-- are preserved; NOT VALID allows a later controlled historical reconciliation.
ALTER TABLE "payrolls"
  ADD CONSTRAINT "payrolls_nonnegative_amounts_check"
    CHECK ("grossAmount" >= 0 AND "advanceDeduct" >= 0 AND "absenceDeduct" >= 0 AND "netAmount" >= 0) NOT VALID,
  ADD CONSTRAINT "payrolls_approval_fields_check"
    CHECK ("status" = 'DRAFT' OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)) NOT VALID;

CREATE INDEX "payrolls_status_period_idx"
  ON "payrolls"("status", "periodStart", "periodEnd");
CREATE INDEX "payrolls_createdBy_createdAt_idx"
  ON "payrolls"("createdById", "createdAt");
CREATE INDEX "payrolls_approvedBy_approvedAt_idx"
  ON "payrolls"("approvedById", "approvedAt");
