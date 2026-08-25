/**
 * GF-0003: e2e أساسي يعمل بلا قاعدة بيانات — PrismaService مستبدل بـ mock.
 * متغيرات البيئة تُضبط قبل تحميل AppModule (باستخدام require بعد الضبط،
 * لأن import تُرفع لأعلى الملف وتقيّم AppModule قبل أي سطر).
 */
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'e2e-app-test-secret-with-at-least-32-characters';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/e2e_test';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createPrismaMock } from './helpers/prisma-mock';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module') as {
  AppModule: typeof import('../src/app.module').AppModule;
};

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(createPrismaMock())
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
  });

  it('GET / عام ويعيد رسالة الخدمة (سلوك الجذر بعد إصلاح تسجيل AppController)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterAll(async () => {
    await app.close();
  });
});
