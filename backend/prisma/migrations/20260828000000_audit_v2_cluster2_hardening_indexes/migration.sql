-- Cluster 2: Audit v2 hardening indexes (idempotent).
--
-- هذا الـ migration يضيف فهارس محسوبة للأداء والاستعلامات على الجداول
-- التي لم تُغطَّ في cluster 1 (currencies/journal_lines/vouchers/treasuries/
-- journal_entries/sales_orders). كلها CREATE INDEX IF NOT EXISTS — آمنة
-- للتشغيل المتكرر وعلى DB قائمة.
--
-- الأهداف:
--   1. تسريع فلترة الـ vouchers حسب (type, date) — استعلامات الـ treasury.
--   2. فلترة treasuries النشطة فقط — isActive = true.
--   3. استعلامات الـ journal entries حسب التاريخ (reports).
--   4. فلترة sales_orders حسب (status, createdAt) — لوحة المبيعات.

CREATE INDEX IF NOT EXISTS "vouchers_type_date_idx"
  ON "vouchers" ("type", "date");

CREATE INDEX IF NOT EXISTS "treasuries_isActive_idx"
  ON "treasuries" ("isActive");

CREATE INDEX IF NOT EXISTS "journal_entries_date_idx"
  ON "journal_entries" ("date");

-- مؤشر مركب على (status, "createdAt") لتسريع:
--   - استعلامات "أحدث طلبات بحالة معينة" (default filter في UI)
--   - dashboard "طلبات اليوم حسب الحالة"
CREATE INDEX IF NOT EXISTS "sales_orders_status_createdAt_idx"
  ON "sales_orders" ("status", "createdAt");
