/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
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
import { EVENTS } from '../../events/event-types';

/**
 * ACC-F01 / OPS-F01 / OPS-F03 / OPS-F05 — اختبارات سير الإنتاج.
 *
 * النمط: نُنشئ mock لـ PrismaService وInventoryService وFinancialPostingService،
 * ثم نُمررهم إلى ProductionWorkflowService. الـ transaction تُحاكى عبر
 * `$transaction` يُرجع نتيجة استدعاء الـ callback بنفس الـ prisma mock.
 */

function createTxMock<T>(prisma: T): T {
  // نعيد استخدام نفس الـ mocks للقراءة والكتابة داخل الـ transaction.
  return prisma;
}

/**
 * مواصفة موسّعة محليًا (نمط inventory.service.spec): consumeMaterial يقرأ
 * stockLedgerEntry.findUnique وproductionMaterialConsumption (findUnique
 * لإعادة التشغيل) — نضيفها فوق المصنع المشترك دون تعديله.
 */
type WorkflowPrismaMock = ReturnType<typeof createPrismaMock> & {
  stockLedgerEntry: {
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
  };
  productionMaterialConsumption: {
    findMany: jest.Mock;
    create: jest.Mock;
    aggregate: jest.Mock;
    findUnique: jest.Mock;
  };
};

function createWorkflowPrismaMock(): WorkflowPrismaMock {
  return {
    ...createPrismaMock(),
    stockLedgerEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    productionMaterialConsumption: {
      findMany: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
      findUnique: jest.fn(),
    },
  };
}

