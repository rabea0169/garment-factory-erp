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
process.env.JWT_SECRET = 'e2e-test-secret-value-with-at-least-32-chars!!';
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
    salesOrder: { findMany: jest.fn() },
    account: { create: jest.fn() },
    voucher: { create: jest.fn() },
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
        if (!Array.isArray(res.body)) throw new Error('يتوقع مصفوفة');
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

  it('createdById للسند يُستخرج من الجلسة — قيمة body المزورة تُتجاهل (P0-04)', async () => {
    prismaFns.voucher.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'v-1', ...data }),
    );
    await request(app.getHttpServer())
      .post('/accounting/vouchers')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({
        type: 'PAYMENT',
        amount: 100,
        description: 'اختبار',
        createdById: 'HACKED-USER-ID',
      })
      .expect(201);

    expect(prismaFns.voucher.create).toHaveBeenCalledTimes(1);
    const firstCall = prismaFns.voucher.create.mock.calls[0] as unknown as [
      { data: { createdById: string } },
    ];
    expect(firstCall[0].data.createdById).toBe('e2e-cashier');
    expect(firstCall[0].data.createdById).not.toBe('HACKED-USER-ID');
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
});
