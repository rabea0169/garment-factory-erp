-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "TreasuryTransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayrollStatementStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "PurchaseReturnStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CuttingOrderStatus" AS ENUM ('DRAFT', 'ACTIVE', 'REVERSED');

-- AlterTable
ALTER TABLE "payrolls" ADD COLUMN     "payrollStatementId" TEXT;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "colorId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "b2bPrice" DECIMAL(10,2),
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "halfWholesalePrice" DECIMAL(10,2),
ADD COLUMN     "reorderLevel" DECIMAL(10,4);

-- CreateTable
CREATE TABLE "sequences" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "quotationNo" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "salesOrderId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT,
    "productVariantId" TEXT,
    "productName" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_transactions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "toTreasuryId" TEXT,
    "type" "TreasuryTransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "treasuryId" TEXT,
    "voucherId" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_sessions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedByName" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "startCash" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "expectedCash" DECIMAL(10,2),
    "endCash" DECIMAL(10,2),
    "difference" DECIMAL(10,2),
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_receipts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "treasuryId" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_statements" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "status" "PayrollStatementStatus" NOT NULL DEFAULT 'DRAFT',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "workerCount" INTEGER NOT NULL DEFAULT 0,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "restockItems" BOOLEAN NOT NULL DEFAULT true,
    "refundMethod" TEXT NOT NULL DEFAULT 'credit',
    "status" "PurchaseReturnStatus" NOT NULL DEFAULT 'POSTED',
    "notes" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "rawMaterialId" TEXT,
    "rawMaterialName" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_adjustments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_adjustment_items" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "rawMaterialId" TEXT,
    "productVariantId" TEXT,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "systemQty" DECIMAL(12,4) NOT NULL,
    "actualQty" DECIMAL(12,4) NOT NULL,
    "difference" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(10,4) NOT NULL,
    "valueDifference" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "inventory_adjustment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "size_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "size_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_orders" (
    "id" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "workerId" TEXT,
    "wagePerPiece" DECIMAL(10,2),
    "wageTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "remnantQty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "remnantNotes" TEXT,
    "totalPieces" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "totalLays" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "status" "CuttingOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cutting_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cutting_lines" (
    "id" TEXT NOT NULL,
    "cuttingOrderId" TEXT NOT NULL,
    "colorId" TEXT,
    "color" TEXT,
    "sizeGroupId" TEXT,
    "size" TEXT NOT NULL,
    "layCount" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "piecesPerLay" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(12,4) NOT NULL,
    "productVariantId" TEXT,
    "notes" TEXT,

    CONSTRAINT "cutting_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_components" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "pack_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "paperSize" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT,
    "documentNumber" TEXT,
    "templateId" TEXT,
    "templateName" TEXT,
    "channel" TEXT NOT NULL,
    "paperSize" TEXT,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "isReprint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrencePattern" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "fiscalYear" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'yearly',
    "periodIndex" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sequences_type_key" ON "sequences"("type");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quotationNo_key" ON "quotations"("quotationNo");

-- CreateIndex
CREATE INDEX "quotations_status_date_idx" ON "quotations"("status", "date");

-- CreateIndex
CREATE INDEX "quotations_customerId_idx" ON "quotations"("customerId");

-- CreateIndex
CREATE INDEX "quotations_date_idx" ON "quotations"("date");

-- CreateIndex
CREATE INDEX "quotation_items_quotationId_idx" ON "quotation_items"("quotationId");

-- CreateIndex
CREATE INDEX "quotation_items_productId_idx" ON "quotation_items"("productId");

-- CreateIndex
CREATE INDEX "quotation_items_productVariantId_idx" ON "quotation_items"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_transactions_code_key" ON "treasury_transactions"("code");

-- CreateIndex
CREATE INDEX "treasury_transactions_type_date_idx" ON "treasury_transactions"("type", "date");

-- CreateIndex
CREATE INDEX "treasury_transactions_treasuryId_date_idx" ON "treasury_transactions"("treasuryId", "date");

-- CreateIndex
CREATE INDEX "treasury_transactions_date_idx" ON "treasury_transactions"("date");

-- CreateIndex
CREATE INDEX "treasury_transactions_referenceType_referenceId_idx" ON "treasury_transactions"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE INDEX "expense_categories_isActive_idx" ON "expense_categories"("isActive");

-- CreateIndex
CREATE INDEX "expenses_categoryId_date_idx" ON "expenses"("categoryId", "date");

-- CreateIndex
CREATE INDEX "expenses_date_idx" ON "expenses"("date");

-- CreateIndex
CREATE INDEX "expenses_treasuryId_idx" ON "expenses"("treasuryId");

-- CreateIndex
CREATE UNIQUE INDEX "shift_sessions_code_key" ON "shift_sessions"("code");

-- CreateIndex
CREATE INDEX "shift_sessions_status_startTime_idx" ON "shift_sessions"("status", "startTime");

-- CreateIndex
CREATE INDEX "shift_sessions_openedById_idx" ON "shift_sessions"("openedById");

-- CreateIndex
CREATE UNIQUE INDEX "shift_sessions_openedById_status_startTime_key" ON "shift_sessions"("openedById", "status", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "worker_receipts_code_key" ON "worker_receipts"("code");

-- CreateIndex
CREATE INDEX "worker_receipts_workerId_date_idx" ON "worker_receipts"("workerId", "date");

-- CreateIndex
CREATE INDEX "worker_receipts_date_idx" ON "worker_receipts"("date");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_statements_code_key" ON "payroll_statements"("code");

-- CreateIndex
CREATE INDEX "payroll_statements_status_periodFrom_idx" ON "payroll_statements"("status", "periodFrom");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_statements_periodFrom_periodTo_key" ON "payroll_statements"("periodFrom", "periodTo");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_returnNumber_key" ON "purchase_returns"("returnNumber");

-- CreateIndex
CREATE INDEX "purchase_returns_purchaseOrderId_idx" ON "purchase_returns"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_returns_supplierId_date_idx" ON "purchase_returns"("supplierId", "date");

-- CreateIndex
CREATE INDEX "purchase_returns_date_idx" ON "purchase_returns"("date");

-- CreateIndex
CREATE INDEX "purchase_return_items_purchaseReturnId_idx" ON "purchase_return_items"("purchaseReturnId");

-- CreateIndex
CREATE INDEX "purchase_return_items_purchaseOrderItemId_idx" ON "purchase_return_items"("purchaseOrderItemId");

-- CreateIndex
CREATE INDEX "purchase_return_items_rawMaterialId_idx" ON "purchase_return_items"("rawMaterialId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_adjustments_code_key" ON "inventory_adjustments"("code");

-- CreateIndex
CREATE INDEX "inventory_adjustments_status_date_idx" ON "inventory_adjustments"("status", "date");

-- CreateIndex
CREATE INDEX "inventory_adjustments_warehouseId_date_idx" ON "inventory_adjustments"("warehouseId", "date");

-- CreateIndex
CREATE INDEX "inventory_adjustment_items_adjustmentId_idx" ON "inventory_adjustment_items"("adjustmentId");

-- CreateIndex
CREATE INDEX "inventory_adjustment_items_rawMaterialId_idx" ON "inventory_adjustment_items"("rawMaterialId");

-- CreateIndex
CREATE INDEX "inventory_adjustment_items_productVariantId_idx" ON "inventory_adjustment_items"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "colors_name_key" ON "colors"("name");

-- CreateIndex
CREATE INDEX "colors_isActive_idx" ON "colors"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "size_groups_name_key" ON "size_groups"("name");

-- CreateIndex
CREATE INDEX "size_groups_isActive_idx" ON "size_groups"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "cutting_orders_docNumber_key" ON "cutting_orders"("docNumber");

-- CreateIndex
CREATE INDEX "cutting_orders_status_date_idx" ON "cutting_orders"("status", "date");

-- CreateIndex
CREATE INDEX "cutting_orders_productId_idx" ON "cutting_orders"("productId");

-- CreateIndex
CREATE INDEX "cutting_orders_workerId_idx" ON "cutting_orders"("workerId");

-- CreateIndex
CREATE INDEX "cutting_orders_date_idx" ON "cutting_orders"("date");

-- CreateIndex
CREATE INDEX "cutting_lines_cuttingOrderId_idx" ON "cutting_lines"("cuttingOrderId");

-- CreateIndex
CREATE INDEX "cutting_lines_productVariantId_idx" ON "cutting_lines"("productVariantId");

-- CreateIndex
CREATE INDEX "cutting_lines_colorId_idx" ON "cutting_lines"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX "packs_code_key" ON "packs"("code");

-- CreateIndex
CREATE INDEX "packs_isActive_idx" ON "packs"("isActive");

-- CreateIndex
CREATE INDEX "pack_components_productVariantId_idx" ON "pack_components"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "pack_components_packId_productVariantId_key" ON "pack_components"("packId", "productVariantId");

-- CreateIndex
CREATE INDEX "print_templates_documentType_isDefault_idx" ON "print_templates"("documentType", "isDefault");

-- CreateIndex
CREATE INDEX "print_templates_paperSize_idx" ON "print_templates"("paperSize");

-- CreateIndex
CREATE UNIQUE INDEX "print_templates_name_documentType_paperSize_key" ON "print_templates"("name", "documentType", "paperSize");

-- CreateIndex
CREATE INDEX "print_logs_documentType_documentId_createdAt_idx" ON "print_logs"("documentType", "documentId", "createdAt");

-- CreateIndex
CREATE INDEX "print_logs_userId_createdAt_idx" ON "print_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "print_logs_createdAt_idx" ON "print_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "journal_templates_name_key" ON "journal_templates"("name");

-- CreateIndex
CREATE INDEX "journal_templates_isRecurring_idx" ON "journal_templates"("isRecurring");

-- CreateIndex
CREATE INDEX "budgets_accountId_fiscalYear_idx" ON "budgets"("accountId", "fiscalYear");

-- CreateIndex
CREATE INDEX "budgets_fiscalYear_idx" ON "budgets"("fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_payrollStatementId_fkey" FOREIGN KEY ("payrollStatementId") REFERENCES "payroll_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "treasuries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_toTreasuryId_fkey" FOREIGN KEY ("toTreasuryId") REFERENCES "treasuries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "treasuries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_sessions" ADD CONSTRAINT "shift_sessions_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_receipts" ADD CONSTRAINT "worker_receipts_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_receipts" ADD CONSTRAINT "worker_receipts_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "treasuries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_receipts" ADD CONSTRAINT "worker_receipts_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_receipts" ADD CONSTRAINT "worker_receipts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_statements" ADD CONSTRAINT "payroll_statements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_statements" ADD CONSTRAINT "payroll_statements_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustment_items" ADD CONSTRAINT "inventory_adjustment_items_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "inventory_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustment_items" ADD CONSTRAINT "inventory_adjustment_items_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustment_items" ADD CONSTRAINT "inventory_adjustment_items_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_orders" ADD CONSTRAINT "cutting_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_orders" ADD CONSTRAINT "cutting_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_orders" ADD CONSTRAINT "cutting_orders_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_orders" ADD CONSTRAINT "cutting_orders_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_orders" ADD CONSTRAINT "cutting_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_lines" ADD CONSTRAINT "cutting_lines_cuttingOrderId_fkey" FOREIGN KEY ("cuttingOrderId") REFERENCES "cutting_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_lines" ADD CONSTRAINT "cutting_lines_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_lines" ADD CONSTRAINT "cutting_lines_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "size_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cutting_lines" ADD CONSTRAINT "cutting_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_components" ADD CONSTRAINT "pack_components_packId_fkey" FOREIGN KEY ("packId") REFERENCES "packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_components" ADD CONSTRAINT "pack_components_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_logs" ADD CONSTRAINT "print_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_logs" ADD CONSTRAINT "print_logs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "print_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

