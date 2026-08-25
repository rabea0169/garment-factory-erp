-- E5: Multi-currency MVP — Currency model + currencyId on Treasury/JournalEntry.
-- Seeded with EGP (system default) + USD (reference). Future PR adds FX conversion logic.

-- 1. Create currencies table (idempotent — CREATE TABLE IF NOT EXISTS).
-- Note: 'id' has NO DEFAULT — all inserts (migration + seed) provide explicit UUIDs.
-- Prisma Client will also provide UUIDs at insert time via @default(uuid()).
CREATE TABLE IF NOT EXISTS "currencies" (
  "id" UUID NOT NULL,
  "code" VARCHAR(3) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "symbol" VARCHAR(10),
  "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "currencies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "currencies_code_key" UNIQUE ("code")
);

-- 2. Seed EGP (Egyptian Pound) — system default currency.
-- Use a fixed UUID so chart-of-accounts-style references work consistently.
INSERT INTO "currencies" ("id", "code", "name", "symbol", "decimalPlaces", "isActive")
VALUES (
  '00000000-0000-0000-0000-000000000101',
  'EGP',
  'Egyptian Pound',
  'E£',
  2,
  true
)
ON CONFLICT ("code") DO NOTHING;

-- 3. Seed USD (US Dollar) — reference currency for future multi-currency features.
INSERT INTO "currencies" ("id", "code", "name", "symbol", "decimalPlaces", "isActive")
VALUES (
  '00000000-0000-0000-0000-000000000102',
  'USD',
  'US Dollar',
  '$',
  2,
  true
)
ON CONFLICT ("code") DO NOTHING;

-- 4. Add currencyId columns (nullable for backfill).
ALTER TABLE "treasuries" ADD COLUMN IF NOT EXISTS "currencyId" UUID;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "currencyId" UUID;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "exchangeRate" DECIMAL(10,6);

-- 5. Backfill: assign EGP to existing treasuries + journal entries (rate 1.0).
UPDATE "treasuries"
  SET "currencyId" = '00000000-0000-0000-0000-000000000101'
  WHERE "currencyId" IS NULL;

UPDATE "journal_entries"
  SET
    "currencyId" = '00000000-0000-0000-0000-000000000101',
    "exchangeRate" = 1.0
  WHERE "currencyId" IS NULL;

-- 6. FK constraints (idempotent — check pg_constraint first).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'treasuries_currencyId_fkey'
  ) THEN
    ALTER TABLE "treasuries"
      ADD CONSTRAINT "treasuries_currencyId_fkey"
      FOREIGN KEY ("currencyId") REFERENCES "currencies"("id")
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_currencyId_fkey'
  ) THEN
    ALTER TABLE "journal_entries"
      ADD CONSTRAINT "journal_entries_currencyId_fkey"
      FOREIGN KEY ("currencyId") REFERENCES "currencies"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- 7. Indexes (idempotent).
CREATE INDEX IF NOT EXISTS "treasuries_currencyId_idx" ON "treasuries"("currencyId");
CREATE INDEX IF NOT EXISTS "journal_entries_currencyId_idx" ON "journal_entries"("currencyId");
