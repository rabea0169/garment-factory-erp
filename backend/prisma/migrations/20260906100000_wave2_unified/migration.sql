-- GF-IMP-W2 / الهجرة الموحدة للموجة الثانية (Batch A) — يُنشئها W2-2a حصريًا
-- ويوسّعها Batch B (البنية) لاحقًا في نفس الملف.
--
-- هذه الهجرة تجمع تعديلات القاعدة للموجة الثانية في مكان واحد (بدل هجرة
-- لكل بند) لسهولة المراجعة والنشر كدفعة واحدة. كل بند موثق أدناه بمعرّفه
-- في خطة GF-IMP-W2.
--
-- العناصر في هذه الدفعة (Batch A — W2-2a):
--   1. HR-2 (P1): عمود settled_amount على worker_advances — ذاكرة تسوية
--      السلف. المتبقي غير المسوى = amount - settled_amount هو وحده الذي
--      يدخل حساب خصم السلف في createPayroll، وتوزيع الخصم الفعلي على
--      السلف يجري FIFO داخل معاملة payPayroll (settled_amount += المخصص
--      بحد amount). قبل هذا العمود كانت الخدمة تعيد تجميع كل سلف الفترة
--      بلا ذاكرة لما خُصم فتخصم السلفة الواحدة مرات متعددة.
--   2. HR-2 (فهرس): فهرس تاريخ السلف worker_advances(date) — كل حسابات
--      الخصم والتوزيع تستعلم بنطاق التاريخ (date BETWEEN periodStart AND
--      periodEnd) فالفهرس يحوّلها من مسح كامل إلى range scan.
--   3. DSH-2: فهرس تاريخ الإنتاج اليومي daily_production(date) — لوحات
--      المتابعة والرواتب تجمّع daily_production بنطاق تاريخ.
--
-- ملاحظة نشر: كل العبارات idempotent (IF NOT EXISTS) — إعادة التطبيق آمنة.

-- HR-2 (P1): ذاكرة تسوية السلف — المتبقي غير المسوى = amount - settled_amount.
ALTER TABLE "worker_advances"
  ADD COLUMN IF NOT EXISTS "settled_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- HR-2: فهرس تاريخ السلف — استعلامات نطاق الفترة في حساب الخصم والتوزيع FIFO.
CREATE INDEX IF NOT EXISTS "worker_advances_date_idx"
  ON "worker_advances"("date");

-- DSH-2: فهرس تاريخ الإنتاج اليومي — تجميعات الرواتب ولوحات المتابعة.
CREATE INDEX IF NOT EXISTS "daily_production_date_idx"
  ON "daily_production"("date");

-- ===================================================================
-- Batch B (البنية — الرئيس): التوسعة المركزية للهجرة الموحدة
-- ===================================================================

-- DSH-2 (تكملة): فهرس مركب العامل+التاريخ — تجميعات الرواتب لكل عامل
-- (createPayroll يجمع daily_production لـ workerId عبر نطاق الفترة).
CREATE INDEX IF NOT EXISTS "daily_production_worker_date_idx"
  ON "daily_production"("workerId", "date");

-- PUR-5 (أ): حالة اعتماد لأمر الشراء — انتقال DRAFT→APPROVED بفصل واجبات
-- وبوابة استلام على APPROVED. ALTER TYPE ADD VALUE لا يمكن استعمال القيمة
-- داخل نفس المعاملة — هذا الملف لا يستعملها في SQL، فقط الكود لاحقًا.
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'APPROVED';

-- SHP-3 (أ): حالة إلغاء للشحنة في طور التحضير — PREPARING→CANCELLED
-- (بلا آثار مالية/مخزون: الشحنة في PREPARING لم ترحّل شيئًا بعد الإنشاء).
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- INF-8: مواءمة علاقة تنظيف مفتاح idempotency للشحنات مع نمط SetNull
-- المعتمد في sales_returns و purchase_receipts — كان RESTRICT في GF-0019
-- فيمنع أي تنظيف مستقبلي لجدول المفاتيح المتنامي.
ALTER TABLE "shipments" DROP CONSTRAINT IF EXISTS "shipments_idempotencyKeyId_fkey";
ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_idempotencyKeyId_fkey"
  FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

