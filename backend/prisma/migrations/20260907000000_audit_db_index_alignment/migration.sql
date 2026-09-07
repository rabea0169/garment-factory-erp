-- audit-DB (P1): محاذاة الفهارس وقيود FK بين القاعدة والمخطط حتى يصبح
-- `prisma migrate diff --from-config-datasource --to-schema` فارغًا تمامًا.
--
-- الخلفية: انحراف تراكمي من موجات الهجرات المكتوبة يدويًا (أسماء فهارس
-- snake_case قديمة + فهارس SQL خام غير مصرّح بها + 3 فهارس مصرّح بها لم
-- تُنشأ قط + 6 قيود FK بإجراءات مرجعية تخالف المخطط).
--
-- محتوى الهجرة (كلها عمليات وصفية آمنة):
--   1) DROP INDEX ×3: فهارس زائدة مغطاة بفهرس أوسع/فريد:
--      - journal_entries_createdById_idx (مغطى بالمركب createdById+createdAt)
--      - purchase_receipts_idempotencyKeyId_idx (مغطى بالفريد _key)
--      - treasuries_isActive_idx (مغطى بالمركب isActive+deletedAt)
--   2) CREATE INDEX ×3: المصرّح بها في المخطط والناقصة في القاعدة:
--      - work_orders(status, currentStage) — لوحة أوامر التشغيل
--      - work_orders(productVariantId, status) — تتبع إنتاج متغير
--      - journal_entries(createdById, createdAt) — قيود المستخدم/التقارير
--   3) FK ×6: إعادة إنشاء بإجراءات المخطط (ON DELETE SET NULL ON UPDATE
--      CASCADE) بدل الإجراءات الافتراضية: journal_entries ×4 +
--      production_stage_runs.idempotencyKeyId + treasuries.currencyId
--   4) RENAME INDEX ×50: توحيد أسماء الفهارس مع أسماء Prisma المتوقعة
--      (snake_case قديم → camelCase) — بلا أي تغيير وظيفي.
--
-- بعد هذه الهجرة: بوابة CI جديدة `prisma:migrate:diff` تراقب أي انحراف
-- مستقبلي بين الهجرات والمخطط (exit code 2 عند أي فرق).

-- DropForeignKey
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_currencyId_fkey";

-- DropForeignKey
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_fiscalPeriodId_fkey";

-- DropForeignKey
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_reversalOfId_fkey";

-- DropForeignKey
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_reversedById_fkey";

-- DropForeignKey
ALTER TABLE "production_stage_runs" DROP CONSTRAINT "production_stage_runs_idempotencyKeyId_fkey";

-- DropForeignKey
ALTER TABLE "treasuries" DROP CONSTRAINT "treasuries_currencyId_fkey";

-- DropIndex
DROP INDEX "journal_entries_createdById_idx";

-- DropIndex
DROP INDEX "purchase_receipts_idempotencyKeyId_idx";

-- DropIndex
DROP INDEX "treasuries_isActive_idx";

-- CreateIndex
CREATE INDEX "journal_entries_createdById_createdAt_idx" ON "journal_entries"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "work_orders_status_currentStage_idx" ON "work_orders"("status", "currentStage");

-- CreateIndex
CREATE INDEX "work_orders_productVariantId_status_idx" ON "work_orders"("productVariantId", "status");

-- AddForeignKey
ALTER TABLE "production_stage_runs" ADD CONSTRAINT "production_stage_runs_idempotencyKeyId_fkey" FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscalPeriodId_fkey" FOREIGN KEY ("fiscalPeriodId") REFERENCES "fiscal_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasuries" ADD CONSTRAINT "treasuries_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "accounts_parent_id_idx" RENAME TO "accounts_parentId_idx";

-- RenameIndex
ALTER INDEX "activity_log_user_id_idx" RENAME TO "activity_logs_userId_idx";

-- RenameIndex
ALTER INDEX "bom_versions_product_id_idx" RENAME TO "bom_versions_productId_idx";

-- RenameIndex
ALTER INDEX "customer_payments_customer_id_idx" RENAME TO "customer_payments_customerId_idx";

-- RenameIndex
ALTER INDEX "customer_payments_sales_order_id_idx" RENAME TO "customer_payments_salesOrderId_idx";

-- RenameIndex
ALTER INDEX "daily_production_work_order_id_idx" RENAME TO "daily_production_workOrderId_idx";

-- RenameIndex
ALTER INDEX "daily_production_worker_date_idx" RENAME TO "daily_production_workerId_date_idx";

-- RenameIndex
ALTER INDEX "daily_production_worker_id_idx" RENAME TO "daily_production_workerId_idx";

-- RenameIndex
ALTER INDEX "fiscal_periods_created_by_id_idx" RENAME TO "fiscal_periods_createdById_idx";

-- RenameIndex
ALTER INDEX "journal_entries_reversed_by_id_idx" RENAME TO "journal_entries_reversedById_idx";

-- RenameIndex
ALTER INDEX "journal_lines_credit_account_id_idx" RENAME TO "journal_lines_creditAccountId_idx";

-- RenameIndex
ALTER INDEX "journal_lines_debit_account_id_idx" RENAME TO "journal_lines_debitAccountId_idx";

-- RenameIndex
ALTER INDEX "journal_lines_journal_entry_id_idx" RENAME TO "journal_lines_journalEntryId_idx";

