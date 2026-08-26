import 'dotenv/config';
import {
  PrismaClient,
  UserRole,
  RawMaterialUnit,
  WorkerSpecialty,
  WarehouseType,
  StockMovementType,
  AccountType,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import {
  CHART_OF_ACCOUNTS,
  CURRENCIES,
} from '../src/core/financial/chart-of-accounts';

/**
 * GF-0006: قراءة متغير بيئة إلزامي مع فشل فوري (fail-closed).
 * دالة تُرجع string بدل التضييق عبر process.exit — تضمن صحة الأنواع
 * في كل إصدارات TypeScript (لا تعتمد على control-flow analysis للـ never).
 */
function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} مفقود — ${hint}`);
    process.exit(1);
  }
  return value;
}

// GF-0002 / P0-03: الاتصال من البيئة فقط — لا connection string مكتوب في الكود
const connectionString = requireEnv(
  'DATABASE_URL',
  'انسخ backend/.env.example إلى backend/.env واضبط قيمة الاتصال.',
);
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// GF-0006 / P1-02: كلمة مرور admin الأولية من البيئة — لا قيمة منشورة في الكود أو README
const seedAdminPassword = requireEnv(
  'SEED_ADMIN_PASSWORD',
  'حدد كلمة مرور أولية للتطوير في backend/.env (مثال في backend/.env.example). لا قيمة افتراضية لأسباب أمنية.',
);

async function main() {
  console.log('Seeding database...');

  // 0. Create Warehouses (GF-0007) — كل حركة مخزون تلزم بتحديد مخزن
  const whRaw = await prisma.warehouse.upsert({
    where: { code: 'WH-RAW' },
    update: {},
    create: {
      code: 'WH-RAW',
      name: 'مخزن الخامات الرئيسي',
      type: WarehouseType.RAW_MATERIAL,
    },
  });
  const whFg = await prisma.warehouse.upsert({
    where: { code: 'WH-FG' },
    update: {},
    create: {
      code: 'WH-FG',
      name: 'مخزن المنتج التام',
      type: WarehouseType.FINISHED_GOODS,
    },
  });
  console.log('Warehouses seeded:', whRaw.code, whFg.code);

  // 1. Create Admin User
  const hashedPassword = await bcrypt.hash(seedAdminPassword, 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@factory.com' },
    update: {},
    create: {
      email: 'admin@factory.com',
      name: 'المدير العام',
      password: hashedPassword,
      phone: '01000000000',
      role: UserRole.SUPER_ADMIN,
    },
  });
  console.log('Admin created:', admin.email);

  // 2. Create Raw Materials — الرصيد الافتتاحي مبرر بحركة ledger داخل
  //    $transaction واحدة (GF-0007): currentStock == SUM(quantityDelta) من اليوم الأول
  const rm1 = await prisma.rawMaterial.create({
    data: {
      code: 'RM-001',
      name: 'قماش قطني أبيض 100%',
      unit: RawMaterialUnit.METER,
      currentStock: 150,
      minStockLevel: 50,
      costPerUnit: 45.5,
    },
  });

  const rm2 = await prisma.rawMaterial.create({
    data: {
      code: 'RM-002',
      name: 'خيط بوليستر أسود',
      unit: RawMaterialUnit.ROLL,
      currentStock: 12,
      minStockLevel: 20, // Low stock
      costPerUnit: 15.0,
    },
  });
  await prisma.$transaction([
    prisma.stockLedgerEntry.create({
      data: {
        entryCode: 'SLE-SEED-OPENING-001',
        type: StockMovementType.RECEIVE,
        warehouseId: whRaw.id,
        rawMaterialId: rm1.id,
        quantityDelta: 150,
        balanceAfter: 150,
        unitCost: 45.5,
        totalValue: 6825,
        reference: 'رصيد افتتاحي (seed)',
      },
    }),
    prisma.stockLedgerEntry.create({
      data: {
        entryCode: 'SLE-SEED-OPENING-002',
        type: StockMovementType.RECEIVE,
        warehouseId: whRaw.id,
        rawMaterialId: rm2.id,
        quantityDelta: 12,
        balanceAfter: 12,
        unitCost: 15.0,
        totalValue: 180,
        reference: 'رصيد افتتاحي (seed)',
      },
    }),
  ]);
  console.log('Raw Materials seeded (ledger-backed)');

  // 3. Create Season & Product
  const season = await prisma.season.create({
    data: { name: 'صيف 2026' },
  });

  const product = await prisma.product.create({
    data: {
      code: 'PRD-T01',
      name: 'تيشيرت صيفي بولو',
      category: 'تيشيرت',
      retailPrice: 250,
      wholesalePrice: 180,
      seasonId: season.id,
    },
  });

  // Product Variants
  const variantM = await prisma.productVariant.create({
    data: { productId: product.id, size: 'M', color: 'أبيض' },
  });
  const variantL = await prisma.productVariant.create({
    data: { productId: product.id, size: 'L', color: 'أبيض' },
  });

  // BOM (Bill of Materials) Versioning (GF-0008)
  const bomVersion = await prisma.bomVersion.create({
    data: {
      productId: product.id,
      versionName: 'الإصدار الأساسي 1.0',
    },
  });

  await prisma.bomLine.create({
    data: {
      bomVersionId: bomVersion.id,
      rawMaterialId: rm1.id,
      quantity: 1.2,
      unit: 'متر',
    },
  });
  await prisma.bomLine.create({
    data: {
      bomVersionId: bomVersion.id,
      rawMaterialId: rm2.id,
      quantity: 0.1,
      unit: 'بكرة',
    },
  });
  console.log('Products & BOM Versions seeded');

  // 4. Create Finished Goods Inventory (Legacy)
  // GF-0007: مخزون التام لم يُدمج بعد في ledger (يُدمج بالكامل عند دمج العمليات)
  await prisma.finishedGood.create({
    data: { productVariantId: variantM.id, quantity: 50 },
  });
  await prisma.finishedGood.create({
    data: { productVariantId: variantL.id, quantity: 30 },
  });

  // GF-AUDIT-001A: seed the authoritative per-warehouse balance and its opening ledger.
  // The upsert update is intentionally empty so rerunning seed never overwrites live stock.
  for (const [variantId, quantity, suffix] of [
    [variantM.id, 50, 'M'],
    [variantL.id, 30, 'L'],
  ] as const) {
    const stock = await prisma.finishedGoodStock.upsert({
      where: {
        warehouseId_productVariantId: {
          warehouseId: whFg.id,
          productVariantId: variantId,
        },
      },
      update: {},
      create: {
        warehouseId: whFg.id,
        productVariantId: variantId,
        quantity,
        unitCost: 0,
      },
    });
    const openingReference = `SEED-OPENING-FG-${suffix}`;
    const opening = await prisma.stockLedgerEntry.findFirst({
      where: { reference: openingReference },
      select: { id: true },
    });
    if (!opening) {
      await prisma.stockLedgerEntry.create({
        data: {
          entryCode: `SEED-FG-${suffix}`,
          type: StockMovementType.RECEIVE,
          warehouseId: whFg.id,
          productVariantId: variantId,
          quantityDelta: quantity,
          balanceAfter: stock.quantity,
          unitCost: 0,
          totalValue: 0,
          reference: openingReference,
          notes:
            'رصيد افتتاحي للمنتج التام — يحتاج اعتماد تكلفة افتتاحية من المحاسبة',
          createdById: admin.id,
        },
      });
    }
  }
  console.log('Finished Goods seeded in authoritative stock ledger');

  // 4.5. Create Sample Work Order (GF-0008)
  await prisma.workOrder.create({
    data: {
      code: 'WO-SEED-001',
      productVariantId: variantM.id,
      bomVersionId: bomVersion.id,
      quantity: 100,
      status: 'PLANNED',
      createdById: admin.id,
    },
  });
  console.log('Work Order seeded');

  // 5. Workers
  await prisma.worker.create({
    data: {
      code: 'WK-001',
      name: 'أحمد محمود',
      specialty: WorkerSpecialty.SEWING,
      pieceRate: 5.5,
    },
  });
  await prisma.worker.create({
    data: {
      code: 'WK-002',
      name: 'سيد علي',
      specialty: WorkerSpecialty.CUTTING,
      pieceRate: 3.0,
    },
  });
  console.log('Workers seeded');

  // 6. Chart of Accounts (A1/A2/A3 — audit v2 foundation).
  // معرفات ثابتة (UUIDs من src/core/financial/chart-of-accounts.ts) يستوردها
  // FinancialPostingService دون بحث — تُنشأ هنا كـ upsert لضمان وجودها على
  // كل قاعدة بيانات جديدة بعد prisma migrate deploy + db seed.
  //
  // Wave2: تمت إضافة الحسابات التفصيلية للمخزون (WIP, FINISHED_GOOD_STOCK,
  // WORKER_ADVANCES) والأجور المستحقة (SALARIES_PAYABLE) وإيراد/مصروف تسوية
  // المخزون (INVENTORY_ADJUSTMENT_INCOME, WASTE_EXPENSE,
  // INVENTORY_ADJUSTMENT_EXPENSE) ومصروفات الأجور والشحن (SALARIES_EXPENSE,
  // SHIPPING_EXPENSE) لتغطية قيود GL من subagents B و C.
  const chartAccounts = [
    {
      id: CHART_OF_ACCOUNTS.CASH,
      code: '1100-01',
      name: 'النقدية بالصندوق',
      type: AccountType.ASSET,
    },
    {
      id: CHART_OF_ACCOUNTS.BANK,
      code: '1100-02',
      name: 'النقدية بالبنك',
      type: AccountType.ASSET,
    },
    {
      id: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
      code: '1200',
      name: 'العملاء (ذمم مدينة)',
      type: AccountType.ASSET,
    },
    {
      id: CHART_OF_ACCOUNTS.INVENTORY,
      code: '1300',
      name: 'المخزون',
      type: AccountType.ASSET,
    },
    {
      id: CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK,
      code: '1310',
      name: 'مخزون البضاعة التامة (Finished Goods)',
      type: AccountType.ASSET,
    },
    {
      id: CHART_OF_ACCOUNTS.WIP,
      code: '1320',
      name: 'إنتاج تحت التشغيل (Work in Progress)',
      type: AccountType.ASSET,
    },
    {
      id: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
      code: '1330',
      name: 'سلف العمال (Worker Advances)',
      type: AccountType.ASSET,
    },
    {
      id: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
      code: '2200',
      name: 'الموردون (ذمم دائنة)',
      type: AccountType.LIABILITY,
    },
    {
      id: CHART_OF_ACCOUNTS.VAT_PAYABLE,
      code: '2300',
      name: 'ضريبة القيمة المضافة المستحقة',
      type: AccountType.LIABILITY,
    },
    {
      id: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
      code: '2400',
      name: 'الأجور المستحقة (Salaries Payable)',
      type: AccountType.LIABILITY,
    },
    {
      id: CHART_OF_ACCOUNTS.OWNERS_EQUITY,
      code: '3000',
      name: 'حقوق الملكية',
      type: AccountType.EQUITY,
    },
    {
      id: CHART_OF_ACCOUNTS.SALES_REVENUE,
      code: '4100',
      name: 'إيرادات المبيعات',
      type: AccountType.REVENUE,
    },
    {
      id: CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_INCOME,
      code: '4200',
      name: 'إيراد تسوية المخزون (Inventory Adjustment Income)',
      type: AccountType.REVENUE,
    },
    {
      id: CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
      code: '5100',
      name: 'تكلفة البضاعة المباعة',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
      code: '5000',
      name: 'مصروف عام',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.WASTE_EXPENSE,
      code: '5300',
      name: 'مصروف الهدر (Waste Expense)',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_EXPENSE,
      code: '5400',
      name: 'مصروف تسوية المخزون (Inventory Adjustment Expense)',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.SALARIES_EXPENSE,
      code: '5500',
      name: 'مصروف الأجور (Salaries Expense)',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.SHIPPING_EXPENSE,
      code: '5600',
      name: 'مصروف الشحن (Shipping Expense)',
      type: AccountType.EXPENSE,
    },
  ];
  for (const acc of chartAccounts) {
    await prisma.account.upsert({
      where: { id: acc.id },
      update: {},
      create: {
        id: acc.id,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        isActive: true,
      },
    });
  }
  console.log(`Chart of Accounts seeded (${chartAccounts.length} accounts)`);

  // E5: Multi-currency seed — EGP (system default) + USD (reference).
  // The migration 20260828060000 also inserts these rows, but seed.ts
  // upserts to ensure they exist even on a database where migrations
  // were applied out of order or where rows were manually deleted.
  const currencies = [
    {
      id: CURRENCIES.EGP,
      code: 'EGP',
      name: 'Egyptian Pound',
      symbol: 'E£',
      decimalPlaces: 2,
    },
    {
      id: CURRENCIES.USD,
      code: 'USD',
      name: 'US Dollar',
      symbol: '$',
      decimalPlaces: 2,
    },
  ];
  for (const cur of currencies) {
    await prisma.currency.upsert({
      where: { code: cur.code },
      update: {
        name: cur.name,
        symbol: cur.symbol,
        decimalPlaces: cur.decimalPlaces,
      },
      create: cur,
    });
  }
  console.log(`Currencies seeded (${currencies.length} currencies)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
