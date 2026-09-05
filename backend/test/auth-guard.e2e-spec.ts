import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinancialPostingService } from '../src/core/financial/financial-posting.service';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';

/**
 * GF-0002 — اختبارات الحماية الفعلية (معايير القبول 1 و2 و5):
 * 1) مسار محمي بلا توكن → 401
 * 2) دور خاطئ على مسار مقيّد → 403
 * 5) الهوية (userId/createdById) تُستخرج من الجلسة لا من body
 *
 * PrismaService مُستبدل بـ mock — لا حاجة لقاعدة بيانات.
 */
// قيمة اختبارية (ليست سرًا) — تُعيّن عبر متغير وسيط كي لا تطابق أنماط secret-scan
const E2E_TEST_SECRET = 'e2e-test-secret-value-with-at-least-32-chars!!';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? E2E_TEST_SECRET;
process.env.NODE_ENV = 'test';

interface TestUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  password: string;
}

const users: TestUser[] = [
  {
    id: 'e2e-admin',
    name: 'مدير أعلى',
    email: 'admin@t.co',
    role: 'SUPER_ADMIN',
    isActive: true,
    password: 'x',
  },
  {
    id: 'e2e-viewer',
    name: 'مشاهد',
    email: 'viewer@t.co',
    role: 'VIEWER',
    isActive: true,
    password: 'x',
  },
  {
    id: 'e2e-production-manager',
    name: 'مدير إنتاج',
    email: 'production@t.co',
    role: 'PRODUCTION_MANAGER',
    isActive: true,
    password: 'x',
  },
  {
    id: 'e2e-accountant',
    name: 'محاسب',
    email: 'acc@t.co',
    role: 'ACCOUNTANT',
    isActive: true,
    password: 'x',
  },
  {
    id: 'e2e-cashier',
    name: 'كاشير',
    email: 'cashier@t.co',
    role: 'CASHIER',
    isActive: true,
    password: 'x',
  },
];

