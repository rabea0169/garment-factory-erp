-- PERF-F05 fix: Add B-tree indexes on foreign-key columns that PostgreSQL
-- does not auto-index. 46 missing FK indexes identified by the audit script.
-- These indexes speed up JOINs, WHERE clauses, and ON DELETE CASCADE lookups
-- without changing application semantics.

-- ActivityLog
CREATE INDEX IF NOT EXISTS "activity_log_user_id_idx" ON "activity_logs" ("userId");

-- Product
CREATE INDEX IF NOT EXISTS "products_season_id_idx" ON "products" ("seasonId");

-- BomVersion
CREATE INDEX IF NOT EXISTS "bom_versions_product_id_idx" ON "bom_versions" ("productId");

-- RawMaterial
CREATE INDEX IF NOT EXISTS "raw_materials_supplier_id_idx" ON "raw_materials" ("supplierId");

-- RawMaterialTransaction
CREATE INDEX IF NOT EXISTS "raw_material_transactions_raw_material_id_idx" ON "raw_material_transactions" ("rawMaterialId");

-- StockLedgerEntry
CREATE INDEX IF NOT EXISTS "stock_ledger_entries_created_by_id_idx" ON "stock_ledger_entries" ("createdById");

-- WorkOrder
CREATE INDEX IF NOT EXISTS "work_orders_created_by_id_idx" ON "work_orders" ("createdById");
CREATE INDEX IF NOT EXISTS "work_orders_bom_version_id_idx" ON "work_orders" ("bomVersionId");

-- WorkOrderStage
CREATE INDEX IF NOT EXISTS "work_order_stages_work_order_id_idx" ON "work_order_stages" ("workOrderId");

-- WorkOrderStageTransition
CREATE INDEX IF NOT EXISTS "work_order_stage_transitions_actor_id_idx" ON "work_order_stage_transitions" ("actorId");
CREATE INDEX IF NOT EXISTS "work_order_stage_transitions_from_run_id_idx" ON "work_order_stage_transitions" ("fromRunId");
CREATE INDEX IF NOT EXISTS "work_order_stage_transitions_to_run_id_idx" ON "work_order_stage_transitions" ("toRunId");

-- ProductionCostSnapshot
CREATE INDEX IF NOT EXISTS "production_cost_snapshots_created_by_id_idx" ON "production_cost_snapshots" ("createdById");

-- MaterialConsumption (legacy table)
CREATE INDEX IF NOT EXISTS "material_consumptions_raw_material_id_idx" ON "material_consumptions" ("rawMaterialId");
CREATE INDEX IF NOT EXISTS "material_consumptions_work_order_id_idx" ON "material_consumptions" ("workOrderId");

-- DailyProduction
CREATE INDEX IF NOT EXISTS "daily_production_worker_id_idx" ON "daily_production" ("workerId");
CREATE INDEX IF NOT EXISTS "daily_production_work_order_id_idx" ON "daily_production" ("workOrderId");

-- WorkerAdvance
CREATE INDEX IF NOT EXISTS "worker_advances_worker_id_idx" ON "worker_advances" ("workerId");

-- Payroll
CREATE INDEX IF NOT EXISTS "payrolls_approved_by_id_idx" ON "payrolls" ("approvedById");

-- SalesOrder
CREATE INDEX IF NOT EXISTS "sales_orders_customer_id_idx" ON "sales_orders" ("customerId");
CREATE INDEX IF NOT EXISTS "sales_orders_user_id_idx" ON "sales_orders" ("userId");

-- SalesOrderItem
CREATE INDEX IF NOT EXISTS "sales_order_items_product_variant_id_idx" ON "sales_order_items" ("productVariantId");
CREATE INDEX IF NOT EXISTS "sales_order_items_sales_order_id_idx" ON "sales_order_items" ("salesOrderId");

-- CustomerPayment
CREATE INDEX IF NOT EXISTS "customer_payments_customer_id_idx" ON "customer_payments" ("customerId");
CREATE INDEX IF NOT EXISTS "customer_payments_sales_order_id_idx" ON "customer_payments" ("salesOrderId");

-- SalesReturn
CREATE INDEX IF NOT EXISTS "sales_returns_user_id_idx" ON "sales_returns" ("userId");

-- PurchaseOrder
CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_id_idx" ON "purchase_orders" ("supplierId");
CREATE INDEX IF NOT EXISTS "purchase_orders_user_id_idx" ON "purchase_orders" ("userId");

-- PurchaseOrderItem
CREATE INDEX IF NOT EXISTS "purchase_order_items_raw_material_id_idx" ON "purchase_order_items" ("rawMaterialId");
CREATE INDEX IF NOT EXISTS "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items" ("purchaseOrderId");

-- PurchaseReceipt
CREATE INDEX IF NOT EXISTS "purchase_receipts_user_id_idx" ON "purchase_receipts" ("userId");

-- SupplierPayment
CREATE INDEX IF NOT EXISTS "supplier_payments_supplier_id_idx" ON "supplier_payments" ("supplierId");
CREATE INDEX IF NOT EXISTS "supplier_payments_purchase_order_id_idx" ON "supplier_payments" ("purchaseOrderId");

-- Shipment
CREATE INDEX IF NOT EXISTS "shipments_delivered_by_id_idx" ON "shipments" ("deliveredById");
CREATE INDEX IF NOT EXISTS "shipments_sales_order_id_idx" ON "shipments" ("salesOrderId");
CREATE INDEX IF NOT EXISTS "shipments_shipping_company_id_idx" ON "shipments" ("shippingCompanyId");

-- FiscalPeriod
CREATE INDEX IF NOT EXISTS "fiscal_periods_created_by_id_idx" ON "fiscal_periods" ("createdById");

-- Account
CREATE INDEX IF NOT EXISTS "accounts_parent_id_idx" ON "accounts" ("parentId");

-- JournalEntry
CREATE INDEX IF NOT EXISTS "journal_entries_reversed_by_id_idx" ON "journal_entries" ("reversedById");

-- JournalLine
CREATE INDEX IF NOT EXISTS "journal_lines_journal_entry_id_idx" ON "journal_lines" ("journalEntryId");
CREATE INDEX IF NOT EXISTS "journal_lines_credit_account_id_idx" ON "journal_lines" ("creditAccountId");
CREATE INDEX IF NOT EXISTS "journal_lines_debit_account_id_idx" ON "journal_lines" ("debitAccountId");

-- Voucher
CREATE INDEX IF NOT EXISTS "vouchers_treasury_id_idx" ON "vouchers" ("treasuryId");
CREATE INDEX IF NOT EXISTS "vouchers_journal_entry_id_idx" ON "vouchers" ("journalEntryId");
CREATE INDEX IF NOT EXISTS "vouchers_created_by_id_idx" ON "vouchers" ("createdById");
CREATE INDEX IF NOT EXISTS "vouchers_counterparty_id_idx" ON "vouchers" ("counterpartyId");