function makeService() {
  const prisma = createWorkflowPrismaMock();
  const eventEmitter = createEventEmitterMock() as unknown as {
    emitAsync: jest.Mock;
  };
  const issue = jest.fn();
  const inventory = {
    issue,
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
    eventEmitter as never,
  );

  return {
    prisma: prisma,
    inventory,
    issue,
    postJournalEntryInTx,
    eventEmitter,
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
 * PRD-1 / INV-1 — صرف المواد (consumeMaterial):
 * - PRD-1: صرف على أمر مكتمل/ملغي مرفوض بـ 400 (يضيف تكلفة بعد قيد الإكمال).
 * - INV-1: أحداث المخزون تُبث بعد نجاح المعاملة فقط (لا أحداث وهمية عند الفشل).
 */
describe('ProductionWorkflowService — PRD-1 / INV-1 (consumeMaterial)', () => {
  const STAGE_RUN = {
    id: 'srun-1',
    workOrderId: 'wo-1',
    stage: ProductionStage.CUTTING,
    status: ProductionStageRunStatus.IN_PROGRESS,
  };

  const INVENTORY_ISSUE_RESULT = {
    replayed: false,
    entryCode: 'SLE-20260905-TEST0001',
    type: 'ISSUE',
    rawMaterialId: 'rm-1',
    warehouseId: 'wh-1',
    quantityDelta: -4,
    balanceAfter: 96,
    unitCost: 5,
    totalValue: 20,
    costPerUnitAfter: null,
    createdAt: '2026-09-05T10:00:00.000Z',
  };

  const consumeInput = () => ({
    workOrderId: 'wo-1',
    stageRunId: 'srun-1',
    rawMaterialId: 'rm-1',
    warehouseId: 'wh-1',
    plannedQuantity: 3,
    actualQuantity: 4,
    wasteQuantity: 1,
    unit: 'METER',
  });

  /** يجهّز مسار النجاح الكامل للصرف (أمر IN_PROGRESS). */
  function setupHappyPath(prisma: WorkflowPrismaMock, issue: jest.Mock) {
    prisma.productionStageRun.findUnique.mockResolvedValue(STAGE_RUN);
    prisma.workOrder.findUnique.mockResolvedValue({
      status: WorkOrderStatus.IN_PROGRESS,
    });
    prisma.stockLedgerEntry.findUnique.mockResolvedValue({ id: 'sle-1' });
    prisma.productionMaterialConsumption.create.mockResolvedValue({
      id: 'cons-1',
      workOrderId: 'wo-1',
      stageRunId: 'srun-1',
    });
    issue.mockResolvedValue(INVENTORY_ISSUE_RESULT);
  }

  it('PRD-1: يرفض صرف المواد على أمر تشغيل COMPLETED بـ 400', async () => {
    const { prisma, issue, service } = makeService();
    prisma.productionStageRun.findUnique.mockResolvedValue(STAGE_RUN);
    prisma.workOrder.findUnique.mockResolvedValue({
      status: WorkOrderStatus.COMPLETED,
    });

    await expect(
      service.consumeMaterial(consumeInput(), 'user-1'),
    ).rejects.toThrow(BadRequestException);

    // الرفض قبل أي أثر: لا صرف مخزون ولا سجل استهلاك
    expect(issue).not.toHaveBeenCalled();
    expect(prisma.productionMaterialConsumption.create).not.toHaveBeenCalled();
  });

  it('PRD-1: يرفض صرف المواد على أمر تشغيل CANCELLED بـ 400', async () => {
    const { prisma, issue, service } = makeService();
    prisma.productionStageRun.findUnique.mockResolvedValue(STAGE_RUN);
    prisma.workOrder.findUnique.mockResolvedValue({
      status: WorkOrderStatus.CANCELLED,
    });

    await expect(
      service.consumeMaterial(consumeInput(), 'user-1'),
    ).rejects.toThrow(BadRequestException);

    expect(issue).not.toHaveBeenCalled();
    expect(prisma.productionMaterialConsumption.create).not.toHaveBeenCalled();
  });

  it('PRD-1: الصرف على أمر IN_PROGRESS ينجح (السلوك القائم بلا انحدار)', async () => {
    const { prisma, issue, service } = makeService();
    setupHappyPath(prisma, issue);

    const result = await service.consumeMaterial(consumeInput(), 'user-1');

    expect(result.replayed).toBe(false);
    expect(result.consumptionId).toBe('cons-1');
    expect(result.stockLedgerEntryId).toBe('sle-1');
    expect(result.actualQuantity).toBe(4);
    expect(result.wasteQuantity).toBe(1);
    expect(result.unitCost).toBe(5);
    expect(result.totalCost).toBe(20);
    expect(result.wasteCost).toBe(5);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(prisma.workOrder.findUnique).toHaveBeenCalledWith({
      where: { id: 'wo-1' },
      select: { status: true },
    });
  });

  it('INV-1: يبث أحداث المخزون بعد نجاح المعاملة فقط وبعد الصرف نفسه', async () => {
    const { prisma, issue, service, eventEmitter } = makeService();
    setupHappyPath(prisma, issue);
    // inventory.issue يملأ المجمع (الوسيط الرابع) كما تفعل الخدمة الفعلية بعد INV-1
    issue.mockImplementation(
      (
        _input: unknown,
        _userId: unknown,
        _tx: unknown,
        eventsCollector: { push: (event: unknown) => void } | undefined,
      ) => {
        eventsCollector?.push({
          name: EVENTS.STOCK_DEDUCTED,
          payload: {
            materialId: 'rm-1',
            warehouseId: 'wh-1',
            quantity: 4,
            newStock: 96,
          },
        });
        return INVENTORY_ISSUE_RESULT;
      },
    );

    await service.consumeMaterial(consumeInput(), 'user-1');

    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(EVENTS.STOCK_DEDUCTED, {
      materialId: 'rm-1',
      warehouseId: 'wh-1',
      quantity: 4,
      newStock: 96,
    });
    // الترتيب: الصرف داخل المعاملة يسبق البث — البث بعد commit لا قبله
    const issueOrder = issue.mock.invocationCallOrder[0];
    const emitOrder = eventEmitter.emitAsync.mock.invocationCallOrder[0];
    expect(emitOrder).toBeGreaterThan(issueOrder);
  });

  it('INV-1: فشل المعاملة = لا بث لأي حدث مخزون', async () => {
    const { prisma, issue, service, eventEmitter } = makeService();
    setupHappyPath(prisma, issue);
    issue.mockImplementation(
      (
        _input: unknown,
        _userId: unknown,
        _tx: unknown,
        eventsCollector: { push: (event: unknown) => void } | undefined,
      ) => {
        eventsCollector?.push({
          name: EVENTS.STOCK_DEDUCTED,
          payload: {
            materialId: 'rm-1',
            warehouseId: 'wh-1',
            quantity: 4,
            newStock: 96,
          },
        });
        return INVENTORY_ISSUE_RESULT;
      },
    );
    // فشل داخل المعاملة بعد الصرف: ledger entry غير موجود
    prisma.stockLedgerEntry.findUnique.mockResolvedValue(null);

    await expect(
      service.consumeMaterial(consumeInput(), 'user-1'),
    ).rejects.toThrow(ConflictException);

    // فشل المعاملة = لا أحداث وهمية لحركة رُجعت
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });
});

/**
 * ملاحظة على إخفاء التفاصيل: الـ productionCostSnapshot.upsert يستخدم enum
 * ProductionCostStatus.FINALIZED — نُمرره في الـ mock بشكل غير ضروري لأن
 * الـ service يستدعيه بنفس الشكل.
 */
void ProductionCostStatus;
