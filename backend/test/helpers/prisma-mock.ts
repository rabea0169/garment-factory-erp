import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * GF-0003: مصنع mock موحد لـ PrismaService — يُستخدم في كل specs الوحدات
 * والاختبارات e2e كي لا تحتاج أي قاعدة بيانات فعلية.
 * كل استدعاء prisma يصبح jest.fn() قابلًا للضبط (mockResolvedValue) والتحقق (toHaveBeenCalledWith).
 */
export function createPrismaMock() {
  return {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    customer: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    salesOrder: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    rawMaterial: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    rawMaterialTransaction: { create: jest.fn() },
    finishedGood: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    season: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    productVariant: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    workOrder: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    purchaseOrder: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    qualityCheck: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    bomVersion: { findFirst: jest.fn(), create: jest.fn() },
    bomLine: { upsert: jest.fn(), delete: jest.fn() },
    stockLedgerEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    worker: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    dailyProduction: { create: jest.fn() },
    workerAdvance: { create: jest.fn() },
    account: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    voucher: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    shipment: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
  };
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;

/**
 * mock لـ EventEmitter2 — يلتقط emit دون تفعيل أي listeners فعليين،
 * ما يسمح بالتحقق من إطلاق الأحداث (EVENTS.*) في اختبارات الخدمات.
 */
export function createEventEmitterMock(): EventEmitter2 {
  return { emit: jest.fn() } as unknown as EventEmitter2;
}
