-- Cluster 5 corrective migration: durable idempotency for financial postings.
-- Nullable unique keys preserve legacy entries while preventing duplicate keyed postings.
ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "postingKey" TEXT,
  ADD COLUMN IF NOT EXISTS "postingHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_postingKey_key"
  ON "journal_entries" ("postingKey")
  WHERE "postingKey" IS NOT NULL;
