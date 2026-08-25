/*
  Warnings:

  - You are about to drop the column `productId` on the `work_orders` table. All the data in the column will be lost.
  - You are about to drop the `bom_items` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `bomVersionId` to the `work_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `productVariantId` to the `work_orders` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "bom_items" DROP CONSTRAINT "bom_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "bom_items" DROP CONSTRAINT "bom_items_rawMaterialId_fkey";

-- DropForeignKey
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_productId_fkey";

-- AlterTable
ALTER TABLE "work_orders" DROP COLUMN "productId",
ADD COLUMN     "bomVersionId" TEXT NOT NULL,
ADD COLUMN     "productVariantId" TEXT NOT NULL,
ADD COLUMN     "wasteQty" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "bom_items";

-- CreateTable
CREATE TABLE "bom_versions" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "versionName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bom_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_lines" (
    "id" TEXT NOT NULL,
    "bomVersionId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bom_lines_bomVersionId_rawMaterialId_key" ON "bom_lines"("bomVersionId", "rawMaterialId");

-- AddForeignKey
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "bom_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "bom_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
