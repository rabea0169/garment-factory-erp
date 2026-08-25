-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'SHIPPED', 'CANCELLED');

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT';
