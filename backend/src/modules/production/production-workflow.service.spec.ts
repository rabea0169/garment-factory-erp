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
 * لإعادة التشغيل)، وfinalizeCost يقرأ productionStageRun.findMany —
 * نضيفها فوق المصنع المشترك دون تعديله.
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
  productionStageRun: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
  };
};

function createWorkflowPrismaMock(): WorkflowPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
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
      count: jest.fn(),
    },
    productionStageRun: {
      ...base.productionStageRun,
      findMany: jest.fn(),
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
          amount: number | Prisma.Decimal;
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
    // PRD-5: المبلغ يصل Prisma.Decimal كما هو (بلا toNumber) — القيمة
    // الدقيقة 150.5 دون تحلل عائم في سلسلة الترحيل.
    expect(Prisma.Decimal.isDecimal(inputArg.lines[0].amount)).toBe(true);
    expect((inputArg.lines[0].amount as Prisma.Decimal).eq(150.5)).toBe(true);
    expect((inputArg.lines[0].amount as Prisma.Decimal).toString()).toBe(
      '150.5',
    );
    expect(inputArg.metadata).toEqual({
      source: 'production.completion',
      workOrderId: 'wo-1',
      acceptedQty: 8,
    });
    expect(userIdArg).toBeUndefined();
    // الـ tx المُمرّر هو نفسه عميل الـ transaction
    expect(txArg).toBeTruthy();
  });

  it('PRD-4: تغليف بـ acceptedQty=0 يكمل الأمر بكمية صفرية — لا يبقى IN_PROGRESS', async () => {
    const { prisma, service, postJournalEntryInTx } = makeService();
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.IN_PROGRESS,
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
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
    // فحص الجودة موثّق واستهلاك الخامات موجود — بوابات الإكمال القائمة
    prisma.qualityCheck.count.mockResolvedValue(2);
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
    ]);
    prisma.productionCostSnapshot.upsert.mockResolvedValue({});
    prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    prisma.finishedGoodStock.findUniqueOrThrow.mockResolvedValue({
      quantity: 0,
      unitCost: new Prisma.Decimal(0),
    });
    prisma.stockLedgerEntry.create.mockResolvedValue({});
    prisma.workOrder.update.mockResolvedValue({});

    const result = await service.recordStageOutput({
      workOrderId: 'wo-1',
      stage: ProductionStage.PACKING,
      inputQty: 5,
      acceptedQty: 0,
      rejectedQty: 5,
      wasteQty: 0,
    });

    // المرحلة اكتملت والنتيجة موثقة
    expect(result.replayed).toBe(false);
    expect(result.status).toBe(ProductionStageRunStatus.COMPLETED);
    // الأمر يكتمل COMPLETED بكمية صفرية — لا يعلق IN_PROGRESS
    expect(prisma.workOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wo-1' },
        data: expect.objectContaining({
          status: WorkOrderStatus.COMPLETED,
          completedQty: { increment: 0 },
          rejectedQty: { increment: 5 },
        }),
      }),
    );
    // لقطة التكلفة: acceptedQty=0 و unitCost=0 (لا قسمة على صفر) مع بقاء
    // تكلفة الخامات في اللقطة للسجل
    expect(prisma.productionCostSnapshot.upsert).toHaveBeenCalledTimes(1);
    type SnapshotUpsertArgs = {
      where: { workOrderId_status: { workOrderId: string; status: string } };
      create: {
        acceptedQty: number;
        unitCost: Prisma.Decimal;
        materialCost: Prisma.Decimal;
      };
    };
    const snapshotArgs = (
      prisma.productionCostSnapshot.upsert.mock
        .calls as unknown as SnapshotUpsertArgs[][]
    )[0][0];
    expect(snapshotArgs.where.workOrderId_status).toEqual({
      workOrderId: 'wo-1',
      status: ProductionCostStatus.FINALIZED,
    });
    expect(snapshotArgs.create.acceptedQty).toBe(0);
    expect(Prisma.Decimal.isDecimal(snapshotArgs.create.unitCost)).toBe(true);
    expect(snapshotArgs.create.unitCost.eq(0)).toBe(true);
    expect(snapshotArgs.create.materialCost.eq(100)).toBe(true);
    // حركة مخزون المنتج التام بكمية صفر (توثيق الإنتاجية الصفرية)
    expect(prisma.stockLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantityDelta: 0,
          totalValue: expect.any(Prisma.Decimal),
        }),
      }),
    );
    // بوابات الإكمال القائمة تُطبق — فحص الجودة يُعد
    expect(prisma.qualityCheck.count).toHaveBeenCalledWith({
      where: { workOrderId: 'wo-1' },
    });
    // لا قيد GL: لا بضاعة تام لترحيل تكلفة الخامات إليها (تبقى في WIP)
    expect(postJournalEntryInTx).not.toHaveBeenCalled();
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
      code: 'WO-0001',
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
      // P0 (audit-BE2): أُضيف code — قيد استهلاك الخامات الجديد يحتاج كود
      // أمر التشغيل في الوصف/المرجع.
      select: { status: true, code: true },
    });
  });

  it('ACC-F01 (audit-BE2 P0): استهلاك الخامات يرحّل قيد Dr WIP / Cr INVENTORY داخل المعاملة', async () => {
    // قبل إصلاح P0 كانت الدورة المشتراة تُنتج WIP دائنًا بلا مدين (سالبًا
    // دائمًا) وFG_STOCK بلا إنقاص عند البيع — هذا الاختبار يثبّت القيد
    // المصحح: كل استهلاك يحمّل WIP ويُنقص أصل المخزون بالقيمة نفسها.
    const { prisma, issue, service, postJournalEntryInTx } = makeService();
    setupHappyPath(prisma, issue);

    await service.consumeMaterial(consumeInput(), 'user-1');

    expect(postJournalEntryInTx).toHaveBeenCalledTimes(1);
    const [txArg, input, actorArg] = postJournalEntryInTx.mock.calls[0];
    expect(txArg).toBeDefined();
    expect(actorArg).toBe('user-1');
    expect(input.postingKey).toBe('production-consumption:cons-1');
    expect(input.lines).toEqual([
      {
        debitAccountId: CHART_OF_ACCOUNTS.WIP,
        creditAccountId: CHART_OF_ACCOUNTS.INVENTORY,
        amount: new Prisma.Decimal('20'),
        description: 'صرف خامات إلى تحت التشغيل — أمر تشغيل WO-0001',
      },
    ]);
    expect(input.metadata).toMatchObject({
      source: 'production.consumption',
      workOrderId: 'wo-1',
      stageRunId: 'srun-1',
      consumptionId: 'cons-1',
      rawMaterialId: 'rm-1',
    });
  });

  it('ACC-F01: استهلاك بتكلفة صفر لا يرحّل قيدًا (لا معنى لقيد بمبلغ 0)', async () => {
    const { prisma, issue, service, postJournalEntryInTx } = makeService();
    setupHappyPath(prisma, issue);
    // unitCost = 0 → totalCost = 0
    issue.mockResolvedValue({
      ...INVENTORY_ISSUE_RESULT,
      unitCost: 0,
      totalValue: 0,
    });

    await service.consumeMaterial(consumeInput(), 'user-1');

    expect(postJournalEntryInTx).not.toHaveBeenCalled();
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

/**
 * PRD-3 / PRD-9 — انتقال المراحل (transitionStage):
 * - PRD-9: مسارات سعيدة للتسلسل السليم (أول مرحلة ثم مرحلة تالية بعد اكتمال
 *   الحالية) ورفض قفز المراحل.
 * - PRD-3: قفل صف أمر العمل FOR UPDATE قبل القراءة، وخرق P2002 (قيد فريد
 *   على workOrderId+stage من انتقال متزامن بلا مفتاح) → 409 لا 500.
 */
describe('ProductionWorkflowService — PRD-3 / PRD-9 (transitionStage)', () => {
  it('PRD-9: ينجح بأول مرحلة (START → CUTTING) بتسلسل سليم', async () => {
    const { prisma, service } = makeService();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      code: WORK_ORDER_CODE,
      status: WorkOrderStatus.PLANNED,
      currentStage: null,
      quantity: 10,
      startDate: null,
    });
    prisma.productionStageRun.create.mockResolvedValue({ id: 'srun-cut-1' });
    prisma.workOrder.update.mockResolvedValue({ id: 'wo-1', stageVersion: 1 });
    prisma.workOrderStageTransition.create.mockResolvedValue({ id: 'trans-1' });

    const result = await service.transitionStage(
      { workOrderId: 'wo-1', toStage: ProductionStage.CUTTING },
      'actor-1',
    );

    expect(result.replayed).toBe(false);
    expect(result.transitionId).toBe('trans-1');
    expect(result.fromStage).toBeNull();
    expect(result.toStage).toBe(ProductionStage.CUTTING);
    expect(result.stageRunId).toBe('srun-cut-1');
    expect(result.stageVersion).toBe(1);

    // stage-run جديد للمرحلة الهدف بالتسلسل الصحيح
    expect(prisma.productionStageRun.create).toHaveBeenCalledWith({
      data: {
        workOrderId: 'wo-1',
        stage: ProductionStage.CUTTING,
        sequence: 1,
        status: ProductionStageRunStatus.IN_PROGRESS,
        plannedQty: 10,
        inputQty: 10,
      },
    });
    // أمر العمل يتحول إلى IN_PROGRESS على المرحلة الجديدة
    expect(prisma.workOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wo-1' },
        data: expect.objectContaining({
          currentStage: ProductionStage.CUTTING,
          status: WorkOrderStatus.IN_PROGRESS,
          stageVersion: { increment: 1 },
        }),
      }),
    );
    // سجل الانتقال بالفاعل كاملًا
    expect(prisma.workOrderStageTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workOrderId: 'wo-1',
        fromStage: null,
        toStage: ProductionStage.CUTTING,
        fromStatus: WorkOrderStatus.PLANNED,
        toStatus: WorkOrderStatus.IN_PROGRESS,
        actorId: 'actor-1',
      }),
    });
  });

  it('PRD-9: ينجح بمرحلة تالية (CUTTING → SEWING) بعد اكتمال المرحلة الحالية', async () => {
    const { prisma, service } = makeService();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      code: WORK_ORDER_CODE,
      status: WorkOrderStatus.IN_PROGRESS,
      currentStage: ProductionStage.CUTTING,
      quantity: 10,
      startDate: new Date('2026-09-06T00:00:00.000Z'),
    });
    // المرحلة الحالية مكتملة — شرط التقدم
    prisma.productionStageRun.findUnique.mockResolvedValue({
      id: 'srun-cut-1',
      status: ProductionStageRunStatus.COMPLETED,
    });
    prisma.productionStageRun.create.mockResolvedValue({ id: 'srun-sew-1' });
    prisma.workOrder.update.mockResolvedValue({ id: 'wo-1', stageVersion: 2 });
    prisma.workOrderStageTransition.create.mockResolvedValue({ id: 'trans-2' });

    const result = await service.transitionStage(
      { workOrderId: 'wo-1', toStage: ProductionStage.SEWING },
      'actor-1',
    );

    expect(result.fromStage).toBe(ProductionStage.CUTTING);
    expect(result.toStage).toBe(ProductionStage.SEWING);
    expect(result.stageRunId).toBe('srun-sew-1');
    // الانتقال يربط المرحلة المصدر والهدف
    expect(prisma.workOrderStageTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromRunId: 'srun-cut-1',
        toRunId: 'srun-sew-1',
        fromStage: ProductionStage.CUTTING,
        toStage: ProductionStage.SEWING,
      }),
    });
  });

  it('PRD-9: يرفض قفز المراحل (CUTTING → IRONING يتخطى SEWING)', async () => {
    const { prisma, service } = makeService();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      code: WORK_ORDER_CODE,
      status: WorkOrderStatus.IN_PROGRESS,
      currentStage: ProductionStage.CUTTING,
      quantity: 10,
      startDate: new Date('2026-09-06T00:00:00.000Z'),
    });

    await expect(
      service.transitionStage(
        { workOrderId: 'wo-1', toStage: ProductionStage.IRONING },
        'actor-1',
      ),
    ).rejects.toThrow('Invalid stage transition from CUTTING to IRONING');

    // لا stage-run جديد ولا تحديث لأمر العمل
    expect(prisma.productionStageRun.create).not.toHaveBeenCalled();
    expect(prisma.workOrder.update).not.toHaveBeenCalled();
  });

  it('PRD-3: يقفل صف أمر العمل (FOR UPDATE على work_orders) قبل قراءته', async () => {
    const { prisma, service } = makeService();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      code: WORK_ORDER_CODE,
      status: WorkOrderStatus.PLANNED,
      currentStage: null,
      quantity: 10,
      startDate: null,
    });
    prisma.productionStageRun.create.mockResolvedValue({ id: 'srun-cut-1' });
    prisma.workOrder.update.mockResolvedValue({ id: 'wo-1', stageVersion: 1 });
    prisma.workOrderStageTransition.create.mockResolvedValue({ id: 'trans-1' });

    await service.transitionStage(
      { workOrderId: 'wo-1', toStage: ProductionStage.CUTTING },
      'actor-1',
    );

    // القفل على الجدول الفعلي "work_orders" بمعرّف الأمر
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const lockSql = (
      prisma.$queryRaw.mock.calls as unknown as [Prisma.Sql][]
    )[0][0];
    expect(lockSql.sql).toContain('FROM work_orders');
    expect(lockSql.sql).toContain('FOR UPDATE');
    expect(lockSql.values).toEqual(['wo-1']);
    // القفل يسبق قراءة أمر العمل (لا قراءة ما قبل القفل)
    const lockOrder = prisma.$queryRaw.mock.invocationCallOrder[0];
    const readOrder = prisma.workOrder.findUnique.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(readOrder);
  });

  it('PRD-3: خرق P2002 خارج نطاق idempotency (انتقال متزامن بلا مفتاح) → 409 لا 500', async () => {
    const { prisma, service } = makeService();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      code: WORK_ORDER_CODE,
      status: WorkOrderStatus.PLANNED,
      currentStage: null,
      quantity: 10,
      startDate: null,
    });
    // انتقال متوازٍ فائز يسجل المرحلة نفسها — الخاسر يكسر القيد الفريد
    prisma.productionStageRun.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['workOrderId', 'stage'] },
    });

    await expect(
      service.transitionStage(
        { workOrderId: 'wo-1', toStage: ProductionStage.CUTTING },
        'actor-1',
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.transitionStage(
        { workOrderId: 'wo-1', toStage: ProductionStage.CUTTING },
        'actor-1',
      ),
    ).rejects.toThrow('انتقال مرحلة متزامن على نفس أمر التشغيل');
  });

  it('PRD-3: خرق P2002 مع مفتاح بلا استجابة ملزمة → 409 (بعد فشل replay)', async () => {
    const { prisma, service } = makeService();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      code: WORK_ORDER_CODE,
      status: WorkOrderStatus.PLANNED,
      currentStage: null,
      quantity: 10,
      startDate: null,
    });
    // المفتاح غير موجود بعد (لا replay متاح) والانتقال المتوازي يكسر الفريد
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.productionStageRun.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.transitionStage(
        {
          workOrderId: 'wo-1',
          toStage: ProductionStage.CUTTING,
          idempotencyKey: 'transition-key-1',
        },
        'actor-1',
      ),
    ).rejects.toThrow(ConflictException);
  });
});

