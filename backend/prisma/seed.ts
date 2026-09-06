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
  // INF-7 (GF-IMP-W3): البذرة قابلة للتكرار بالكامل (idempotent) — كل
  // الإنشاءات upsert/guarded بمفاتيحها الفريدة، فإعادة تشغيلها على قاعدة
  // مزروعة تنجح بلا P2002 ولا تلمس أي قيمة حية عدّلها التشغيل. هذا متطلب
  // مسار التعافي في docs/runbooks/BACKUP_RESTORE.md (migrate deploy ثم
  // re-seed على قاعدة نظيفة).

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
  // INF-7 (GF-IMP-W3): upsert بمفتاح code الفريدة (نمط المخازن/المدير
  //    القائم في هذا الملف) بدل الإنشاء المباشر — الإنشاء المباشر كان يفشل
  //    بـ P2002 عند إعادة تشغيل البذرة، وrunbook النسخ الاحتياطي
  //    (BACKUP_RESTORE) يتطلب re-seed قابلًا للتكرار على قاعدة نظيفة
  //    بعد migrate deploy. التحديث فارغ عمدًا: إعادة البذرة لا تلمس
  //    الرصيد/التكلفة الحية للخامة — نفس مبدأ المخازن أعلاه.
  const rm1 = await prisma.rawMaterial.upsert({
    where: { code: 'RM-001' },
    update: {},
    create: {
      code: 'RM-001',
      name: 'قماش قطني أبيض 100%',
      unit: RawMaterialUnit.METER,
      currentStock: 150,
      minStockLevel: 50,
      costPerUnit: 45.5,
    },
  });

  const rm2 = await prisma.rawMaterial.upsert({
    where: { code: 'RM-002' },
    update: {},
    create: {
      code: 'RM-002',
      name: 'خيط بوليستر أسود',
      unit: RawMaterialUnit.ROLL,
      currentStock: 12,
      minStockLevel: 20, // Low stock
      costPerUnit: 15.0,
    },
  });
  // INF-7: حركة الافتتاح guarded بمفتاح entryCode الفريد — تُنشأ مرة واحدة
  // فقط (نمط SEED-OPENING-FG أدناه)؛ غيابها على قاعدة قائمة يُعد إصلاح
  // بذرة لا مضاعفة (entryCode فريد يمنع التكرار أصلًا).
  await prisma.$transaction([
    ...((await prisma.stockLedgerEntry.findFirst({
      where: { entryCode: 'SLE-SEED-OPENING-001' },
      select: { id: true },
    }))
      ? []
      : [
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
        ]),
    ...((await prisma.stockLedgerEntry.findFirst({
      where: { entryCode: 'SLE-SEED-OPENING-002' },
      select: { id: true },
    }))
      ? []
      : [
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
        ]),
  ]);
  console.log('Raw Materials seeded (ledger-backed, idempotent)');

  // 3. Create Season & Product
  // INF-7: كل الإنشاءات هنا idempotent — الموسم وإصدار BOM لا يملكان
  // مفتاحًا فريدًا طبيعيًا في المخطط (name/versionName ليسا @unique) فيُحرسان
  // بـ findFirst ثم create؛ المنتج upsert بمفتاح code، والمتغيرات upsert
  // بالمركب الفريد (productId, size, color)، وبنود BOM upsert بالمركب
  // الفريد (bomVersionId, rawMaterialId). التحديثات فارغة عمدًا كي لا تلمس
  // إعادة البذرة الأسعار/الكميات التي عدّلها التشغيل.
  const season =
    (await prisma.season.findFirst({
      where: { name: 'صيف 2026' },
      select: { id: true },
    })) ??
    (await prisma.season.create({
      data: { name: 'صيف 2026' },
      select: { id: true },
    }));

  const product = await prisma.product.upsert({
    where: { code: 'PRD-T01' },
    update: {},
    create: {
      code: 'PRD-T01',
      name: 'تيشيرت صيفي بولو',
      category: 'تيشيرت',
      retailPrice: 250,
      wholesalePrice: 180,
      seasonId: season.id,
    },
  });

  // Product Variants
  const variantM = await prisma.productVariant.upsert({
    where: {
      productId_size_color: {
        productId: product.id,
        size: 'M',
        color: 'أبيض',
      },
    },
    update: {},
    create: { productId: product.id, size: 'M', color: 'أبيض' },
  });
  const variantL = await prisma.productVariant.upsert({
    where: {
      productId_size_color: {
        productId: product.id,
        size: 'L',
        color: 'أبيض',
      },
    },
    update: {},
    create: { productId: product.id, size: 'L', color: 'أبيض' },
  });

  // BOM (Bill of Materials) Versioning (GF-0008)
  const bomVersion =
    (await prisma.bomVersion.findFirst({
      where: { productId: product.id, versionName: 'الإصدار الأساسي 1.0' },
      select: { id: true },
    })) ??
    (await prisma.bomVersion.create({
      data: {
        productId: product.id,
        versionName: 'الإصدار الأساسي 1.0',
      },
      select: { id: true },
    }));

  await prisma.bomLine.upsert({
    where: {
      bomVersionId_rawMaterialId: {
        bomVersionId: bomVersion.id,
        rawMaterialId: rm1.id,
      },
    },
    update: {},
    create: {
      bomVersionId: bomVersion.id,
      rawMaterialId: rm1.id,
      quantity: 1.2,
      unit: 'متر',
    },
  });
  await prisma.bomLine.upsert({
    where: {
      bomVersionId_rawMaterialId: {
        bomVersionId: bomVersion.id,
        rawMaterialId: rm2.id,
      },
    },
    update: {},
    create: {
      bomVersionId: bomVersion.id,
      rawMaterialId: rm2.id,
      quantity: 0.1,
      unit: 'بكرة',
    },
  });
  console.log('Products & BOM Versions seeded (idempotent)');

  // 4. Create Finished Goods Inventory (Legacy)
  // GF-0007: مخزون التام لم يُدمج بعد في ledger (يُدمج بالكامل عند دمج العمليات)
  // INF-7: upsert بمفتاح productVariantId الفريد — إعادة البذرة لا تفشل
  // ولا تلمس الكميات الحية.
  await prisma.finishedGood.upsert({
    where: { productVariantId: variantM.id },
    update: {},
    create: { productVariantId: variantM.id, quantity: 50 },
  });
  await prisma.finishedGood.upsert({
    where: { productVariantId: variantL.id },
    update: {},
    create: { productVariantId: variantL.id, quantity: 30 },
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
  // INF-7: upsert بمفتاح code — لا نلمس حالة/كمية أمر قائم (قد يكون
  // بدأ الإنتاج فعلًا)؛ نضمن فقط وجود أمر العينة على قاعدة جديدة.
  await prisma.workOrder.upsert({
    where: { code: 'WO-SEED-001' },
    update: {},
    create: {
      code: 'WO-SEED-001',
      productVariantId: variantM.id,
      bomVersionId: bomVersion.id,
      quantity: 100,
      status: 'PLANNED',
      createdById: admin.id,
    },
  });
  console.log('Work Order seeded (idempotent)');

  // 5. Workers
  // INF-7: upsert بمفتاح code الفريد — إعادة البذرة لا تفشل ولا تمس
  // سعر القطعة/حالة العامل الحية.
  await prisma.worker.upsert({
    where: { code: 'WK-001' },
    update: {},
    create: {
      code: 'WK-001',
      name: 'أحمد محمود',
      specialty: WorkerSpecialty.SEWING,
      pieceRate: 5.5,
    },
  });
  await prisma.worker.upsert({
    where: { code: 'WK-002' },
    update: {},
    create: {
      code: 'WK-002',
      name: 'سيد علي',
      specialty: WorkerSpecialty.CUTTING,
      pieceRate: 3.0,
    },
  });
  console.log('Workers seeded (idempotent)');

  // 6. Chart of Accounts (A1/A2/A3 — audit v2 foundation).
  // معرفات ثابتة (UUIDs من src/core/financial/chart-of-accounts.ts) يستوردها
  // FinancialPostingService دون بحث — تُنشأ هنا كـ upsert لضمان وجودها على
  // كل قاعدة بيانات جديدة بعد prisma migrate deploy + db seed.
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
      name: 'مخزون المنتج التام',
      type: AccountType.ASSET,
    },
    {
      id: CHART_OF_ACCOUNTS.WIP,
      code: '1320',
      name: 'مخزون تحت التشغيل',
      type: AccountType.ASSET,
    },
    {
      id: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
      code: '1330',
      name: 'سلف العمال',
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
      name: 'رواتب مستحقة',
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
      name: 'إيرادات تسوية المخزون',
      type: AccountType.REVENUE,
    },
    {
      id: CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
      code: '5100',
      name: 'تكلفة البضاعة المباعة',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.SALARIES_EXPENSE,
      code: '5200',
      name: 'مصروف الرواتب',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.WASTE_EXPENSE,
      code: '5300',
      name: 'مصروف الهدر',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_EXPENSE,
      code: '5400',
      name: 'مصروف تسوية المخزون',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.SHIPPING_EXPENSE,
      code: '5600',
      name: 'مصروف الشحن',
      type: AccountType.EXPENSE,
    },
    {
      id: CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
      code: '5000',
      name: 'مصروف عام',
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

  // GF-IMP-W2 / ACC-3: فترة مالية مفتوحة شاملة السنة الجارية — بدونها يرفض
  // محرك الترحيل كل القيود الآلية بـ 400 (لا يمكن الترحيل خارج فترة مفتوحة).
  // upsert على الثنائية (startDate,endDate) — إعادة البذر لا تغلق فترة مفتوحة
  // قائمة ولا تنشئ نسخة ثانية لنفس النطاق.
  const year = new Date().getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  await prisma.fiscalPeriod.upsert({
    where: { startDate_endDate: { startDate: yearStart, endDate: yearEnd } },
    update: {}, // لا نلمس الفترة القائمة — إقفالها قرار محاسبي يدوي
    create: {
      name: `السنة المالية ${year}`,
      startDate: yearStart,
      endDate: yearEnd,
      status: 'OPEN',
      createdById: admin.id,
    },
  });
  console.log('Fiscal period seeded (open, current year)');

  console.log(`Currencies seeded (${currencies.length} currencies)`);

  // INF-7 (GF-IMP-W3): خزينة نقدية افتراضية نشطة — متطلب runbook النسخ
  // الاحتياطي (re-seed قابل للتكرار) وبيئة جديدة لا يمكنها دفع رواتب ولا
  // سلف ولا سندات صرف بدونها (كان الدليل يلتف على المشكلة بـ SQL يدوي).
  // النموذج لا يملك عمود code فالمفتاح الطبيعي هو (name, type) عبر
  // findFirst ثم create — idempotent كبقية البذرة؛ الرصيد الابتدائي 0 لا
  // يُفرَّغ على قاعدة قائمة (التحديث محروس بالوجود لا upsert فارغ لأن لا
  // قيد فريد في القاعدة)، والعملة EGP مثبتة من البذرة أعلاه.
  const treasury =
    (await prisma.treasury.findFirst({
      where: { name: 'الخزينة النقدية الرئيسية', type: 'CASH' },
      select: { id: true },
    })) ??
    (await prisma.treasury.create({
      data: {
        name: 'الخزينة النقدية الرئيسية',
        type: 'CASH',
        balance: 0,
        isActive: true,
        currencyId: CURRENCIES.EGP,
      },
      select: { id: true },
    }));
  console.log('Default CASH treasury ensured:', treasury.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
