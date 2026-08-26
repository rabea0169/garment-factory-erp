-- GF-0022: additive sales returns. Existing sales, stock, and journal data is preserved.
CREATE TABLE "sales_returns" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "totalVat" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalCogs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKeyId" TEXT,
    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_return_items" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "vatAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cogsUnitCost" DECIMAL(10,4) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "totalCogs" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_returns_code_key" ON "sales_returns"("code");
CREATE UNIQUE INDEX "sales_returns_idempotencyKeyId_key" ON "sales_returns"("idempotencyKeyId");
CREATE INDEX "sales_returns_salesOrderId_returnedAt_idx" ON "sales_returns"("salesOrderId", "returnedAt");
CREATE UNIQUE INDEX "sales_return_items_returnId_salesOrderItemId_key" ON "sales_return_items"("returnId", "salesOrderItemId");
CREATE INDEX "sales_return_items_salesOrderItemId_idx" ON "sales_return_items"("salesOrderItemId");

ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_salesOrderId_fkey"
  FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_idempotencyKeyId_fkey"
  FOREIGN KEY ("idempotencyKeyId") REFERENCES "idempotency_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_returnId_fkey"
  FOREIGN KEY ("returnId") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_salesOrderItemId_fkey"
  FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
