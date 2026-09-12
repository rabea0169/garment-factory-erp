-- audit-DB (P1): سد فجوات الفهارس لأنماط الاستعلام الفعلية المرصودة في الخدمات
-- (تصفية بالحالة + ترتيب زمني، كشوف الذمم بالطرف والتاريخ، تصفح التدقيق).
--
-- كل الفهارس وصفية إضافية (CREATE INDEX فقط) ومصرَّح بها كذلك في
-- schema.prisma حتى تبقى بوابة `prisma migrate diff` خضراء.
--
--   1) purchase_orders(status, createdAt) — تعادل sales_orders؛ قوائم
--      المشتريات تفلتر بالحالة وتُرتّب createdAt DESC (purchasing.service).
--   2) customer_payments(customerId, date) — كشف ذمم العملاء وأعمارها.
--   3) supplier_payments(supplierId, date) — كشف ذمم الموردين وأعمارها.
--   4) bom_lines(rawMaterialId) — "أي BOMs تستخدم الخامة X"؛ آخر FK غير مفهرس.
--   5) activity_logs(module, createdAt) — تصفح سجل التدقيق بالوحدة زمنيًا.
--   6) shipments(status, createdAt) — قوائم الشحنات (فلتر حالة + ترتيب زمني).
--   7) products(createdAt) / work_orders(createdAt) — ترتيب القوائم زمنيًا.

-- CreateIndex
CREATE INDEX "purchase_orders_status_createdAt_idx" ON "purchase_orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "customer_payments_customerId_date_idx" ON "customer_payments"("customerId", "date");

-- CreateIndex
CREATE INDEX "supplier_payments_supplierId_date_idx" ON "supplier_payments"("supplierId", "date");

-- CreateIndex
CREATE INDEX "bom_lines_rawMaterialId_idx" ON "bom_lines"("rawMaterialId");

-- CreateIndex
CREATE INDEX "activity_logs_module_createdAt_idx" ON "activity_logs"("module", "createdAt");

-- CreateIndex
CREATE INDEX "shipments_status_createdAt_idx" ON "shipments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "products_createdAt_idx" ON "products"("createdAt");

-- CreateIndex
CREATE INDEX "work_orders_createdAt_idx" ON "work_orders"("createdAt");
