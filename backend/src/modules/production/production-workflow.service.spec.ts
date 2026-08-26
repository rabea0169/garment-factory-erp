/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, */
import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  _ProductionCostStatus,
  ProductionStage,
  ProductionStageRunStatus,
  WorkOrderStatus,
} from '@prisma/client';
import { ProductionWorkflowService } from './production-workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';

/**
 * WAVE2-B — اختبارات إصلاح النقاط الحرجة في مسار الإنتاج:
 *
 *   - ACC-F01 / OPS-F01: قيد GL مزدوج (Dr FINISHED_GOOD_STOCK / Cr WIP)
 *     عند إكمال أمر التشغيل عبر PACKING.
 *   - OPS-F03: رفض تسجيل إنتاج على أمر تشغيل مُلغى أو مُغلق.
 *   - OPS-F05: رفض إكمال أمر تشغيل دون فحص جودة موثَّق.
 *
 * النمط: mock يدوي شامل لـ PrismaService + InventoryService +
 * FinancialPostingService. لا نعتمد قاعدة بيانات فعلية.
 */

type TxMock = {
  productionStageRun: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  workOrder: {
    update: jest.Mock;
  };
  warehouse: {
    findFirst: jest.Mock;
  };
  productionMaterialConsumption: {
    findMany: jest.Mock;
  };
  productionCostSnapshot: {
    upsert: jest.Mock;
  };
  finishedGoodStock: {
    findUniqueOrThrow: jest.Mock;
  };
  stockLedgerEntry: {
    create: jest.Mock;
  };
  activityLog: {
    create: jest.Mock;
  };
  qualityCheck: {
    count: jest.Mock;
  };
  idempotencyKey: {
    create: jest.Mock;
    findUnique: jest.Mock;
  };
  productionStageRun_findUnique_includes_workOrder?: never;
  $executeRaw: jest.Mock;
};

function createTxMock(): TxMock {
  return {
    productionStageRun: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    workOrder: {
      update: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn(),
    },
    productionMaterialConsumption: {
      findMany: jest.fn(),
    },
    productionCostSnapshot: {
      upsert: jest.fn(),
    },
    finishedGoodStock: {
      findUniqueOrThrow: jest.fn(),
    },
    stockLedgerEntry: {
      create: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
    },
    qualityCheck: {
      count: jest.fn(),
    },
    idempotencyKey: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    $executeRaw: jest.fn(),
  };
}