/**
 * PRD-9 — finalizeCost: المسار السعيد بمبالغ Decimal على مفتاح upsert
 * مستقر (workOrderId, FINALIZED) — نفس نمط الطبيعي القائم.
 */
describe('ProductionWorkflowService — PRD-9 (finalizeCost)', () => {
  it('ينجح بمبالغ Decimal ومقسوم أحدث مرحلة مكتملة على مفتاح (workOrderId, FINALIZED)', async () => {
    const { prisma, service } = makeService();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.productionMaterialConsumption.findMany.mockResolvedValue([
      {
        id: 'cons-1',
        totalCost: new Prisma.Decimal(100),
        wasteCost: new Prisma.Decimal(5),
      },
      {
        id: 'cons-2',
        totalCost: new Prisma.Decimal(60),
        wasteCost: new Prisma.Decimal(0),
      },
    ]);
    prisma.productionStageRun.findMany.mockResolvedValue([
      {
        sequence: 1,
        status: ProductionStageRunStatus.COMPLETED,
        acceptedQty: 10,
      },
      {
        sequence: 2,
        status: ProductionStageRunStatus.COMPLETED,
        acceptedQty: 8,
      },
      {
        sequence: 3,
        status: ProductionStageRunStatus.IN_PROGRESS,
        acceptedQty: 4,
      },
    ]);
    prisma.productionCostSnapshot.upsert.mockResolvedValue({
      id: 'snap-1',
      workOrderId: 'wo-1',
      status: ProductionCostStatus.FINALIZED,
    });

    const result = await service.finalizeCost('wo-1', 'user-1');

    expect(result.id).toBe('snap-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // مفتاح upsert مستقر على (workOrderId, FINALIZED)
    expect(prisma.productionCostSnapshot.upsert).toHaveBeenCalledTimes(1);
    type FinalizeUpsertArgs = {
      where: {
        workOrderId_status: { workOrderId: string; status: string };
      };
      create: {
        materialCost: Prisma.Decimal;
        wasteCost: Prisma.Decimal;
        totalCost: Prisma.Decimal;
        acceptedQty: number;
        unitCost: Prisma.Decimal;
        createdById: string;
      };
    };
    const upsertArgs = (
      prisma.productionCostSnapshot.upsert.mock
        .calls as unknown as FinalizeUpsertArgs[][]
    )[0][0];
    expect(upsertArgs.where.workOrderId_status).toEqual({
      workOrderId: 'wo-1',
      status: ProductionCostStatus.FINALIZED,
    });
    // مبالغ Decimal دقيقة: 100 + 60 = 160، والمقسوم أحدث مرحلة مكتملة (8)
    expect(Prisma.Decimal.isDecimal(upsertArgs.create.materialCost)).toBe(true);
    expect(upsertArgs.create.materialCost.eq(160)).toBe(true);
    expect(upsertArgs.create.wasteCost.eq(5)).toBe(true);
    expect(upsertArgs.create.totalCost.eq(160)).toBe(true);
    expect(upsertArgs.create.acceptedQty).toBe(8);
    expect(upsertArgs.create.unitCost.eq(20)).toBe(true);
    expect(upsertArgs.create.createdById).toBe('user-1');
  });
});

/**
 * PRD-6 (GF-IMP-W3): استمرارية الكميات بين المراحل — مدخل المرحلة لا يتجاوز
 * مقبول السابقة. القرار: تحذير لاصق (Logger.warn + وسم في notes الـ StageRun)
 * لا رفض — الخطة تسمح بالخيارين والتحذير يبقي المسار التشغيلي مفتوحًا
 * ويوثّق الانحراف.
 */
describe('ProductionWorkflowService — PRD-6 (استمرارية كميات المراحل)', () => {
  const setupIroningRun = () => {
    const ctx = makeService();
    const { prisma } = ctx;
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.IN_PROGRESS,
    });
    // run المرحلة الحالية يُقرأ مرتين (قبل قفل الصف وبعده — نمط الانتقال
    // المسلسل)، ثم الاستدعاء الثالث هو فحص PRD-6 للمرحلة السابقة (SEWING).
    const ironingRun = {
      id: 'srun-iron',
      stage: ProductionStage.IRONING,
      status: ProductionStageRunStatus.IN_PROGRESS,
      workOrder: {
        currentStage: ProductionStage.IRONING,
        productVariantId: 'v-1',
        code: WORK_ORDER_CODE,
        status: WorkOrderStatus.IN_PROGRESS,
      },
    };
    prisma.productionStageRun.findUnique
      .mockResolvedValueOnce(ironingRun)
      .mockResolvedValueOnce(ironingRun);
    return ctx;
  };

  it('PRD-6: تجاوز inputQty لمقبول المرحلة السابقة يستدعي تحذيرًا ولا يرفض — والوسم يُخزّن في notes', async () => {
    const { prisma, service } = setupIroningRun();
    // الاستدعاء الثاني (PRD-6): run المرحلة السابقة (SEWING) بمقبول 90
    prisma.productionStageRun.findUnique.mockResolvedValueOnce({
      acceptedQty: 90,
    });
    prisma.productionStageRun.update.mockResolvedValue({});
    const warnSpy = jest.spyOn(
      (
        service as unknown as {
          logger: { warn: jest.Mock };
        }
      ).logger,
      'warn',
    );
    prisma.activityLog.create.mockResolvedValue({});

    const result = await service.recordStageOutput({
      workOrderId: 'wo-1',
      stage: ProductionStage.IRONING,
      inputQty: 110,
      acceptedQty: 100,
      rejectedQty: 5,
      wasteQty: 5,
      notes: 'كي الدفعة الثانية',
    });

    // التحذير لا الرفض: المرحلة تكتمل بنجاح
    expect(result).toMatchObject({
      replayed: false,
      status: ProductionStageRunStatus.COMPLETED,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('wo-1');
    expect(warnSpy.mock.calls[0][0]).toContain('110');
    expect(warnSpy.mock.calls[0][0]).toContain('90');
    // الوسم النصي يُخزّن في notes الـ StageRun مع وصف المستخدم — لا صمت
    const updateArgs = (
      prisma.productionStageRun.update.mock.calls as unknown as Array<
        [{ data: { notes?: string } }]
      >
    )[0]?.[0];
    expect(updateArgs?.data.notes).toContain('PRD-6');
    expect(updateArgs?.data.notes).toContain('110');
    expect(updateArgs?.data.notes).toContain('90');
    expect(updateArgs?.data.notes).toContain('كي الدفعة الثانية');
    // فحص المرحلة السابقة تم بمفتاح (workOrderId, stage=SEWING) — بعد
    // قراءتي run المرحلة الحالية (قبل القفل وبعده)
    expect(prisma.productionStageRun.findUnique).toHaveBeenNthCalledWith(3, {
      where: {
        workOrderId_stage: {
          workOrderId: 'wo-1',
          stage: ProductionStage.SEWING,
        },
      },
      select: { acceptedQty: true },
    });
  });

  it('PRD-6: بلا تجاوز (inputQty ≤ مقبول السابقة) — لا تحذير وnotes كما وردت', async () => {
    const { prisma, service } = setupIroningRun();
    prisma.productionStageRun.findUnique.mockResolvedValueOnce({
      acceptedQty: 90,
    });
    prisma.productionStageRun.update.mockResolvedValue({});
    const warnSpy = jest.spyOn(
      (
        service as unknown as {
          logger: { warn: jest.Mock };
        }
      ).logger,
      'warn',
    );
    prisma.activityLog.create.mockResolvedValue({});

    await service.recordStageOutput({
      workOrderId: 'wo-1',
      stage: ProductionStage.IRONING,
      inputQty: 90,
      acceptedQty: 85,
      rejectedQty: 3,
      wasteQty: 2,
      notes: 'ضمن الحدود',
    });

    expect(warnSpy).not.toHaveBeenCalled();
    const updateArgs = (
      prisma.productionStageRun.update.mock.calls as unknown as Array<
        [{ data: { notes?: string } }]
      >
    )[0]?.[0];
    expect(updateArgs?.data.notes).toBe('ضمن الحدود');
  });

  it('PRD-6: المرحلة الأولى (CUTTING) بلا سابقة — لا استعلام سابقة ولا تحذير', async () => {
    const { prisma, service } = makeService();
    const cuttingRun = {
      id: 'srun-cut',
      stage: ProductionStage.CUTTING,
      status: ProductionStageRunStatus.IN_PROGRESS,
      workOrder: {
        currentStage: ProductionStage.CUTTING,
        productVariantId: 'v-1',
        code: WORK_ORDER_CODE,
        status: WorkOrderStatus.IN_PROGRESS,
      },
    };
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.IN_PROGRESS,
    });
    prisma.productionStageRun.findUnique
      .mockResolvedValueOnce(cuttingRun)
      .mockResolvedValueOnce(cuttingRun);
    prisma.productionStageRun.update.mockResolvedValue({});
    const warnSpy = jest.spyOn(
      (
        service as unknown as {
          logger: { warn: jest.Mock };
        }
      ).logger,
      'warn',
    );
    prisma.activityLog.create.mockResolvedValue({});

    await service.recordStageOutput({
      workOrderId: 'wo-1',
      stage: ProductionStage.CUTTING,
      inputQty: 100,
      acceptedQty: 95,
      rejectedQty: 3,
      wasteQty: 2,
    });

    // قراءتا run المرحلة الحالية فقط (بمفتاح المرحلة ثم بمفتاح id بعد
    // القفل) — لا فحص سابقة لأول مرحلة إطلاقًا
    expect(prisma.productionStageRun.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.productionStageRun.findUnique).toHaveBeenNthCalledWith(1, {
      where: {
        workOrderId_stage: {
          workOrderId: 'wo-1',
          stage: ProductionStage.CUTTING,
        },
      },
      include: expect.anything(),
    });
    expect(prisma.productionStageRun.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'srun-cut' },
      include: expect.anything(),
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

/**
 * PRD-8 (GF-IMP-W3): الدمج الموحد لمُحمّلات إعادة التشغيل الثلاثة في
 * findReplay واحدة بفحص scope إلزامي — تثبيت سلوك كل مسار بعد الدمج.
 */
describe('ProductionWorkflowService — PRD-8 (replay موحد بفحص scope)', () => {
  it('PRD-8: replay الانتقال يعمل بعد الدمج — الاستجابة من سجل الانتقال دون معاملة', async () => {
    const { prisma, service } = makeService();
    const input = {
      workOrderId: 'wo-1',
      toStage: ProductionStage.SEWING,
      idempotencyKey: 'transition-replay-key',
    };
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      id: 'idem-tr',
      scope: 'production.transition',
      requestHash: crypto
        .createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex'),
    });
    prisma.workOrderStageTransition.findUnique.mockResolvedValue({
      id: 'trans-1',
      workOrderId: 'wo-1',
      fromStage: ProductionStage.CUTTING,
      toStage: ProductionStage.SEWING,
      toRun: { id: 'srun-2' },
      workOrder: { stageVersion: 3 },
    });

    const result = await service.transitionStage(input, 'actor-1');

    expect(result).toEqual({
      replayed: true,
      transitionId: 'trans-1',
      workOrderId: 'wo-1',
      fromStage: ProductionStage.CUTTING,
      toStage: ProductionStage.SEWING,
      stageRunId: 'srun-2',
      stageVersion: 3,
    });
    // الـ replay يعمل قبل المعاملة — لا قفل ولا كتابة
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.productionStageRun.create).not.toHaveBeenCalled();
  });

  it('PRD-8: replay الصرف يعمل بعد الدمج — الاستجابة من سجل الاستهلاك دون معاملة أو issue', async () => {
    const { prisma, service, issue } = makeService();
    const input = {
      workOrderId: 'wo-1',
      stageRunId: 'srun-1',
      rawMaterialId: 'rm-1',
      warehouseId: 'wh-1',
      plannedQuantity: 10,
      actualQuantity: 8,
      wasteQuantity: 1,
      unit: 'METER',
      idempotencyKey: 'consume-replay-key',
    };
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      id: 'idem-cons',
      scope: 'production.consume',
      requestHash: crypto
        .createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex'),
    });
    prisma.productionMaterialConsumption.findUnique.mockResolvedValue({
      id: 'cons-replay',
      workOrderId: 'wo-1',
      stageRunId: 'srun-1',
      stockLedgerEntry: { id: 'sle-1' },
      actualQuantity: new Prisma.Decimal(8),
      wasteQuantity: new Prisma.Decimal(1),
      unitCost: new Prisma.Decimal('4.5'),
      totalCost: new Prisma.Decimal(36),
      wasteCost: new Prisma.Decimal('4.5'),
    });

    const result = await service.consumeMaterial(input, 'actor-1');

    expect(result).toMatchObject({
      replayed: true,
      consumptionId: 'cons-replay',
      stockLedgerEntryId: 'sle-1',
      actualQuantity: 8,
      wasteQuantity: 1,
      unitCost: 4.5,
      totalCost: 36,
      wasteCost: 4.5,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });

  it('PRD-8: فحص scope صارم للجميع — مفتاح انتقال بمحتوى نطاق مختلف → 409 scope mismatch', async () => {
    const { prisma, service } = makeService();
    const input = {
      workOrderId: 'wo-1',
      toStage: ProductionStage.CUTTING,
      idempotencyKey: 'cross-scope-key',
    };
    // مفتاح مستخدم سابقًا في نطاق مخرج المرحلة — الانتقال يرفضه بوضوح
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      id: 'idem-other',
      scope: 'production.stage-output',
      requestHash: crypto
        .createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex'),
    });

    await expect(service.transitionStage(input, 'actor-1')).rejects.toThrow(
      'Idempotency key scope mismatch',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
