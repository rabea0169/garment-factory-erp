/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * SELIM-ERP W4: e2e فروع الشركة + الصلاحيات التفصيلية — بـ mock Prisma
 * (نفس نمط app.e2e-spec). يغطي: RBAC الكتابة (GM/SA)، رئيسي واحد فقط،
 * لا حذف للفرع الرئيسي، GET/PUT صلاحيات المستخدم مع حماية حبس النفس،
 * وتنقية الصفوف الدخيلة.
 */
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'e2e-app-test-secret-with-at-least-32-characters';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/e2e_test';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { createPrismaMock } from './helpers/prisma-mock';
import { JwtService } from '@nestjs/jwt';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module') as {
  AppModule: typeof import('../src/app.module').AppModule;
};

const SA = '11111111-1111-4111-8111-111111111111';
const GM = '22222222-2222-4222-8222-222222222222';
const CASHIER = '33333333-3333-4333-8333-333333333333';

describe('Branches + UserPermissions (e2e) — SELIM-ERP W4', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof createPrismaMock>;
  let saToken: string;
  let gmToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    prisma = createPrismaMock();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    // مستخدمو الاختبار (يشمل عمود الصلاحيات الجديد).
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        const users: Record<string, Record<string, unknown>> = {
          [SA]: {
            id: SA,
            name: 'الأدمن',
            email: 'admin@factory.com',
            role: UserRole.SUPER_ADMIN,
            isActive: true,
            jwtVersion: 0,
            permissions: null,
          },
          [GM]: {
            id: GM,
            name: 'المدير العام',
            email: 'gm@factory.com',
            role: UserRole.GENERAL_MANAGER,
            isActive: true,
            jwtVersion: 0,
            permissions: null,
          },
          [CASHIER]: {
            id: CASHIER,
            name: 'كاشير',
            email: 'cashier@factory.com',
            role: UserRole.CASHIER,
            isActive: true,
            jwtVersion: 0,
            permissions: [{ resource: 'branches', action: 'READ' }],
          },
        };
        return Promise.resolve(users[where.id] ?? null);
      },
    );
    // الفروع: رئيسي واحد + فرع ثانوي.
    prisma.companyBranch.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        const branches: Record<string, Record<string, unknown>> = {
          'aaaaaaaa-0000-4000-8000-000000000001': {
            id: 'aaaaaaaa-0000-4000-8000-000000000001',
            name: 'الفرع الرئيسي',
            isMain: true,
            isActive: true,
          },
          'aaaaaaaa-0000-4000-8000-000000000002': {
            id: 'aaaaaaaa-0000-4000-8000-000000000002',
            name: 'فرع الجيزة',
            isMain: false,
            isActive: true,
          },
        };
        return Promise.resolve(branches[where.id] ?? null);
      },
    );
    prisma.companyBranch.findMany.mockResolvedValue([]);
    prisma.companyBranch.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'aaaaaaaa-0000-4000-8000-000000000003',
          ...data,
        }),
    );
    prisma.companyBranch.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'aaaaaaaa-0000-4000-8000-000000000002',
          ...data,
        }),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
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

    // AUTH-6: التوكن يضم v = jwtVersion — الاستراتيجية ترفض بدونه.
    const jwtService = app.get(JwtService, { strict: false });
    const tokenFor = (id: string, role: UserRole): string =>
      jwtService.sign({ sub: id, email: `${id}@factory.com`, role, v: 0 });
    saToken = tokenFor(SA, UserRole.SUPER_ADMIN);
    gmToken = tokenFor(GM, UserRole.GENERAL_MANAGER);
    cashierToken = tokenFor(CASHIER, UserRole.CASHIER);
  });

  describe('الفروع — /branches', () => {
    it('GET /branches لكل موثّق (منتقي النماذج)', () =>
      request(app.getHttpServer())
        .get('/branches')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.branches)).toBe(true);
        }));

    it('POST /branches للمدير العام (201) ويكتب سجل تدقيق', () =>
      request(app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${gmToken}`)
        .send({ name: 'فرع القاهرة', phone: '0100' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({ name: 'فرع القاهرة' });
        })
        .expect(() => {
          expect(prisma.activityLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ action: 'BRANCH_CREATED' }),
            }),
          );
        }));

    it('POST /branches مرفوض للكاشير (403) — الكتابة GM/SA فقط', () =>
      request(app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ name: 'فرع وهمي' })
        .expect(403));

    it('POST /branches يرفض اسمًا قصيرًا (400)', () =>
      request(app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${saToken}`)
        .send({ name: 'ف' })
        .expect(400));

    it('PATCH /branches/:id ينقل الرئيسية فيُلغي رئيسية غيره', async () => {
      const res = await request(app.getHttpServer())
        .patch('/branches/aaaaaaaa-0000-4000-8000-000000000002')
        .set('Authorization', `Bearer ${saToken}`)
        .send({ isMain: true })
        .expect(200);
      expect(res.body.isMain).toBe(true);
      expect(prisma.companyBranch.updateMany).toHaveBeenCalledWith({
        where: {
          isMain: true,
          id: { not: 'aaaaaaaa-0000-4000-8000-000000000002' },
        },
        data: { isMain: false },
      });
    });

    it('DELETE /branches/:id يرفض حذف الفرع الرئيسي', async () => {
      const res = await request(app.getHttpServer())
        .delete('/branches/aaaaaaaa-0000-4000-8000-000000000001')
        .set('Authorization', `Bearer ${saToken}`)
        .expect(200);
      expect(res.body).toMatchObject({ success: false });
      expect(prisma.companyBranch.delete).not.toHaveBeenCalledWith({
        where: { id: 'aaaaaaaa-0000-4000-8000-000000000001' },
      });
    });

    it('DELETE /branches/:id يحذف الفرع غير الرئيسي', async () => {
      await request(app.getHttpServer())
        .delete('/branches/aaaaaaaa-0000-4000-8000-000000000002')
        .set('Authorization', `Bearer ${saToken}`)
        .expect(200)
        .expect({ success: true });
      expect(prisma.companyBranch.delete).toHaveBeenCalledWith({
        where: { id: 'aaaaaaaa-0000-4000-8000-000000000002' },
      });
    });
  });

  describe('الصلاحيات — /users/:id/permissions', () => {
    it('GET صلاحيات مستخدم آخر مرفوض للكاشير (403 — نظره لنفسه فقط)', () =>
      request(app.getHttpServer())
        .get(`/users/${GM}/permissions`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(403));

    it('GET صلاحياتي الشخصية يعيد الصريحة + الافتراضية + الفعالة', () =>
      request(app.getHttpServer())
        .get(`/users/${CASHIER}/permissions`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.user.id).toBe(CASHIER);
          expect(res.body.stored).toEqual([
            { resource: 'branches', action: 'READ' },
          ]);
          expect(res.body.effective.source).toBe('user');
        }));

    it('PUT صلاحيات مستخدم — للأدمن فقط ويرفض نفسه (حبس النفس)', () => {
      // الأدمن يحاول تعديل صلاحياته → 409.
      return request(app.getHttpServer())
        .put(`/users/${SA}/permissions`)
        .set('Authorization', `Bearer ${saToken}`)
        .send({ permissions: [] })
        .expect(409);
    });

    it('PUT صلاحيات موجهة للأدمن تعمل وتُنقّى الصفوف الدخيلة', async () => {
      prisma.user.update.mockImplementation(
        ({ data }: { data: { permissions: unknown } }) =>
          Promise.resolve({
            id: CASHIER,
            name: 'كاشير',
            email: 'cashier@factory.com',
            role: UserRole.CASHIER,
            isActive: true,
            createdAt: new Date(),
            permissions: data.permissions,
          }),
      );
      const res = await request(app.getHttpServer())
        .put(`/users/${CASHIER}/permissions`)
        .set('Authorization', `Bearer ${saToken}`)
        .send({
          permissions: [
            { resource: 'financial-reports', action: 'READ' },
            { resource: 'not-a-resource', action: 'READ' }, // يُسقط
            { resource: 'sales', action: 'READ' },
            { resource: 'sales', action: 'READ' }, // تكرار يُزال
          ],
        })
        .expect(200);
      expect(res.body.stored).toEqual([
        { resource: 'financial-reports', action: 'READ' },
        { resource: 'sales', action: 'READ' },
      ]);
      expect(res.body.effective.source).toBe('user');
      expect(prisma.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'USER_PERMISSIONS_UPDATED',
          }),
        }),
      );
    });

    it('GET /auth/me يعيد الصلاحيات الفعالة (الدور أساس + الصريح)', () =>
      request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.effectivePermissions).toBeDefined();
          expect(res.body.permissions).toBeUndefined();
        }));
  });

  afterAll(async () => {
    await app.close();
  });
});
