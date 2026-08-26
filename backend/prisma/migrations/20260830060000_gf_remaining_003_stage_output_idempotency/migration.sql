-- GF-REMAINING-003: make stage-output replay-safe at the database boundary.
-- Additive and backward-compatible: legacy stage runs remain nullable.
ALTER TABLE "production_stage_runs"
  ADD COLUMN "idempotencyKeyId" TEXT;

CREATE UNIQUE INDEX "production_stage_runs_idempotencyKeyId_key"
  ON "production_stage_runs"("idempotencyKeyId");

ALTER TABLE "production_stage_runs"
  ADD CONSTRAINT "production_stage_runs_idempotencyKeyId_fkey"
  FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
