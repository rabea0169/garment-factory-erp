-- GF-0016: additive purchase receipts for partial goods receipt.
-- Existing purchase orders and items are preserved; no destructive operation.

CREATE TABLE "purchase_receipts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_receipt_items" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_receipts_code_key" ON "purchase_receipts"("code");
CREATE INDEX "purchase_receipts_purchaseOrderId_receivedAt_idx"
  ON "purchase_receipts"("purchaseOrderId", "receivedAt");
CREATE UNIQUE INDEX "purchase_receipt_items_receiptId_purchaseOrderItemId_key"
  ON "purchase_receipt_items"("receiptId", "purchaseOrderItemId");

ALTER TABLE "purchase_receipts"
  ADD CONSTRAINT "purchase_receipts_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_receipts"
  ADD CONSTRAINT "purchase_receipts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_receipt_items"
  ADD CONSTRAINT "purchase_receipt_items_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "purchase_receipts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_receipt_items"
  ADD CONSTRAINT "purchase_receipt_items_purchaseOrderItemId_fkey"
  FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
