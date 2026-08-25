import 'dotenv/config';
import { PrismaClient, UserRole, RawMaterialUnit, WorkerSpecialty } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

// GF-0002 / P0-03: الاتصال من البيئة فقط — لا connection string مكتوب في الكود
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL مفقود — seed يقرأ الاتصال من البيئة فقط. انسخ backend/.env.example إلى backend/.env واضبط القيمة.',
  );
  process.exit(1);
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// GF-0006 / P1-02: كلمة مرور admin الأولية من البيئة — لا قيمة منشورة في الكود أو README
const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;
if (!seedAdminPassword) {
  console.error(
    'SEED_ADMIN_PASSWORD مفقود — حدد كلمة مرور أولية للتطوير في backend/.env (مثال في backend/.env.example). لا قيمة افتراضية لأسباب أمنية.',
  );
  process.exit(1);
}

async function main() {
  console.log('Seeding database...');

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

  // 2. Create Raw Materials
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
  console.log('Raw Materials seeded');

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

  // BOM (Bill of Materials)
  await prisma.bomItem.create({
    data: { productId: product.id, rawMaterialId: rm1.id, quantity: 1.2, unit: 'متر' },
  });
  await prisma.bomItem.create({
    data: { productId: product.id, rawMaterialId: rm2.id, quantity: 0.1, unit: 'بكرة' },
  });
  console.log('Products & BOM seeded');

  // 4. Create Finished Goods Inventory
  await prisma.finishedGood.create({
    data: { productVariantId: variantM.id, quantity: 50 },
  });
  await prisma.finishedGood.create({
    data: { productVariantId: variantL.id, quantity: 30 },
  });
  console.log('Finished Goods seeded');

  // 5. Workers
  await prisma.worker.create({
    data: { code: 'WK-001', name: 'أحمد محمود', specialty: WorkerSpecialty.SEWING, pieceRate: 5.5 },
  });
  await prisma.worker.create({
    data: { code: 'WK-002', name: 'سيد علي', specialty: WorkerSpecialty.CUTTING, pieceRate: 3.0 },
  });
  console.log('Workers seeded');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
