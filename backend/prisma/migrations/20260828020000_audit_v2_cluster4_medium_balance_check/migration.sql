-- Cluster 4 (E3): Defense-in-depth — SQL CHECK على treasuries.balance.
--
-- الـ Treasury.balance من نوع Decimal(15, 2) افتراضياً = 0. يُمكن أن يصبح سالباً
-- نظرياً عند دفع أكبر من المتاح (لكن الـ Application layer يمنع ذلك في
-- FinancialPostingService.postJournalEntry عبر التحقق).
--
-- هذا الـ CHECK يضمن أن الـ DB ترفض أي تحديث يحاول جعل balance < 0 —
-- يعمل كـ secondary safety net ضد bugs أو scripts تتجاوز الـ app layer.
--
-- Customer/Supplier.balance يُسمح لها بأن تكون سالبة (سلف / دفع مقدم) —
-- لذا لا نُطبق CHECK عليها هنا. مستقبلاً، عندما نُضيف creditLimit field،
-- يمكن إضافة CHECK (balance >= -creditLimit).

ALTER TABLE treasuries
  DROP CONSTRAINT IF EXISTS treasuries_balance_non_negative;
ALTER TABLE treasuries
  ADD CONSTRAINT treasuries_balance_non_negative
  CHECK ("balance" >= 0);
