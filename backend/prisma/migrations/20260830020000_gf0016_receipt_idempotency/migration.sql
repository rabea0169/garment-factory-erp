-- GF-0016 hardening: make purchase receipt creation retry-safe.
-- Additive migration; existing receipts remain unchanged and nullable.
ALTER TABLE "purchase_receipts"
  ADD COLUMN "idempotencyKeyId" TEXT;

ALTER TABLE "purchase_receipts"
  ADD CONSTRAINT "purchase_receipts_idempotencyKeyId_key"
    UNIQUE ("idempotencyKeyId"),
  ADD CONSTRAINT "purchase_receipts_idempotencyKeyId_fkey"
    FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "purchase_receipts_idempotencyKeyId_idx"
  ON "purchase_receipts"("idempotencyKeyId");
