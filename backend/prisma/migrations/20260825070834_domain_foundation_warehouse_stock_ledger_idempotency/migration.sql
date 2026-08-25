-- GF-0007: Domain Foundation — Warehouse + Stock Ledger + Idempotency + Indexes
--
-- الغرض: أساس مخزون قابل للتدقيق — كل تغيير على raw_materials."currentStock"
-- يمر عبر سطر واحد في stock_ledger_entries داخل نفس prisma.$transaction،
-- مع مخازن (warehouses) ومفاتيح idempotency وindexes الأداء.
--
-- الأثر على البيانات القديمة: لا تعديل على صفوف موجودة — جداول جديدة فقط
-- + قيد CHECK جديد على raw_materials."currentStock" (القيم الحالية موجبة،
-- فلا يفشل التطبيق على بيانات seed/التطوير القائمة).
--
-- ملاحظة: القيدان في نهاية الملف (CHECK) مضافان يدويًا — Prisma DSL لا يدعم
-- CHECK constraints؛ عدّل/احذفهما عبر SQL مباشرة عند الحاجة (موثق في
-- docs/DATA_AND_MIGRATIONS.md §6 مع خطة الـ rollback).

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('RAW_MATERIAL', 'FINISHED_GOODS', 'GENERAL');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIVE', 'ISSUE', 'ADJUSTMENT', 'WASTE', 'RETURN');

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL DEFAULT 'RAW_MATERIAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger_entries" (
    "id" TEXT NOT NULL,
    "entryCode" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "rawMaterialId" TEXT,
    "productVariantId" TEXT,
    "quantityDelta" DECIMAL(12,4) NOT NULL,
    "balanceAfter" DECIMAL(12,4) NOT NULL,
    "unitCost" DECIMAL(10,4),
    "totalValue" DECIMAL(14,2),
    "reference" TEXT,
    "notes" TEXT,
    "idempotencyKeyId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE INDEX "warehouses_type_isActive_idx" ON "warehouses"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "stock_ledger_entries_entryCode_key" ON "stock_ledger_entries"("entryCode");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_rawMaterialId_createdAt_idx" ON "stock_ledger_entries"("rawMaterialId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_productVariantId_createdAt_idx" ON "stock_ledger_entries"("productVariantId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_warehouseId_createdAt_idx" ON "stock_ledger_entries"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_type_createdAt_idx" ON "stock_ledger_entries"("type", "createdAt");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_createdAt_idx" ON "stock_ledger_entries"("createdAt");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_idempotencyKeyId_idx" ON "stock_ledger_entries"("idempotencyKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_scope_createdAt_idx" ON "idempotency_keys"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE INDEX "raw_materials_code_isActive_idx" ON "raw_materials"("code", "isActive");

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_idempotencyKeyId_fkey" FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- GF-0007 / ADR-0007: منع الرصيد السالب على مستوى قاعدة البيانات نفسها
-- (defense-in-depth فوق فحص الخدمة داخل transaction — أي مسار يتحايل على
-- InventoryService يُرفض من قاعدة البيانات مباشرة).
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_current_stock_nonnegative_check" CHECK ("currentStock" >= 0);

-- GF-0007: كل حركة ledger تستهدف خامة أو variant — لا كلاهما معًا ولا بدون أحدهما
-- (XOR منطقي على أعمدة الربط).
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_single_item_check" CHECK (("rawMaterialId" IS NOT NULL) <> ("productVariantId" IS NOT NULL));
