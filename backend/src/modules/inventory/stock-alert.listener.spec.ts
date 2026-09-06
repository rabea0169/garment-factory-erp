/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { StockAlertListener } from './stock-alert.listener';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENTS } from '../../events/event-types';

/**
 * CC-8 (W2-4): مستمع STOCK_LOW الحقيقي — أول @OnEvent في النظام.
 * نتحقق عبر وحدة اختبار حقيقية (EventEmitterModule + EventSubscribersLoader
 * من init) أن بث الحدث الفعلي يستدعي المستمع ويكتب ActivityLog، وأن فشل
 * الكتابة لا يرمي أبدًا (لا يكسر عمليات المخزون).
 *
 * ملاحظة توقيت: @OnEvent(..., { async: true }) يجعل eventemitter2 يؤجل
 * تنفيذ المستمع إلى setImdiate — فلا ينتظر emitAsync اكتماله (البث غير
 * حاجب للباث بالتصميم). نستخدم flushAsync بعد البث لاستنزاف دورة
 * setImdiate + microtasks قبل التحقق.
 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('StockAlertListener — CC-8 مستمع STOCK_LOW', () => {
  let app: INestApplication;
  let listener: StockAlertListener;
  let emitter: EventEmitter2;
  let prisma: {
    rawMaterial: { findUnique: jest.Mock };
    activityLog: { create: jest.Mock };
  };

  const PAYLOAD = {
    materialId: 'rm-1',
    warehouseId: 'wh-1',
    currentStock: 40,
    minStockLevel: 50,
    actorId: 'user-1',
  };

  beforeAll(async () => {
    prisma = {
      rawMaterial: { findUnique: jest.fn() },
      activityLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    };
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        StockAlertListener,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init(); // يسجّل EventSubscribersLoader مستمعات @OnEvent
    listener = app.get(StockAlertListener);
    emitter = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.activityLog.create.mockClear();
    prisma.rawMaterial.findUnique.mockReset();
    prisma.rawMaterial.findUnique.mockResolvedValue({
      code: 'RM-001',
      name: 'قماش قطني',
    });
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });
  });

  it('بث STOCK_LOW يستدعي المستمع ويكتب ActivityLog بالمادة والرصيد والعتبة', async () => {
    await emitter.emitAsync(EVENTS.STOCK_LOW, PAYLOAD);
    await flushAsync();

    expect(prisma.activityLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'STOCK_LOW_ALERT',
        module: 'INVENTORY',
        details: {
          materialId: 'rm-1',
          materialCode: 'RM-001',
          materialName: 'قماش قطني',
          warehouseId: 'wh-1',
          currentStock: 40,
          minStockLevel: 50,
        },
      },
    });
  });

  it('فشل كتابة ActivityLog لا يرمي — البث يكتمل ولا تكسر عملية المخزون', async () => {
    prisma.activityLog.create.mockRejectedValue(new Error('db write failed'));

    // emitAsync كان سيرفض لو رمى المستمع — هنا يكتمل بلا رمي
    await expect(
      emitter.emitAsync(EVENTS.STOCK_LOW, PAYLOAD),
    ).resolves.toBeDefined();
    await flushAsync();
    // المستمع التنفيذي اكتمل بلا رمي أيضًا (try/catch داخلي)
    expect(prisma.activityLog.create).toHaveBeenCalledTimes(1);
  });

  it('بلا فاعل (actorId غائب): لا يكتب ActivityLog — Logger تحذيري فقط (userId إلزامي في المخطط)', async () => {
    await emitter.emitAsync(EVENTS.STOCK_LOW, {
      materialId: 'rm-1',
      warehouseId: 'wh-1',
      currentStock: 40,
      minStockLevel: 50,
    });
    await flushAsync();

    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it('فشل جلب اسم المادة (best-effort) لا يمنع كتابة السجل', async () => {
    prisma.rawMaterial.findUnique.mockRejectedValue(new Error('lookup failed'));

    await emitter.emitAsync(EVENTS.STOCK_LOW, PAYLOAD);
    await flushAsync();

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'STOCK_LOW_ALERT',
        module: 'INVENTORY',
        details: expect.objectContaining({
          materialId: 'rm-1',
          materialCode: null,
          materialName: null,
          currentStock: 40,
          minStockLevel: 50,
        }),
      }),
    });
  });

  it('استدعاء مباشر للمعالج مع فشل الكتابة لا يرمي (try/catch داخلي)', async () => {
    prisma.activityLog.create.mockRejectedValue(new Error('db down'));

    await expect(listener.handleStockLow(PAYLOAD)).resolves.toBeUndefined();
  });
});
