-- GF-0013: production workflow, stage output, material consumption and cost snapshots.
-- This migration is additive. It intentionally preserves legacy production tables.

CREATE TYPE "ProductionStage" AS ENUM ('CUTTING', 'SEWING', 'IRONING', 'PACKING');

CREATE TYPE "ProductionStageRunStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TYPE "ProductionWasteReason" AS ENUM (
  'CUTTING_LOSS',
  'SEWING_DEFECT',
  'IRONING_LOSS',
  'PACKAGING_DAMAGE',
  'MATERIAL_DEFECT',
  'OTHER'
);

CREATE TYPE "ProductionCostStatus" AS ENUM ('ESTIMATED', 'FINALIZED');

ALTER TABLE "work_orders"
  ADD COLUMN "currentStage" "ProductionStage",
  ADD COLUMN "stageVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_stage_version_positive_check"
  CHECK ("stageVersion" >= 1);

CREATE TABLE "finished_good_stocks" (
  "id" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "productVariantId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finished_good_stocks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "finished_good_stocks"
  ADD CONSTRAINT "finished_good_stocks_quantity_nonnegative_check"
  CHECK ("quantity" >= 0);

CREATE UNIQUE INDEX "finished_good_stocks_warehouseId_productVariantId_key"
  ON "finished_good_stocks"("warehouseId", "productVariantId");
CREATE INDEX "finished_good_stocks_productVariantId_quantity_idx"
  ON "finished_good_stocks"("productVariantId", "quantity");
CREATE INDEX "finished_good_stocks_warehouseId_quantity_idx"
  ON "finished_good_stocks"("warehouseId", "quantity");

CREATE TABLE "production_stage_runs" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "stage" "ProductionStage" NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" "ProductionStageRunStatus" NOT NULL DEFAULT 'PENDING',
  "plannedQty" INTEGER NOT NULL DEFAULT 0,
  "inputQty" INTEGER NOT NULL DEFAULT 0,
  "acceptedQty" INTEGER NOT NULL DEFAULT 0,
  "rejectedQty" INTEGER NOT NULL DEFAULT 0,
  "wasteQty" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_stage_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "production_stage_runs"
  ADD CONSTRAINT "production_stage_runs_quantities_nonnegative_check"
  CHECK (
    "plannedQty" >= 0 AND
    "inputQty" >= 0 AND
    "acceptedQty" >= 0 AND
    "rejectedQty" >= 0 AND
    "wasteQty" >= 0
  ),
  ADD CONSTRAINT "production_stage_runs_quantity_conservation_check"
  CHECK (
    "status" <> 'COMPLETED' OR
    "inputQty" = "acceptedQty" + "rejectedQty" + "wasteQty"
  );

CREATE UNIQUE INDEX "production_stage_runs_workOrderId_stage_key"
  ON "production_stage_runs"("workOrderId", "stage");
CREATE UNIQUE INDEX "production_stage_runs_workOrderId_sequence_key"
  ON "production_stage_runs"("workOrderId", "sequence");
CREATE INDEX "production_stage_runs_workOrderId_status_idx"
  ON "production_stage_runs"("workOrderId", "status");

CREATE TABLE "work_order_stage_transitions" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "fromStage" "ProductionStage",
  "toStage" "ProductionStage" NOT NULL,
  "fromStatus" "WorkOrderStatus",
  "toStatus" "WorkOrderStatus",
  "actorId" TEXT NOT NULL,
  "reason" TEXT,
  "idempotencyKeyId" TEXT,
  "fromRunId" TEXT,
  "toRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_stage_transitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_order_stage_transitions_idempotencyKeyId_key"
  ON "work_order_stage_transitions"("idempotencyKeyId");
CREATE INDEX "work_order_stage_transitions_workOrderId_createdAt_idx"
  ON "work_order_stage_transitions"("workOrderId", "createdAt");
CREATE INDEX "work_order_stage_transitions_workOrderId_toStage_idx"
  ON "work_order_stage_transitions"("workOrderId", "toStage");

CREATE TABLE "production_material_consumptions" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "stageRunId" TEXT NOT NULL,
  "rawMaterialId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "stockLedgerEntryId" TEXT,
  "idempotencyKeyId" TEXT,
  "plannedQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "actualQuantity" DECIMAL(12,4) NOT NULL,
  "variance" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "wasteQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL,
  "unitCost" DECIMAL(12,4) NOT NULL,
  "totalCost" DECIMAL(14,2) NOT NULL,
  "wasteCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "wasteReason" "ProductionWasteReason",
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_material_consumptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "production_material_consumptions"
  ADD CONSTRAINT "production_material_consumptions_quantities_nonnegative_check"
  CHECK (
    "plannedQuantity" >= 0 AND
    "actualQuantity" >= 0 AND
    "wasteQuantity" >= 0 AND
    "wasteQuantity" <= "actualQuantity"
  ),
  ADD CONSTRAINT "production_material_consumptions_costs_nonnegative_check"
  CHECK ("unitCost" >= 0 AND "totalCost" >= 0 AND "wasteCost" >= 0);

CREATE UNIQUE INDEX "production_material_consumptions_stockLedgerEntryId_key"
  ON "production_material_consumptions"("stockLedgerEntryId");
CREATE UNIQUE INDEX "production_material_consumptions_idempotencyKeyId_key"
  ON "production_material_consumptions"("idempotencyKeyId");
CREATE INDEX "production_material_consumptions_workOrderId_stageRunId_idx"
  ON "production_material_consumptions"("workOrderId", "stageRunId");
CREATE INDEX "production_material_consumptions_rawMaterialId_warehouseId_createdAt_idx"
  ON "production_material_consumptions"("rawMaterialId", "warehouseId", "createdAt");
CREATE INDEX "production_material_consumptions_createdById_createdAt_idx"
  ON "production_material_consumptions"("createdById", "createdAt");

CREATE TABLE "production_cost_snapshots" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "status" "ProductionCostStatus" NOT NULL DEFAULT 'ESTIMATED',
  "materialCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "laborCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "overheadCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "wasteCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalCost" DECIMAL(14,2) NOT NULL,
  "acceptedQty" INTEGER NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(14,4),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "production_cost_snapshots_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "production_cost_snapshots"
  ADD CONSTRAINT "production_cost_snapshots_costs_nonnegative_check"
  CHECK (
    "materialCost" >= 0 AND
    "laborCost" >= 0 AND
    "overheadCost" >= 0 AND
    "wasteCost" >= 0 AND
    "totalCost" >= 0 AND
    "acceptedQty" >= 0 AND
    ("unitCost" IS NULL OR "unitCost" >= 0)
  );

CREATE UNIQUE INDEX "production_cost_snapshots_workOrderId_status_key"
  ON "production_cost_snapshots"("workOrderId", "status");
CREATE INDEX "production_cost_snapshots_workOrderId_capturedAt_idx"
  ON "production_cost_snapshots"("workOrderId", "capturedAt");

ALTER TABLE "finished_good_stocks"
  ADD CONSTRAINT "finished_good_stocks_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "finished_good_stocks_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "production_stage_runs"
  ADD CONSTRAINT "production_stage_runs_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_order_stage_transitions"
  ADD CONSTRAINT "work_order_stage_transitions_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "work_order_stage_transitions_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "work_order_stage_transitions_idempotencyKeyId_fkey"
  FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "work_order_stage_transitions_fromRunId_fkey"
  FOREIGN KEY ("fromRunId") REFERENCES "production_stage_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "work_order_stage_transitions_toRunId_fkey"
  FOREIGN KEY ("toRunId") REFERENCES "production_stage_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "production_material_consumptions"
  ADD CONSTRAINT "production_material_consumptions_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "production_material_consumptions_stageRunId_fkey"
  FOREIGN KEY ("stageRunId") REFERENCES "production_stage_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "production_material_consumptions_rawMaterialId_fkey"
  FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "production_material_consumptions_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "production_material_consumptions_stockLedgerEntryId_fkey"
  FOREIGN KEY ("stockLedgerEntryId") REFERENCES "stock_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "production_material_consumptions_idempotencyKeyId_fkey"
  FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "production_material_consumptions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "production_cost_snapshots"
  ADD CONSTRAINT "production_cost_snapshots_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "production_cost_snapshots_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