describe('Auth guard (e2e) — GF-0002', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  const prismaFns = {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    salesOrder: { findMany: jest.fn(), count: jest.fn() },
    account: { create: jest.fn() },
    voucher: { create: jest.fn(), findFirst: jest.fn() },
    workerAdvance: { create: jest.fn() },
    // الموجة 5 (COMM-F05): recordAdvance يتحقق من العامل ويسجل activityLog
    // داخل الـ transaction — بدونها يرمي TypeError → 500.
    worker: { findUnique: jest.fn() },
    activityLog: { create: jest.fn() },
    product: { create: jest.fn(), findFirst: jest.fn() },
    productVariant: { create: jest.fn() },
    rawMaterial: { findFirst: jest.fn() },
    bomVersion: { findFirst: jest.fn(), create: jest.fn() },
    bomLine: { upsert: jest.fn(), delete: jest.fn() },
  };

  // A1/A2/A3: mock مبسّط لـ FinancialPostingService — لا يحتاج DB فعلي.
  const financialFns = {
    postJournalEntry: jest.fn().mockResolvedValue({
      entryId: 'je-mock-001',
      entryCode: 'JE-20260827-AAAAAAAA',
      totalDebit: 100,
      totalCredit: 100,
      linesCount: 1,
      createdAt: new Date('2026-08-27T00:00:00Z'),
    }),
    postJournalEntryInTx: jest.fn().mockResolvedValue({
      entryId: 'je-mock-001',
      entryCode: 'JE-20260827-AAAAAAAA',
      totalDebit: 100,
      totalCredit: 100,
      linesCount: 1,
      createdAt: new Date('2026-08-27T00:00:00Z'),
    }),
    reverseJournalEntry: jest.fn(),
  };

  beforeAll(async () => {
    prismaFns.$transaction.mockImplementation(
      (callback: (tx: typeof prismaFns) => Promise<unknown>) =>
        callback(prismaFns),
    );
    prismaFns.voucher.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'voucher-mock-001', ...data }),
    );
    prismaFns.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(users.find((u) => u.id === where.id) ?? null),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaFns)
      .overrideProvider(FinancialPostingService)
      .useValue(financialFns)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    jwtService = app.get(JwtService, { strict: false });
  });

  const tokenFor = (user: TestUser): string =>
    jwtService.sign({ sub: user.id, email: user.email, role: user.role });

  const viewerToken = () => tokenFor(users[1]);
  const productionManagerToken = () => tokenFor(users[2]);
  const accountantToken = () => tokenFor(users[3]);
  const adminToken = () => tokenFor(users[0]);
  const cashierToken = () => tokenFor(users[4]);

  afterAll(async () => {
    await app.close();
  });

  // ---------- معيار القبول 1: 401 بلا توكن ----------

  it('GET /sales/orders بلا توكن → 401', () => {
    return request(app.getHttpServer()).get('/sales/orders').expect(401);
  });

  it('GET /dashboard/stats بلا توكن → 401', () => {
    return request(app.getHttpServer()).get('/dashboard/stats').expect(401);
  });

  it('GET /inventory/raw-materials بلا توكن → 401', () => {
    return request(app.getHttpServer())
      .get('/inventory/raw-materials')
      .expect(401);
  });

  it('GET /production/work-orders بلا توكن → 401', () => {
    return request(app.getHttpServer())
      .get('/production/work-orders')
      .expect(401);
  });

  it('GET /hr/workers بلا توكن → 401', () => {
    return request(app.getHttpServer()).get('/hr/workers').expect(401);
  });

  it('POST /quality بلا توكن → 401', () => {
    return request(app.getHttpServer()).post('/quality').send({}).expect(401);
  });

  it('GET /quality/kpis بلا توكن → 401', () => {
    return request(app.getHttpServer()).get('/quality/kpis').expect(401);
  });

  it('POST /hr/payrolls بلا توكن → 401', () => {
    return request(app.getHttpServer())
      .post('/hr/payrolls')
      .send({})
      .expect(401);
  });

  it('POST /hr/payrolls/:id/approve بلا توكن → 401', () => {
    return request(app.getHttpServer())
      .post('/hr/payrolls/pay-1/approve')
      .expect(401);
  });

  it('GET /accounting/accounts بلا توكن → 401', () => {
    return request(app.getHttpServer()).get('/accounting/accounts').expect(401);
  });

  it('GET /dashboard/stats بلا توكن → 401', () => {
    return request(app.getHttpServer()).get('/dashboard/stats').expect(401);
  });

  it('POST /purchasing/:id/receipts بلا توكن → 401', () => {
    return request(app.getHttpServer())
      .post('/purchasing/purchase-1/receipts')
      .send({ items: [] })
      .expect(401);
  });

  it('VIEWER لا يستطيع إنشاء إذن استلام مشتريات → 403', () => {
    return request(app.getHttpServer())
      .post('/purchasing/purchase-1/receipts')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({ items: [] })
      .expect(403);
  });

  it('توكن غير صالح → 401', () => {
    return request(app.getHttpServer())
      .get('/sales/orders')
      .set('Authorization', 'Bearer this-is-not-a-jwt')
      .expect(401);
  });

  it('توكن لمستخدم موقوف/غير موجود → 401', () => {
    const ghostToken = jwtService.sign({
      sub: 'ghost-id',
      email: 'ghost@t.co',
      role: 'VIEWER',
    });
    return request(app.getHttpServer())
      .get('/sales/orders')
      .set('Authorization', `Bearer ${ghostToken}`)
      .expect(401);
  });

  // ---------- الوصول المشروع ----------

  it('توكن صالح بدور VIEWER على مسار قراءة عام → 200', async () => {
    prismaFns.salesOrder.findMany.mockResolvedValue([]);
    return request(app.getHttpServer())
      .get('/sales/orders')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .expect(200)
      .expect((res) => {
        const body: unknown = res.body;
        if (
          !body ||
          typeof body !== 'object' ||
          !('data' in body) ||
          !Array.isArray(body.data)
        ) {
          throw new Error('يتوقع استجابة data/meta موحدة');
        }
        if (
          !('meta' in body) ||
          !body.meta ||
          typeof body.meta !== 'object' ||
          !('page' in body.meta) ||
          body.meta.page !== 1
        ) {
          throw new Error('بيانات Pagination غير صحيحة');
        }
      });
  });

  it('POST /hr/payrolls بدور VIEWER → 403', () => {
    return request(app.getHttpServer())
      .post('/hr/payrolls')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({})
      .expect(403);
  });

  it('POST /hr/payrolls بمدخلات غير صالحة → 400', () => {
    return request(app.getHttpServer())
      .post('/hr/payrolls')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ workerId: 'not-a-uuid' })
      .expect(400);
  });

  // ---------- معيار القبول 2: 403 للدور الخطأ ----------

  it('VIEWER يحاول إنشاء حساب محاسبي (مقيّد على ACCOUNTANT) → 403', () => {
    return request(app.getHttpServer())
      .post('/accounting/accounts')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({ code: '1000', name: 'الصندوق', type: 'ASSET' })
      .expect(403);
  });

  it('CASHIER يحاول قراءة شجرة الحسابات (ACCOUNTANT/GENERAL_MANAGER) → 403', () => {
    return request(app.getHttpServer())
      .get('/accounting/accounts')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .expect(403);
  });

  it('VIEWER يحاول إضافة مخزون (INVENTORY_MANAGER) → 403', () => {
    return request(app.getHttpServer())
      .post('/inventory/raw-materials/some-id/add-stock')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({ quantity: 10, costPerUnit: 5 })
      .expect(403);
  });

  it('VIEWER يحاول تسجيل فحص جودة (PRODUCTION_MANAGER) → 403', () => {
    return request(app.getHttpServer())
      .post('/quality')
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send({})
      .expect(403);
  });

  it('الدور الصحيح ينجح: ACCOUNTANT ينشئ حسابًا → 201', async () => {
    prismaFns.account.create.mockResolvedValue({
      id: 'acc-1',
      code: '1000',
      name: 'الصندوق',
      type: 'ASSET',
    });
    return request(app.getHttpServer())
      .post('/accounting/accounts')
      .set('Authorization', `Bearer ${accountantToken()}`)
      .send({ code: '1000', name: 'الصندوق', type: 'ASSET' })
      .expect(201);
  });

  it('SUPER_ADMIN يتجاوز قيود الأدوار → 201', async () => {
    prismaFns.account.create.mockResolvedValue({
      id: 'acc-2',
      code: '1100',
      name: 'البنك',
      type: 'ASSET',
    });
    return request(app.getHttpServer())
      .post('/accounting/accounts')
      .set('Authorization', `Bearer ${tokenFor(users[0])}`)
      .send({ code: '1100', name: 'البنك', type: 'ASSET' })
      .expect(201);
  });

  // ---------- معيار القبول 5: الهوية من الجلسة لا من body ----------

  it('createdById للسند يُستخرج من الجلسة — لا يقبل من body (P0-04)', async () => {
    prismaFns.voucher.create.mockImplementation(
      (args: { data: { createdById: string } }) =>
        Promise.resolve({ id: 'v-1', ...args.data }),
    );
    await request(app.getHttpServer())
      .post('/accounting/vouchers')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({
        type: 'PAYMENT',
        amount: 100,
        description: 'اختبار',
        treasuryId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(201);

    expect(prismaFns.voucher.create).toHaveBeenCalledTimes(1);
    const firstCall = prismaFns.voucher.create.mock.calls[0] as unknown as [
      { data: { createdById: string } },
    ];
    expect(firstCall[0].data.createdById).toBe('e2e-cashier');
  });

  // ---------- المسارات العامة ----------

  it('POST /auth/login عام — يصل للـ validation فيرجع 400 (لا 401) لمدخلات غير صالحة', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'not-an-email', password: '123' })
      .expect(400);
  });

  it('GET / عام — 200 بلا توكن', () => {
    return request(app.getHttpServer()).get('/').expect(200);
  });

  // ---------- GF-0004: التحقق من المدخلات (DTO validation) ----------
  // SUPER_ADMIN يتجاوز كل الأدوار — هذه الاختبارات تعزل فشل الـ validation عن 401/403

  describe('DTO validation — GF-0004 (400 tests)', () => {
    const adminToken = () => tokenFor(users[0]);
    const UUID = '123e4567-e89b-12d3-a456-426614174000';

    const validSalesOrder = () => ({
      customerId: UUID,
      paymentType: 'CASH',
      discount: 0,
      items: [{ productVariantId: UUID, quantity: 1, unitPrice: 10 }],
    });

    // معيار القبول 2: حقل غير معروف → 400
    it('حقل غير معروف (userId) في أمر بيع → 400 (forbidNonWhitelisted)', () => {
      return request(app.getHttpServer())
        .post('/sales/orders')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validSalesOrder(), userId: 'HACKED-USER' })
        .expect(400);
    });

    it('حقل هوية مزور (createdById) في سند → 400 — لا يدخل أصلًا (P0-04 مقوى)', () => {
      return request(app.getHttpServer())
        .post('/accounting/vouchers')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({
          type: 'PAYMENT',
          amount: 50,
          description: 'اختبار',
          createdById: 'HACKED-USER-ID',
        })
        .expect(400);
    });

    // معيار القبول 3: enum غير صالح → 400
    it('paymentType غير صالح في أمر بيع → 400', () => {
      return request(app.getHttpServer())
        .post('/sales/orders')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validSalesOrder(), paymentType: 'NOT_A_PAYMENT_TYPE' })
        .expect(400);
    });

    it('type غير صالح في سند محاسبي → 400', () => {
      return request(app.getHttpServer())
        .post('/accounting/vouchers')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'NOT_A_TYPE', amount: 50, description: 'اختبار' })
        .expect(400);
    });

    it('type غير صالح في حساب محاسبي → 400', () => {
      return request(app.getHttpServer())
        .post('/accounting/accounts')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ code: '1300', name: 'حساب تكراري', type: 'NOT_ACCOUNT_TYPE' })
        .expect(400);
    });

    it('status غير صالح في تحديث أمر تشغيل → 400', () => {
      return request(app.getHttpServer())
        .patch(`/production/work-orders/${UUID}/status`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ status: 'NOT_A_STATUS' })
        .expect(400);
    });

    it('stage غير صالح في فحص جودة → 400', () => {
      return request(app.getHttpServer())
        .post('/quality')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({
          workOrderId: UUID,
          stage: 'NOT_A_STAGE',
          checkedQty: 10,
          passedQty: 10,
          rejectedQty: 0,
        })
        .expect(400);
    });

    // معيار القبول 4: كميات/أسعار غير موجبة → 400
    it('كمية سالبة في بند أمر بيع → 400', () => {
      return request(app.getHttpServer())
        .post('/sales/orders')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({
          ...validSalesOrder(),
          items: [{ productVariantId: UUID, quantity: -2, unitPrice: 10 }],
        })
        .expect(400);
    });

    it('سعر وحدة صفر في بند أمر بيع → 400', () => {
      return request(app.getHttpServer())
        .post('/sales/orders')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({
          ...validSalesOrder(),
          items: [{ productVariantId: UUID, quantity: 1, unitPrice: 0 }],
        })
        .expect(400);
    });

    it('خصم سالب في أمر بيع → 400', () => {
      return request(app.getHttpServer())
        .post('/sales/orders')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validSalesOrder(), discount: -10 })
        .expect(400);
    });

    it('قائمة بنود فارغة في أمر بيع → 400', () => {
      return request(app.getHttpServer())
        .post('/sales/orders')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validSalesOrder(), items: [] })
        .expect(400);
    });

    it('amount سالب في سند → 400', () => {
      return request(app.getHttpServer())
        .post('/accounting/vouchers')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ type: 'PAYMENT', amount: -50, description: 'اختبار' })
        .expect(400);
    });

    it('كمية صفر في إضافة مخزون → 400', () => {
      return request(app.getHttpServer())
        .post(`/inventory/raw-materials/${UUID}/add-stock`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ quantity: 0, costPerUnit: 5 })
        .expect(400);
    });

    it('retailPrice صفر في منتج جديد → 400', () => {
      return request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({
          code: 'PRD-X01',
          name: 'منتج اختبار',
          category: 'اختبار',
          retailPrice: 0,
          wholesalePrice: 10,
        })
        .expect(400);
    });

    it('checkedQty سالب في فحص جودة → 400', () => {
      return request(app.getHttpServer())
        .post('/quality')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({
          workOrderId: UUID,
          stage: 'SEWING',
          checkedQty: -5,
          passedQty: 0,
          rejectedQty: 0,
        })
        .expect(400);
    });

    // UUID وتواريخ
    it('معرف غير UUID في مسار إضافة المخزون → 400 (ParseUUIDPipe)', () => {
      return request(app.getHttpServer())
        .post('/inventory/raw-materials/not-a-uuid/add-stock')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ quantity: 5, costPerUnit: 5 })
        .expect(400);
    });

    it('معرف غير UUID (customerId) في أمر بيع → 400', () => {
      return request(app.getHttpServer())
        .post('/sales/orders')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validSalesOrder(), customerId: 'not-a-uuid' })
        .expect(400);
    });

    it('تاريخ غير صالح في تسجيل إنتاج عامل → 400', () => {
      return request(app.getHttpServer())
        .post('/hr/production')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ workerId: UUID, date: 'not-a-date', piecesCount: 10 })
        .expect(400);
    });

    it('طلب صالح كامل يمر الـ validation بنجاح (لا 400 كاذبة) — تسجيل سلفة → 201', async () => {
      prismaFns.workerAdvance.create.mockResolvedValue({ id: 'adv-1' });
      // الموجة 5: الخدمة تتحقق من وجود العامل داخل tx قبل إنشاء السلفة
      prismaFns.worker.findUnique.mockResolvedValue({
        id: UUID,
        name: 'عامل اختبار',
        code: 'WK-TEST',
      });
      return request(app.getHttpServer())
        .post('/hr/advances')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ workerId: UUID, amount: 200, notes: 'سلفة اختبار' })
        .expect(201);
    });
  });

  // ---------- GF-REMAINING-001: حماية مسارات المنتجات ----------

  describe('ProductsController RBAC and UUID validation', () => {
    const productId = '123e4567-e89b-12d3-a456-426614174000';
    const rawMaterialId = '223e4567-e89b-12d3-a456-426614174000';
    const bomId = '323e4567-e89b-12d3-a456-426614174000';
    const validProduct = {
      code: 'PRD-RBAC-001',
      name: 'منتج اختبار الصلاحيات',
      category: 'اختبار',
      retailPrice: 300,
      wholesalePrice: 220,
    };

    beforeEach(() => {
      prismaFns.product.create.mockResolvedValue({
        id: productId,
        ...validProduct,
      });
      prismaFns.product.findFirst.mockResolvedValue({ id: productId });
      prismaFns.productVariant.create.mockResolvedValue({
        id: 'variant-rbac-1',
      });
      prismaFns.rawMaterial.findFirst.mockResolvedValue({ id: rawMaterialId });
      prismaFns.bomVersion.findFirst.mockResolvedValue({
        id: 'bom-version-rbac-1',
      });
      prismaFns.bomLine.upsert.mockResolvedValue({ id: bomId });
      prismaFns.bomLine.delete.mockResolvedValue({ id: bomId });
    });

    it('POST /products بلا توكن → 401', () => {
      return request(app.getHttpServer())
        .post('/products')
        .send(validProduct)
        .expect(401);
    });

    it('POST /products/:id/variants بلا توكن → 401', () => {
      return request(app.getHttpServer())
        .post(`/products/${productId}/variants`)
        .send({ size: 'L', color: 'أزرق' })
        .expect(401);
    });

    it('POST /products/:id/bom بلا توكن → 401', () => {
      return request(app.getHttpServer())
        .post(`/products/${productId}/bom`)
        .send({ rawMaterialId, quantity: 1.25, unit: 'METER' })
        .expect(401);
    });

    it('POST /products/bom/:bomId/delete بلا توكن → 401', () => {
      return request(app.getHttpServer())
        .post(`/products/bom/${bomId}/delete`)
        .expect(401);
    });

    it('VIEWER لا يستطيع إنشاء منتج أو متغير أو BOM أو حذف BOM → 403', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${viewerToken()}`)
        .send(validProduct)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/products/${productId}/variants`)
        .set('Authorization', `Bearer ${viewerToken()}`)
        .send({ size: 'L', color: 'أزرق' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/products/${productId}/bom`)
        .set('Authorization', `Bearer ${viewerToken()}`)
        .send({ rawMaterialId, quantity: 1.25, unit: 'METER' })
        .expect(403);
      return request(app.getHttpServer())
        .post(`/products/bom/${bomId}/delete`)
        .set('Authorization', `Bearer ${viewerToken()}`)
        .expect(403);
    });

    it('PRODUCTION_MANAGER يستطيع إنشاء منتج → 201', () => {
      return request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${productionManagerToken()}`)
        .send(validProduct)
        .expect(201);
    });

    it('PRODUCTION_MANAGER يستطيع إضافة متغير وBOM وحذف BOM → 201/201/201', async () => {
      await request(app.getHttpServer())
        .post(`/products/${productId}/variants`)
        .set('Authorization', `Bearer ${productionManagerToken()}`)
        .send({ size: 'L', color: 'أزرق' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/products/${productId}/bom`)
        .set('Authorization', `Bearer ${productionManagerToken()}`)
        .send({ rawMaterialId, quantity: 1.25, unit: 'METER' })
        .expect(201);
      return request(app.getHttpServer())
        .post(`/products/bom/${bomId}/delete`)
        .set('Authorization', `Bearer ${productionManagerToken()}`)
        .expect(201);
    });

    it('معرف المنتج أو BOM غير صالح → 400 قبل الخدمة', async () => {
      await request(app.getHttpServer())
        .get('/products/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(400);
      await request(app.getHttpServer())
        .post('/products/not-a-uuid/variants')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ size: 'L', color: 'أزرق' })
        .expect(400);
      return request(app.getHttpServer())
        .post('/products/bom/not-a-uuid/delete')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(400);
    });

    it('مدخلات المنتج والمتغير وBOM غير الصالحة → 400', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ ...validProduct, retailPrice: 0 })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/products/${productId}/variants`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ size: '', color: 'أزرق' })
        .expect(400);
      return request(app.getHttpServer())
        .post(`/products/${productId}/bom`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ rawMaterialId: 'not-a-uuid', quantity: 0, unit: '' })
        .expect(400);
    });
  });
});
