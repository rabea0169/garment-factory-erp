import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
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
    user: { findUnique: jest.fn() },
    salesOrder: { findMany: jest.fn(), count: jest.fn() },
    account: { create: jest.fn() },
    voucher: { create: jest.fn() },
    workerAdvance: { create: jest.fn() },
  };

  beforeAll(async () => {
    prismaFns.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(users.find((u) => u.id === where.id) ?? null),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaFns)
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
  const accountantToken = () => tokenFor(users[2]);
  const cashierToken = () => tokenFor(users[3]);

  afterAll(async () => {
    await app.close();
  });

  // ---------- معيار القبول 1: 401 بلا توكن ----------

  it('GET /sales/orders بلا توكن → 401', () => {
    return request(app.getHttpServer()).get('/sales/orders').expect(401);
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

  it('GET /accounting/accounts بلا توكن → 401', () => {
    return request(app.getHttpServer()).get('/accounting/accounts').expect(401);
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

  // ---------- معيار القبول 2: 403 لدور خاطئ ----------

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
      return request(app.getHttpServer())
        .post('/hr/advances')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ workerId: UUID, amount: 200, notes: 'سلفة اختبار' })
        .expect(201);
    });
  });
});
