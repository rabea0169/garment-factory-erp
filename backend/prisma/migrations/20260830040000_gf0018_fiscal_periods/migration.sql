-- GF-0018: fiscal periods and journal entry period linkage.
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "fiscal_periods" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_periods_date_order_check" CHECK ("startDate" <= "endDate")
);

CREATE UNIQUE INDEX "fiscal_periods_startDate_endDate_key"
  ON "fiscal_periods"("startDate", "endDate");
CREATE INDEX "fiscal_periods_status_startDate_endDate_idx"
  ON "fiscal_periods"("status", "startDate", "endDate");

ALTER TABLE "fiscal_periods"
  ADD CONSTRAINT "fiscal_periods_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entries" ADD COLUMN "fiscalPeriodId" TEXT;
CREATE INDEX "journal_entries_fiscalPeriodId_date_idx"
  ON "journal_entries"("fiscalPeriodId", "date");
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_fiscalPeriodId_fkey"
  FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Compatibility repair for the pre-existing E4 trigger: JournalLine stores one
-- balanced debit/credit pair and amount, not debit/credit numeric columns.
CREATE OR REPLACE FUNCTION check_journal_entry_balanced()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."amount" <= 0 OR NEW."debitAccountId" = NEW."creditAccountId" THEN
    RAISE EXCEPTION 'Journal line must have positive amount and distinct accounts'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_balanced_trigger ON journal_lines;
CREATE TRIGGER journal_lines_balanced_trigger
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_entry_balanced();
