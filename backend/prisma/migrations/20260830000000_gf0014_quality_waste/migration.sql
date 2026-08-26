-- GF-0014: quality checks, classified waste, stage-run linkage, and audit data.
-- Additive migration. Legacy rows receive safe defaults and conservation is NOT VALID
-- until historical data has been reconciled in a later controlled migration.

CREATE TYPE "QualityWasteReason" AS ENUM (
  'NATURAL_LOSS',
  'DEFECT_RELATED',
  'HUMAN_ERROR',
  'MATERIAL_DEFECT',
  'OTHER'
);

CREATE TYPE "QualityCheckStatus" AS ENUM (
  'COMPLETED',
  'VOIDED'
);

ALTER TABLE "quality_checks"
  ADD COLUMN "stageRunId" TEXT,
  ADD COLUMN "wasteQty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "wasteReason" "QualityWasteReason",
  ADD COLUMN "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN "wasteCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "status" "QualityCheckStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "idempotencyKeyId" TEXT,
  ADD COLUMN "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "quality_checks"
  ADD CONSTRAINT "quality_checks_stageRunId_fkey"
    FOREIGN KEY ("stageRunId") REFERENCES "production_stage_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "quality_checks_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "quality_checks_idempotencyKeyId_fkey"
    FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "quality_checks_idempotencyKeyId_key" UNIQUE ("idempotencyKeyId"),
  ADD CONSTRAINT "quality_checks_stageRunId_key" UNIQUE ("stageRunId");

ALTER TABLE "quality_checks"
  ADD CONSTRAINT "quality_checks_nonnegative_quantities_check"
    CHECK ("checkedQty" >= 0 AND "passedQty" >= 0 AND "rejectedQty" >= 0 AND "wasteQty" >= 0) NOT VALID,
  ADD CONSTRAINT "quality_checks_costs_nonnegative_check"
    CHECK ("unitCost" >= 0 AND "wasteCost" >= 0) NOT VALID,
  ADD CONSTRAINT "quality_checks_conservation_check"
    CHECK ("checkedQty" = "passedQty" + "rejectedQty" + "wasteQty") NOT VALID,
  ADD CONSTRAINT "quality_checks_waste_reason_check"
    CHECK ("wasteQty" = 0 OR "wasteReason" IS NOT NULL) NOT VALID;

CREATE INDEX "quality_checks_workOrderId_stage_checkedAt_idx"
  ON "quality_checks"("workOrderId", "stage", "checkedAt");
CREATE INDEX "quality_checks_stageRunId_checkedAt_idx"
  ON "quality_checks"("stageRunId", "checkedAt");
CREATE INDEX "quality_checks_createdById_checkedAt_idx"
  ON "quality_checks"("createdById", "checkedAt");
