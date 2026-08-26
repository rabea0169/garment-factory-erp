-- Cluster 5 corrective migration: durable reversal metadata and one reversal per journal entry.
-- Additive and safe for existing rows.

ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_reversalOfId_key"
  ON "journal_entries" ("reversalOfId")
  WHERE "reversalOfId" IS NOT NULL;
