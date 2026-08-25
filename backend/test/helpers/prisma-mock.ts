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
    // B2: $queryRaw mock — default returns empty array. Override per-test with
    // prisma.$queryRaw = jest.fn().mockResolvedValue([...])
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn() },
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
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      // A5: updateMany للاختبار atomic decrement (WHERE quantity >= N)
      updateMany: jest.fn(),
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
    // A8: idempotencyKey mock — findUnique (for replay), create (for new key), update (for storing response)
    idempotencyKey: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    worker: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    dailyProduction: { create: jest.fn() },
    workerAdvance: { create: jest.fn() },
    account: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    voucher: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    treasury: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    journalEntry: {
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    journalLine: { create: jest.fn() },
    customer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    supplier: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    shipment: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
  };
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;

/**
 * mock لـ EventEmitter2 — يلتقط emit + emitAsync دون تفعيل أي listeners فعليين،
 * ما يسمح بالتحقق من إطلاق الأحداث (EVENTS.*) في اختبارات الخدمات.
 *
 * B7: emitAsync تُرجع Promise (fire-and-forget) — نُعيدها كـ resolved Promise
 * كي لا يظهر unhandled rejection عند استخدام `void` operator في الكود.
 */
export function createEventEmitterMock(): EventEmitter2 {
  const emit = jest.fn();
  const emitAsync = jest.fn().mockResolvedValue(undefined);
  return { emit, emitAsync } as unknown as EventEmitter2;
}
