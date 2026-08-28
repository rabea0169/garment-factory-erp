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
    // $executeRaw — used by InventoryService.receiveFinishedGood and
    // ProductionWorkflowService.recordStageOutput for atomic upserts on
    // finished_good_stocks via raw INSERT ... ON CONFLICT.
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: { findUnique: jest.fn(), update: jest.fn() },
    salesOrder: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    rawMaterial: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    rawMaterialTransaction: { create: jest.fn() },
    finishedGoodStock: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
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
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    season: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    productVariant: {
      create: jest.fn(),
      createMany: jest.fn(),
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
    productionStageRun: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    productionMaterialConsumption: {
      findMany: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    productionCostSnapshot: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    workOrderStageTransition: {
      create: jest.fn(),
      findUnique: jest.fn(),
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
    purchaseReceipt: { create: jest.fn(), findMany: jest.fn() },
    purchaseReceiptItem: { findMany: jest.fn() },
    qualityCheck: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    activityLog: { create: jest.fn() },
    // SEC-F04: refreshToken mock — findUnique (for refresh/logout), create (for new token), update (for revoke)
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    bomVersion: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    bomLine: {
      upsert: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
    },
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
    // E5: currency mock — findUnique (by code), upsert (seed), findMany (listing)
    currency: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
    },
    worker: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    dailyProduction: {
      create: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    attendance: { create: jest.fn() },
    workerAdvance: { create: jest.fn(), aggregate: jest.fn() },
    payroll: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    account: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    voucher: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
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
    fiscalPeriod: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    journalEntry: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    journalLine: { create: jest.fn() },
    customer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    supplier: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    customerPayment: {
      create: jest.fn(),
    },
    salesReturn: {
      create: jest.fn(),
    },
    salesReturnItem: {
      findMany: jest.fn(),
    },
    shipment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
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
