-- Cluster 3 (E4): Defense-in-depth — SQL trigger على journal_lines
-- للتحقق من أن مجموع debits == مجموع credits لكل JournalEntry.
--
-- الـ primary check موجود في FinancialPostingService (Application layer) —
-- هذا الـ trigger secondary safety net يلتقط أي bypass من bugs أو migrations
-- مستقبلية قد تكتب journal_lines مباشرة (مثلاً scripts لـ backfill).
--
-- يُطلق BEFORE INSERT OR UPDATE على journal_lines، يحسب مجموع debit و credit
-- للـ entry الأم ويُخفق العملية إذا لم يتطابق (مع السماح للحالة التي يكون
-- فيها القيد ما زال قيد الإنشاء — يجب أن يُكمل بـ at least 2 lines لموازنة).
--
-- نطبّق المرحلة 1 فقط: لكل entry، إما (0 lines — ما زال ينشأ) أو (debit=credit).

CREATE OR REPLACE FUNCTION check_journal_entry_balanced()
RETURNS TRIGGER AS $$
DECLARE
  total_debit  DECIMAL(20, 2);
  total_credit DECIMAL(20, 2);
  line_count   INTEGER;
BEGIN
  -- احسب المجاميع لـ entry الأم (مع الـ line الجديد/المعدّل)
  SELECT
    COALESCE(SUM(CASE WHEN l.debit  > 0 THEN l.debit  ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN l.credit > 0 THEN l.credit ELSE 0 END), 0),
    COUNT(*)
  INTO total_debit, total_credit, line_count
  FROM journal_lines l
  WHERE l."journalEntryId" = NEW."journalEntryId"
    -- لا نُدخل الـ line الحالي في الـ SELECT في حالة UPDATE (يحل محله الجديد)
    AND l.id <> NEW.id;

  -- أضف الـ line الجديد/المعدّل للمجاميع
  total_debit  := total_debit  + (CASE WHEN NEW.debit  > 0 THEN NEW.debit  ELSE 0 END);
  total_credit := total_credit + (CASE WHEN NEW.credit > 0 THEN NEW.credit ELSE 0 END);
  line_count   := line_count + 1;

  -- القاعدة: entry متوازن = total_debit == total_credit (بفارق <= 0.01 للاعبات الفاصلة)
  IF line_count >= 2 AND ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry % not balanced: total debit=%, total credit=%',
      NEW."journalEntryId", total_debit, total_credit
      USING ERRCODE = '23514'; -- check_violation
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_balanced_trigger ON journal_lines;
CREATE TRIGGER journal_lines_balanced_trigger
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_entry_balanced();
