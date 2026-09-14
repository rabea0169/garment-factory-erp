-- SELIM-ERP W4: فروع الشركة (SPRINT 89/93/94) + صلاحيات المستخدم التفصيلية.
-- نقل CompanyBranch و UserPermission من Selim ERP بمعمارية أحادية المستأجر:
-- لا companyId، والصلاحيات عمود JSON واحد على users بدل جدول منفصل.

-- CreateTable: فروع الشركة
CREATE TABLE "company_branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "manager" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_branches_isActive_idx" ON "company_branches"("isActive");

-- AlterTable: صلاحيات تفصيلية على المستخدم (null = افتراضيات الدور)
ALTER TABLE "users" ADD COLUMN "permissions" JSONB;

-- AlterTable: ربط الفروع بالمستندات التشغيلية (SPRINT 93) والأصناف (SPRINT 94)
ALTER TABLE "sales_orders" ADD COLUMN "branchId" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "branchId" TEXT;
ALTER TABLE "products" ADD COLUMN "branchId" TEXT;

-- CreateIndex
CREATE INDEX "sales_orders_branchId_idx" ON "sales_orders"("branchId");
CREATE INDEX "purchase_orders_branchId_idx" ON "purchase_orders"("branchId");
CREATE INDEX "products_branchId_idx" ON "products"("branchId");

-- AddForeignKey (SetNull: حذف الفرع لا يمس المستندات — تفويض null)
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "company_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "company_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "company_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
