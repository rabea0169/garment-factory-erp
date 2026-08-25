-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING', 'RECEIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT';
