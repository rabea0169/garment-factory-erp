/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars */
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Prisma,
  ProductionCostStatus,
  ProductionStage,
  ProductionStageRunStatus,
  WorkOrderStatus,
} from '@prisma/client';
import * as crypto from 'node:crypto';
import { ProductionWorkflowService } from './production-workflow.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createEventEmitterMock,
  createPrismaMock,
} from '../../../test/helpers/prisma-mock';

/**
 * ACC-F01 / OPS-F01 / OPS-F03 / OPS-F05 — اختبارات سير الإنتاج.
 *
 * النمط: نُنشئ mock لـ PrismaService وInventoryService وFinancialPostingService،
 * ثم نُمررهم إلى ProductionWorkflowService. الـ transaction تُحاكى عبر
 * `$transaction` يُرجع نتيجة استدعاء الـ callback بنفس الـ prisma mock.
 */

function createTxMock(prisma: ReturnType<typeof createPrismaMock>) {
  // نعيد استخدام نفس الـ mocks للقراءة والكتابة داخل الـ transaction.
  return prisma;
}

function makeService() {
  const prisma = createPrismaMock();
  const eventEmitter = createEventEmitterMock();
  const inventory = {
    issue: jest.fn(),
    receiveFinishedGood: jest.fn(),
    issueFinishedGood: jest.fn(),
  } as unknown as InventoryService;
  const postJournalEntryInTx = jest.fn().mockResolvedValue({
    entryId: 'je-1',
    entryCode: 'JE-TEST-1',
    totalDebit: 0,
    totalCredit: 0,
    linesCount: 1,
    createdAt: new Date(),
  });
  const financial = {
    postJournalEntryInTx,
  } as unknown as FinancialPostingService;

  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(createTxMock(prisma)),
  );

  const service = new ProductionWorkflowService(
    prisma as unknown as PrismaService,
    inventory,
    financial,
  );

  return {
    prisma: prisma,
    inventory,
    postJournalEntryInTx,
    service,
  };
}

const WORK_ORDER_CODE = 'WO-20260101-ABCD1234';