-- RenameIndex
ALTER INDEX "material_consumptions_raw_material_id_idx" RENAME TO "material_consumptions_rawMaterialId_idx";

-- RenameIndex
ALTER INDEX "material_consumptions_work_order_id_idx" RENAME TO "material_consumptions_workOrderId_idx";

-- RenameIndex
ALTER INDEX "payrolls_approvedBy_approvedAt_idx" RENAME TO "payrolls_approvedById_approvedAt_idx";

-- RenameIndex
ALTER INDEX "payrolls_approved_by_id_idx" RENAME TO "payrolls_approvedById_idx";

-- RenameIndex
ALTER INDEX "payrolls_createdBy_createdAt_idx" RENAME TO "payrolls_createdById_createdAt_idx";

-- RenameIndex
ALTER INDEX "payrolls_status_period_idx" RENAME TO "payrolls_status_periodStart_periodEnd_idx";

-- RenameIndex
ALTER INDEX "payrolls_worker_period_key" RENAME TO "payrolls_workerId_periodStart_periodEnd_key";

-- RenameIndex
ALTER INDEX "production_cost_snapshots_created_by_id_idx" RENAME TO "production_cost_snapshots_createdById_idx";

-- RenameIndex
ALTER INDEX "production_material_consumptions_rawMaterialId_warehouseId_crea" RENAME TO "production_material_consumptions_rawMaterialId_warehouseId__idx";

-- RenameIndex
ALTER INDEX "products_season_id_idx" RENAME TO "products_seasonId_idx";

-- RenameIndex
ALTER INDEX "purchase_order_items_purchase_order_id_idx" RENAME TO "purchase_order_items_purchaseOrderId_idx";

-- RenameIndex
ALTER INDEX "purchase_order_items_raw_material_id_idx" RENAME TO "purchase_order_items_rawMaterialId_idx";

-- RenameIndex
ALTER INDEX "purchase_orders_supplier_id_idx" RENAME TO "purchase_orders_supplierId_idx";

-- RenameIndex
ALTER INDEX "purchase_orders_user_id_idx" RENAME TO "purchase_orders_userId_idx";

-- RenameIndex
ALTER INDEX "purchase_receipts_user_id_idx" RENAME TO "purchase_receipts_userId_idx";

-- RenameIndex
ALTER INDEX "raw_material_transactions_raw_material_id_idx" RENAME TO "raw_material_transactions_rawMaterialId_idx";

-- RenameIndex
ALTER INDEX "raw_materials_supplier_id_idx" RENAME TO "raw_materials_supplierId_idx";

-- RenameIndex
ALTER INDEX "sales_order_items_product_variant_id_idx" RENAME TO "sales_order_items_productVariantId_idx";

-- RenameIndex
ALTER INDEX "sales_order_items_sales_order_id_idx" RENAME TO "sales_order_items_salesOrderId_idx";

-- RenameIndex
ALTER INDEX "sales_orders_customer_id_idx" RENAME TO "sales_orders_customerId_idx";

-- RenameIndex
ALTER INDEX "sales_orders_user_id_idx" RENAME TO "sales_orders_userId_idx";

-- RenameIndex
ALTER INDEX "sales_returns_user_id_idx" RENAME TO "sales_returns_userId_idx";

-- RenameIndex
ALTER INDEX "shipments_sales_order_id_idx" RENAME TO "shipments_salesOrderId_idx";

-- RenameIndex
ALTER INDEX "shipments_shipping_company_id_idx" RENAME TO "shipments_shippingCompanyId_idx";

-- RenameIndex
ALTER INDEX "stock_ledger_entries_created_by_id_idx" RENAME TO "stock_ledger_entries_createdById_idx";

-- RenameIndex
ALTER INDEX "supplier_payments_purchase_order_id_idx" RENAME TO "supplier_payments_purchaseOrderId_idx";

-- RenameIndex
ALTER INDEX "supplier_payments_supplier_id_idx" RENAME TO "supplier_payments_supplierId_idx";

-- RenameIndex
ALTER INDEX "vouchers_counterparty_id_idx" RENAME TO "vouchers_counterpartyId_idx";

-- RenameIndex
ALTER INDEX "vouchers_counterparty_idx" RENAME TO "vouchers_counterpartyType_counterpartyId_idx";

-- RenameIndex
ALTER INDEX "vouchers_created_by_id_idx" RENAME TO "vouchers_createdById_idx";

-- RenameIndex
ALTER INDEX "work_order_stage_transitions_actor_id_idx" RENAME TO "work_order_stage_transitions_actorId_idx";

-- RenameIndex
ALTER INDEX "work_order_stage_transitions_from_run_id_idx" RENAME TO "work_order_stage_transitions_fromRunId_idx";

-- RenameIndex
ALTER INDEX "work_order_stage_transitions_to_run_id_idx" RENAME TO "work_order_stage_transitions_toRunId_idx";

-- RenameIndex
ALTER INDEX "work_order_stages_work_order_id_idx" RENAME TO "work_order_stages_workOrderId_idx";

-- RenameIndex
ALTER INDEX "work_orders_bom_version_id_idx" RENAME TO "work_orders_bomVersionId_idx";

-- RenameIndex
ALTER INDEX "work_orders_created_by_id_idx" RENAME TO "work_orders_createdById_idx";

-- RenameIndex
ALTER INDEX "worker_advances_worker_id_idx" RENAME TO "worker_advances_workerId_idx";

