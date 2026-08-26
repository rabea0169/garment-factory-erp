-- A9: Reversal tracking on JournalEntry
-- Adds isReversed / reversalOfId / reversedById / reversedAt to journal_entries
-- to enable audit trail for reversals. The FinancialPostingService.reverseJournalEntry
-- marks the original entry as reversed + links the new reversal entry via reversalOfId.

-- NOTE: All id columns are TEXT (matching Prisma's @default(uuid()) convention
-- from the init migration). Using UUID would cause FK type mismatch errors
-- because journal_entries.id is TEXT not UUID.

-- 1. Add columns idempotently (safe to re-run after partial failure).
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "isReversed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reversalOfId" TEXT;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reversedById" TEXT;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3);

-- 2. Self-FK: reversal entry → original entry (ON DELETE SET NULL — never block deletion of original).
--    Drop the constraint first if it exists (idempotent re-run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'journal_entries_reversalOfId_fkey'
  ) THEN
    ALTER TABLE "journal_entries"
      ADD CONSTRAINT "journal_entries_reversalOfId_fkey"
      FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. FK: who reversed (user) — ON DELETE SET NULL (audit trail remains even if user is deleted).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'journal_entries_reversedById_fkey'
  ) THEN
    ALTER TABLE "journal_entries"
      ADD CONSTRAINT "journal_entries_reversedById_fkey"
      FOREIGN KEY ("reversedById") REFERENCES "users"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Indexes for reversal queries (idempotent).
CREATE INDEX IF NOT EXISTS "journal_entries_reversalOfId_idx" ON "journal_entries"("reversalOfId");
CREATE INDEX IF NOT EXISTS "journal_entries_isReversed_idx" ON "journal_entries"("isReversed");
