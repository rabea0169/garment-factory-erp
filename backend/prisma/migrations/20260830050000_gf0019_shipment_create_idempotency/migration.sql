-- GF-0019: make shipment creation retry-safe without changing existing shipments.
ALTER TABLE "shipments" ADD COLUMN "idempotencyKeyId" TEXT;

CREATE UNIQUE INDEX "shipments_idempotencyKeyId_key"
  ON "shipments"("idempotencyKeyId");

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_idempotencyKeyId_fkey"
  FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