describe('ProductionWorkflowService — WAVE2-B critical fixes', () => {
  let service: ProductionWorkflowService;
  let prisma: {
    $transaction: jest.Mock;
    idempotencyKey: { findUnique: jest.Mock };
    productionStageRun: { findUnique: jest.Mock };
  };
  let tx: TxMock;
  let inventoryService: { issue: jest.Mock };
  let financialPosting: {
    postJournalEntryInTx: jest.Mock;
  };

  beforeEach(() => {
    tx = createTxMock();
    prisma = {
      $transaction: jest.fn(),
      idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null) },
      productionStageRun: { findUnique: jest.fn() },
    };
    prisma.$transaction.mockImplementation(
      async (fn: (t: TxMock) => Promise<unknown>) => fn(tx),
    );
    inventoryService = { issue: jest.fn() };
    financialPosting = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({
        entryId: 'je-1',
        entryCode: 'JE-MOCK-1',
        totalDebit: 100,
        totalCredit: 100,
        linesCount: 1,
        createdAt: new Date(),
      }),
    };
    service = new ProductionWorkflowService(
      prisma as unknown as PrismaService,
      inventoryService as unknown as InventoryService,
      financialPosting as unknown as FinancialPostingService,
    );
  });

  // ====== OPS-F03: status check on CANCELLED/CLOSED ======

  describe('OPS-F03 — منع تسجيل الإنتاج على أمر تشغيل مُلغى', () => {
    it('يرفض تسجيل الإنتاج إذا كان أمر التشغيل CANCELLED', async () => {
      tx.productionStageRun.findUnique.mockResolvedValue({
        id: 'run-1',
        stage: ProductionStage.PACKING,
        status: ProductionStageRunStatus.IN_PROGRESS,
        workOrder: {
          currentStage: ProductionStage.PACKING,
          productVariantId: 'v-1',
          code: 'WO-001',
          status: WorkOrderStatus.CANCELLED,
        },
      });

      await expect(
        service.recordStageOutput({
          workOrderId: 'wo-1',
          stage: ProductionStage.PACKING,
          inputQty: 10,
          acceptedQty: 10,
          rejectedQty: 0,
          wasteQty: 0,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.recordStageOutput({
          workOrderId: 'wo-1',
          stage: ProductionStage.PACKING,
          inputQty: 10,
          acceptedQty: 10,
          rejectedQty: 0,
          wasteQty: 0,
        }),
      ).rejects.toThrow(
        `لا يمكن تسجيل إنتاج على أمر تشغيل بحالة ${WorkOrderStatus.CANCELLED}`,
      );

      // No idempotency key created, no stage_run update, no GL posting.
      expect(tx.idempotencyKey.create).not.toHaveBeenCalled();
      expect(tx.productionStageRun.update).not.toHaveBeenCalled();
      expect(financialPosting.postJournalEntryInTx).not.toHaveBeenCalled();
    });
  });

  // ====== OPS-F05: QualityCheck requirement ======

  describe('OPS-F05 — منع إكمال أمر التشغيل دون فحص جودة', () => {
    beforeEach(() => {
      // Stage run found, work order active, current stage matches.
      tx.productionStageRun.findUnique.mockResolvedValue({
        id: 'run-1',
        stage: ProductionStage.PACKING,
        status: ProductionStageRunStatus.IN_PROGRESS,
        workOrder: {
          currentStage: ProductionStage.PACKING,
          productVariantId: 'v-1',
          code: 'WO-001',
          status: WorkOrderStatus.IN_PROGRESS,
        },
      });
      tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
      tx.productionStageRun.update.mockResolvedValue({});
      tx.activityLog.create.mockResolvedValue({});
    });

    it('يرفض الإكمال إذا لم يوجد أي QualityCheck على أمر التشغيل', async () => {
      tx.qualityCheck.count.mockResolvedValue(0);

      await expect(
        service.recordStageOutput({
          workOrderId: 'wo-1',
          stage: ProductionStage.PACKING,
          inputQty: 10,
          acceptedQty: 10,
          rejectedQty: 0,
          wasteQty: 0,
        }),
      ).rejects.toThrow('لا يمكن إكمال أمر تشغيل دون فحص جودة موثَّق');

      // No GL posting fired because we threw before the WorkOrder update.
      expect(financialPosting.postJournalEntryInTx).not.toHaveBeenCalled();
      // The work order should NOT be transitioned to COMPLETED.
      expect(tx.workOrder.update).not.toHaveBeenCalled();
    });

    it('يتابع الإكمال إذا وُجد QualityCheck واحد على الأقل (لا يرمي)', async () => {
      tx.qualityCheck.count.mockResolvedValue(1);
      tx.warehouse.findFirst.mockResolvedValue({
        id: 'wh-fg',
        code: 'WH-FG',
        type: 'FINISHED_GOODS',
        isActive: true,
      });
      tx.productionMaterialConsumption.findMany.mockResolvedValue([
        {
          id: 'cons-1',
          totalCost: new Prisma.Decimal(500),
          wasteCost: new Prisma.Decimal(0),
        },
      ]);
      tx.productionCostSnapshot.upsert.mockResolvedValue({});
      tx.$executeRaw.mockResolvedValue({});
      tx.finishedGoodStock.findUniqueOrThrow.mockResolvedValue({
        id: 'fgs-1',
        quantity: 10,
        unitCost: new Prisma.Decimal(50),
      });
      tx.stockLedgerEntry.create.mockResolvedValue({});
      tx.workOrder.update.mockResolvedValue({});

      // Should NOT throw on the QC check itself.
      await service.recordStageOutput({
        workOrderId: 'wo-1',
        stage: ProductionStage.PACKING,
        inputQty: 10,
        acceptedQty: 10,
        rejectedQty: 0,
        wasteQty: 0,
      });

      // OPS-F05: at least one QC was required — verify it was queried.
      expect(tx.qualityCheck.count).toHaveBeenCalledWith({
        where: { workOrderId: 'wo-1' },
      });
    });
  });

  // ====== ACC-F01 / OPS-F01: GL posting on WorkOrder COMPLETED ======

  describe('ACC-F01 / OPS-F01 — قيد GL مزدوج عند إكمال أمر التشغيل', () => {
    beforeEach(() => {
      tx.productionStageRun.findUnique.mockResolvedValue({
        id: 'run-1',
        stage: ProductionStage.PACKING,
        status: ProductionStageRunStatus.IN_PROGRESS,
        workOrder: {
          currentStage: ProductionStage.PACKING,
          productVariantId: 'v-1',
          code: 'WO-001',
          status: WorkOrderStatus.IN_PROGRESS,
        },
      });
      tx.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
      tx.productionStageRun.update.mockResolvedValue({});
      tx.activityLog.create.mockResolvedValue({});
      tx.qualityCheck.count.mockResolvedValue(1);
      tx.warehouse.findFirst.mockResolvedValue({
        id: 'wh-fg',
        code: 'WH-FG',
        type: 'FINISHED_GOODS',
        isActive: true,
      });
      tx.productionMaterialConsumption.findMany.mockResolvedValue([
        {
          id: 'cons-1',
          totalCost: new Prisma.Decimal(500),
          wasteCost: new Prisma.Decimal(0),
        },
      ]);
      tx.productionCostSnapshot.upsert.mockResolvedValue({});
      tx.$executeRaw.mockResolvedValue({});
      tx.finishedGoodStock.findUniqueOrThrow.mockResolvedValue({
        id: 'fgs-1',
        quantity: 10,
        unitCost: new Prisma.Decimal(50),
      });
      tx.stockLedgerEntry.create.mockResolvedValue({});
      tx.workOrder.update.mockResolvedValue({});
    });

    it('ينشر قيد GL (Dr FINISHED_GOOD_STOCK / Cr WIP) عند إكمال PACKING', async () => {
      await service.recordStageOutput({
        workOrderId: 'wo-1',
        stage: ProductionStage.PACKING,
        inputQty: 10,
        acceptedQty: 10,
        rejectedQty: 0,
        wasteQty: 0,
      });

      // Verify the GL posting was called with the right debit/credit accounts
      // and the right amount (= total material cost).
      expect(financialPosting.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const [txClient, input, userId] =
        financialPosting.postJournalEntryInTx.mock.calls[0];
      expect(txClient).toBe(tx);
      expect(input.description).toBe('ترحيل إنتاج تام من أمر تشغيل #WO-001');
      expect(input.reference).toBe('WO-001');
      expect(input.postingKey).toBe('production-completion:wo-1');
      expect(input.isAuto).toBe(true);
      expect(input.lines).toHaveLength(1);
      expect(input.lines[0].debitAccountId).toBe(
        CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK,
      );
      expect(input.lines[0].creditAccountId).toBe(CHART_OF_ACCOUNTS.WIP);
      // materialCost = 500 (sum of consumptions' totalCost)
      expect(input.lines[0].amount).toBe(500);
      // Metadata carries audit trail of the source.
      expect(input.metadata).toMatchObject({
        source: 'production.completion',
        workOrderId: 'wo-1',
        acceptedQty: 10,
      });
      expect(userId).toBeUndefined();
    });

    it('لا ينشر قيدًا لو كانت الحركة ليست PACKING (مرحلة وسطية)', async () => {
      // Re-mock stageRun for a non-PACKING stage.
      tx.productionStageRun.findUnique.mockResolvedValue({
        id: 'run-cut',
        stage: ProductionStage.CUTTING,
        status: ProductionStageRunStatus.IN_PROGRESS,
        workOrder: {
          currentStage: ProductionStage.CUTTING,
          productVariantId: 'v-1',
          code: 'WO-001',
          status: WorkOrderStatus.IN_PROGRESS,
        },
      });

      await service.recordStageOutput({
        workOrderId: 'wo-1',
        stage: ProductionStage.CUTTING,
        inputQty: 10,
        acceptedQty: 10,
        rejectedQty: 0,
        wasteQty: 0,
      });

      // No GL posting fired for non-PACKING stages.
      expect(financialPosting.postJournalEntryInTx).not.toHaveBeenCalled();
      // The work order should NOT be transitioned to COMPLETED.
      expect(tx.workOrder.update).not.toHaveBeenCalled();
    });

    it('لا ينشر قيدًا لو acceptedQty = 0 (PACKING بلا إنتاج مقبول)', async () => {
      await service.recordStageOutput({
        workOrderId: 'wo-1',
        stage: ProductionStage.PACKING,
        inputQty: 10,
        acceptedQty: 0,
        rejectedQty: 10,
        wasteQty: 0,
      });

      // acceptedQty=0 short-circuits before the GL posting block.
      expect(financialPosting.postJournalEntryInTx).not.toHaveBeenCalled();
      // The work order should NOT be transitioned to COMPLETED in that path.
      expect(tx.workOrder.update).not.toHaveBeenCalled();
    });

    it('يستخدم postingKey ثابت `production-completion:${workOrderId}` للـ idempotency', async () => {
      await service.recordStageOutput({
        workOrderId: 'wo-42',
        stage: ProductionStage.PACKING,
        inputQty: 10,
        acceptedQty: 10,
        rejectedQty: 0,
        wasteQty: 0,
      });

      const callInput = financialPosting.postJournalEntryInTx.mock.calls[0][1];
      // postingKey tied to the workOrderId — calling again won't double-post
      // because FinancialPostingService rejects duplicates on this key.
      expect(callInput.postingKey).toBe('production-completion:wo-42');
    });

    it('يرفض الإكمال قبل إنشاء أي استهلاك للخامات (no consumptions)', async () => {
      tx.productionMaterialConsumption.findMany.mockResolvedValue([]);

      await expect(
        service.recordStageOutput({
          workOrderId: 'wo-1',
          stage: ProductionStage.PACKING,
          inputQty: 10,
          acceptedQty: 10,
          rejectedQty: 0,
          wasteQty: 0,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(financialPosting.postJournalEntryInTx).not.toHaveBeenCalled();
    });
  });
});
