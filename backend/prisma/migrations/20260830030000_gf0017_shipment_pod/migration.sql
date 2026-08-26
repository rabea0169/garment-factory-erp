-- GF-0017: auditable proof of delivery.
-- Additive; existing shipments remain valid with nullable POD fields.
ALTER TABLE "shipments"
  ADD COLUMN "proofOfDelivery" TEXT,
  ADD COLUMN "deliveredById" TEXT;

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_deliveredById_fkey"
    FOREIGN KEY ("deliveredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "shipments_status_deliveredAt_idx"
  ON "shipments"("status", "deliveredAt");
CREATE INDEX "shipments_deliveredById_idx"
  ON "shipments"("deliveredById");