describe('ProductionWorkflowService — ACC-F01 / OPS-F01 / OPS-F03 / OPS-F05', () => {
  it('OPS-F03: يرفض تسجيل إنتاج على أمر تشغيل CANCELLED', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.CANCELLED,
    });

    await expect(
      service.recordStageOutput({
        workOrderId: 'wo-1',
        stage: ProductionStage.PACKING,
        inputQty: 10,
        acceptedQty: 8,
        rejectedQty: 1,
        wasteQty: 1,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('OPS-F03: يرفض تسجيل إنتاج على أمر تشغيل COMPLETED', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.COMPLETED,
    });

    await expect(
      service.recordStageOutput({
        workOrderId: 'wo-1',
        stage: ProductionStage.PACKING,
        inputQty: 10,
        acceptedQty: 8,
        rejectedQty: 1,
        wasteQty: 1,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('OPS-F05: يرفض إكمال أمر تشغيل دون فحص جودة موثَّق', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    // أمر التشغيل نشط (PLANNED)
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.IN_PROGRESS,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.productionStageRun.findUnique.mockResolvedValue({
      id: 'srun-1',
      stage: ProductionStage.PACKING,
      status: ProductionStageRunStatus.IN_PROGRESS,
      workOrder: {
        currentStage: ProductionStage.PACKING,
        productVariantId: 'v-1',
        code: WORK_ORDER_CODE,
        status: WorkOrderStatus.IN_PROGRESS,
      },
    });
    prisma.productionStageRun.update.mockResolvedValue({});
    prisma.activityLog.create.mockResolvedValue({});
    // لا يوجد فحص جودة على الإطلاق
    prisma.qualityCheck.count.mockResolvedValue(0);

    await expect(
      service.recordStageOutput({
        workOrderId: 'wo-1',
        stage: ProductionStage.PACKING,
        inputQty: 10,
        acceptedQty: 8,
        rejectedQty: 1,
        wasteQty: 1,
      }),
    ).rejects.toThrow(BadRequestException);

    // لم يصل إلى قيد GL ولا إلى تحديث حالة الـ WorkOrder إلى COMPLETED.
    expect(prisma.workOrder.update).not.toHaveBeenCalled();
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('ACC-F01: يرحّل قيد GL عند إكمال PACKING (Dr FINISHED_GOOD_STOCK / Cr WIP)', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.IN_PROGRESS,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.productionStageRun.findUnique.mockResolvedValue({
      id: 'srun-1',
      stage: ProductionStage.PACKING,
      status: ProductionStageRunStatus.IN_PROGRESS,
      workOrder: {
        currentStage: ProductionStage.PACKING,
        productVariantId: 'v-1',
        code: WORK_ORDER_CODE,
        status: WorkOrderStatus.IN_PROGRESS,
      },
    });
    prisma.productionStageRun.update.mockResolvedValue({});
    prisma.activityLog.create.mockResolvedValue({});
    prisma.qualityCheck.count.mockResolvedValue(2); // QC موجود
    prisma.warehouse.findFirst.mockResolvedValue({
      id: 'wh-fg',
      code: 'WH-FG',
      type: 'FINISHED_GOODS',
      isActive: true,
    });
    prisma.productionMaterialConsumption.findMany.mockResolvedValue([
      {
        id: 'cons-1',
        totalCost: new Prisma.Decimal(100),
        wasteCost: new Prisma.Decimal(0),
      },
      {
        id: 'cons-2',
        totalCost: new Prisma.Decimal(50.5),
        wasteCost: new Prisma.Decimal(0),
      },
    ]);
    prisma.productionCostSnapshot.upsert.mockResolvedValue({});
    prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    prisma.finishedGoodStock.findUniqueOrThrow.mockResolvedValue({
      quantity: 8,
      unitCost: new Prisma.Decimal(18.8125),
    });
    prisma.stockLedgerEntry.create.mockResolvedValue({});
    prisma.workOrder.update.mockResolvedValue({});

    await service.recordStageOutput({
      workOrderId: 'wo-1',
      stage: ProductionStage.PACKING,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
    });

    // تحديث حالة أمر التشغيل إلى COMPLETED
    expect(prisma.workOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wo-1' },
        data: expect.objectContaining({
          status: WorkOrderStatus.COMPLETED,
          completedQty: { increment: 8 },
        }),
      }),
    );

    // قيد GL بقيمة الخامات المُستهلكة (100 + 50.5 = 150.5)
    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
    const [txArg, inputArg, userIdArg] = postJournalEntryInTx.mock
      .calls[0] as unknown as [
      unknown,
      {
        description: string;
        reference: string;
        postingKey: string;
        isAuto: boolean;
        lines: {
          debitAccountId: string;
          creditAccountId: string;
          amount: number;
          description: string;
        }[];
        metadata: { source: string; workOrderId: string; acceptedQty: number };
      },
      string | undefined,
    ];
    expect(inputArg.postingKey).toBe('production-completion:wo-1');
    expect(inputArg.reference).toBe(WORK_ORDER_CODE);
    expect(inputArg.isAuto).toBe(true);
    expect(inputArg.lines[0].debitAccountId).toBe(
      CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK,
    );
    expect(inputArg.lines[0].creditAccountId).toBe(CHART_OF_ACCOUNTS.WIP);
    expect(inputArg.lines[0].amount).toBeCloseTo(150.5, 2);
    expect(inputArg.metadata).toEqual({
      source: 'production.completion',
      workOrderId: 'wo-1',
      acceptedQty: 8,
    });
    expect(userIdArg).toBeUndefined();
    // الـ tx المُمرّر هو نفسه عميل الـ transaction
    expect(txArg).toBeTruthy();
  });

  it('ACC-F01: لا يرحّل قيد GL عند acceptedQty=0 (لا إنتاج لترحيل)', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.IN_PROGRESS,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.productionStageRun.findUnique.mockResolvedValue({
      id: 'srun-1',
      stage: ProductionStage.PACKING,
      status: ProductionStageRunStatus.IN_PROGRESS,
      workOrder: {
        currentStage: ProductionStage.PACKING,
        productVariantId: 'v-1',
        code: WORK_ORDER_CODE,
        status: WorkOrderStatus.IN_PROGRESS,
      },
    });
    prisma.productionStageRun.update.mockResolvedValue({});
    prisma.activityLog.create.mockResolvedValue({});

    // acceptedQty = 0 → خروج مبكر قبل فحص QC والقيد
    const result = await service.recordStageOutput({
      workOrderId: 'wo-1',
      stage: ProductionStage.PACKING,
      inputQty: 5,
      acceptedQty: 0,
      rejectedQty: 5,
      wasteQty: 0,
    });

    expect(result.replayed).toBe(false);
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
    expect(prisma.qualityCheck.count).not.toHaveBeenCalled();
    expect(prisma.workOrder.update).not.toHaveBeenCalled();
  });

  it('ACC-F01: postingKey مستقر يعتمد فقط على workOrderId (idempotency)', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-stable',
      status: WorkOrderStatus.IN_PROGRESS,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-stable' });
    prisma.productionStageRun.findUnique.mockResolvedValue({
      id: 'srun-1',
      stage: ProductionStage.PACKING,
      status: ProductionStageRunStatus.IN_PROGRESS,
      workOrder: {
        currentStage: ProductionStage.PACKING,
        productVariantId: 'v-1',
        code: WORK_ORDER_CODE,
        status: WorkOrderStatus.IN_PROGRESS,
      },
    });
    prisma.productionStageRun.update.mockResolvedValue({});
    prisma.activityLog.create.mockResolvedValue({});
    prisma.qualityCheck.count.mockResolvedValue(1);
    prisma.warehouse.findFirst.mockResolvedValue({
      id: 'wh-fg',
      code: 'WH-FG',
      type: 'FINISHED_GOODS',
      isActive: true,
    });
    prisma.productionMaterialConsumption.findMany.mockResolvedValue([
      {
        id: 'cons-1',
        totalCost: new Prisma.Decimal(200),
        wasteCost: new Prisma.Decimal(0),
      },
    ]);
    prisma.productionCostSnapshot.upsert.mockResolvedValue({});
    prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    prisma.finishedGoodStock.findUniqueOrThrow.mockResolvedValue({
      quantity: 5,
      unitCost: new Prisma.Decimal(40),
    });
    prisma.stockLedgerEntry.create.mockResolvedValue({});
    prisma.workOrder.update.mockResolvedValue({});

    // الاستدعاء الأول
    await service.recordStageOutput({
      workOrderId: 'wo-stable',
      stage: ProductionStage.PACKING,
      inputQty: 5,
      acceptedQty: 5,
      rejectedQty: 0,
      wasteQty: 0,
    });
    // الاستدعاء الثاني بنفس المدخلات (محاكاة إعادة محاولة)
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-stable-2' });
    await service.recordStageOutput({
      workOrderId: 'wo-stable',
      stage: ProductionStage.PACKING,
      inputQty: 5,
      acceptedQty: 5,
      rejectedQty: 0,
      wasteQty: 0,
    });

    // كلا الاستدعاءين استخدم نفس postingKey المستقر
    const keys = postJournalEntryInTx.mock.calls.map(
      (c: any) => c[1].postingKey,
    );
    expect(keys).toEqual([
      'production-completion:wo-stable',
      'production-completion:wo-stable',
    ]);
    // نفس postingKey على الاستدعاءين — يضمن عدم الترحيل المزدوج في GL عبر
    // الـ unique constraint على JournalEntry.postingKey.
    expect(postJournalEntryInTx).toHaveBeenCalledTimes(2);
  });

  it('OPS-F01: يرفض إكمال PACKING بلا استهلاك خامات (BadRequestException)', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.IN_PROGRESS,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.productionStageRun.findUnique.mockResolvedValue({
      id: 'srun-1',
      stage: ProductionStage.PACKING,
      status: ProductionStageRunStatus.IN_PROGRESS,
      workOrder: {
        currentStage: ProductionStage.PACKING,
        productVariantId: 'v-1',
        code: WORK_ORDER_CODE,
        status: WorkOrderStatus.IN_PROGRESS,
      },
    });
    prisma.productionStageRun.update.mockResolvedValue({});
    prisma.activityLog.create.mockResolvedValue({});
    prisma.qualityCheck.count.mockResolvedValue(3);
    prisma.warehouse.findFirst.mockResolvedValue({
      id: 'wh-fg',
      code: 'WH-FG',
      type: 'FINISHED_GOODS',
      isActive: true,
    });
    // لا استهلاك خامات على الإطلاق
    prisma.productionMaterialConsumption.findMany.mockResolvedValue([]);

    await expect(
      service.recordStageOutput({
        workOrderId: 'wo-1',
        stage: ProductionStage.PACKING,
        inputQty: 5,
        acceptedQty: 5,
        rejectedQty: 0,
        wasteQty: 0,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(postJournalEntryInTx).not.toHaveBeenCalled();
    expect(prisma.workOrder.update).not.toHaveBeenCalled();
  });

  it('idempotency replay: يُرجع الاستجابة المخزّنة دون تنفيذ القيد من جديد', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.IN_PROGRESS,
    });
    // productionStageRun مرتبط بالـ idempotencyKey ومُكتمل
    const input = {
      workOrderId: 'wo-1',
      stage: ProductionStage.PACKING,
      inputQty: 5,
      acceptedQty: 5,
      rejectedQty: 0,
      wasteQty: 0,
      idempotencyKey: 'replay-key',
    };
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      id: 'idem-replay',
      scope: 'production.stage-output',
      requestHash: hash,
    });
    prisma.productionStageRun.findUnique.mockResolvedValue({
      id: 'srun-1',
      stage: ProductionStage.PACKING,
      status: ProductionStageRunStatus.COMPLETED,
      workOrderId: 'wo-1',
    });

    const result = await service.recordStageOutput(input, 'user-1');

    expect(result.replayed).toBe(true);
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ConflictException عند تكرار idempotencyKey بمحتوى مختلف', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    const input1 = {
      workOrderId: 'wo-1',
      stage: ProductionStage.PACKING,
      inputQty: 5,
      acceptedQty: 5,
      rejectedQty: 0,
      wasteQty: 0,
      idempotencyKey: 'shared-key',
    };
    // نفس المفتاح لكن requestHash مختلف (محتوى مختلف)
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      id: 'idem-prev',
      scope: 'production.stage-output',
      requestHash: 'different-hash',
    });

    await expect(service.recordStageOutput(input1)).rejects.toThrow(
      ConflictException,
    );
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
  });
});

/**
 * ملاحظة على إخفاء التفاصيل: الـ productionCostSnapshot.upsert يستخدم enum
 * ProductionCostStatus.FINALIZED — نُمرره في الـ mock بشكل غير ضروري لأن
 * الـ service يستدعيه بنفس الشكل.
 */
void ProductionCostStatus;
