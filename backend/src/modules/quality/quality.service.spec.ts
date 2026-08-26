import { PrismaService } from '../../prisma/prisma.service';
import { computeRequestHash } from '../../core/common/idempotency.util';
import {
  Prisma,
  ProductionStage,
  ProductionStageRunStatus,
  QualityCheckStatus,
  QualityWasteReason,
  RejectionReason,
  WorkOrderStatus,
} from '@prisma/client';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { QualityService } from './quality.service';

describe('QualityService — GF-0014', () => {
  let service: QualityService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new QualityService(prisma as unknown as PrismaService);
  });

  it('يجلب الفحوصات مع stage run وactor بترتيب أحدث فحص', async () => {
    const checks = [
      { id: 'qc-1', checkedQty: 100, passedQty: 95, rejectedQty: 5 },
    ];
    prisma.qualityCheck.findMany.mockResolvedValue(checks);
    prisma.qualityCheck.count.mockResolvedValue(checks.length);

    const result = await service.getQualityChecks();

    expect(result.data).toEqual(checks);
    expect(prisma.qualityCheck.findMany).toHaveBeenCalledTimes(1);
    const findManyCalls = prisma.qualityCheck.findMany.mock
      .calls as unknown as Array<
      [{ orderBy: { checkedAt: string }; include: Record<string, unknown> }]
    >;
    const query = findManyCalls[0]?.[0];
    expect(query.orderBy).toEqual({ checkedAt: 'desc' });
    expect(query.include).toEqual(
      expect.objectContaining({
        stageRun: true,
        createdBy: { select: { id: true, name: true, email: true } },
      }),
    );
  });

  it('يسجل فحصًا متوازنًا مع هالك مصنف وتكلفة وفاعل داخل transaction', async () => {
    const data = {
      workOrderId: 'wo-1',
      stageRunId: 'run-1',
      stage: ProductionStage.SEWING,
      checkedQty: 100,
      passedQty: 90,
      rejectedQty: 5,
      wasteQty: 5,
      rejectionReason: RejectionReason.SEWING_DEFECT,
      wasteReason: QualityWasteReason.DEFECT_RELATED,
      notes: 'عيوب وهالك في خط الخياطة',
    };
    const created = {
      id: 'qc-2',
      workOrderId: data.workOrderId,
      stageRunId: data.stageRunId,
      stage: WorkOrderStatus.SEWING,
      checkedQty: data.checkedQty,
      passedQty: data.passedQty,
      rejectedQty: data.rejectedQty,
      wasteQty: data.wasteQty,
      rejectionReason: data.rejectionReason,
      wasteReason: data.wasteReason,
      unitCost: new Prisma.Decimal(2.5),
      wasteCost: new Prisma.Decimal(12.5),
      status: QualityCheckStatus.COMPLETED,
      createdById: 'user-1',
      checkedAt: new Date('2026-08-30T10:00:00.000Z'),
      closedAt: new Date('2026-08-30T10:00:00.000Z'),
    };
    const runTransaction = (
      callback: (tx: typeof prisma) => Promise<unknown>,
    ) => callback(prisma);

    prisma.$transaction.mockImplementation(runTransaction);
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      bomVersionId: 'bom-1',
    });
    prisma.productionStageRun.findFirst.mockResolvedValue({
      id: 'run-1',
      stage: ProductionStage.SEWING,
      status: ProductionStageRunStatus.COMPLETED,
      inputQty: 100,
    });
    prisma.productionCostSnapshot.findFirst.mockResolvedValue({
      unitCost: new Prisma.Decimal(2.5),
    });
    prisma.qualityCheck.create.mockResolvedValue(created);
    prisma.idempotencyKey.update.mockResolvedValue(undefined);
    prisma.activityLog.create.mockResolvedValue(undefined);

    const result = await service.addQualityCheck(
      data,
      'user-1',
      'quality-key-1',
    );

    expect(result).toMatchObject({
      id: 'qc-2',
      stage: ProductionStage.SEWING,
      wasteQty: 5,
      wasteCost: 12.5,
      createdById: 'user-1',
    });
    expect(prisma.qualityCheck.create).toHaveBeenCalledTimes(1);
    const createCalls = prisma.qualityCheck.create.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    const createCall = createCalls[0]?.[0];
    expect(createCall.data).toMatchObject({
      workOrderId: 'wo-1',
      stageRunId: 'run-1',
      stage: WorkOrderStatus.SEWING,
      wasteQty: 5,
      wasteReason: QualityWasteReason.DEFECT_RELATED,
      unitCost: new Prisma.Decimal(2.5),
      wasteCost: new Prisma.Decimal(12.5),
      createdById: 'user-1',
      idempotencyKeyId: 'idem-1',
    });
    const activityCalls = prisma.activityLog.create.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    const activityCall = activityCalls[0]?.[0];
    expect(activityCall.data).toMatchObject({
      userId: 'user-1',
      action: 'QUALITY_CHECK_CREATED',
      module: 'QUALITY',
    });
  });

  it('يحسب KPI من الفحوصات المكتملة مع تصفية المرحلة والفترة', async () => {
    prisma.qualityCheck.aggregate.mockResolvedValue({
      _sum: {
        checkedQty: 100,
        passedQty: 90,
        rejectedQty: 5,
        wasteQty: 5,
        wasteCost: new Prisma.Decimal(12.5),
      },
    });

    const query = {
      stage: ProductionStage.SEWING,
      workOrderId: 'wo-1',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
    };
    const result = await service.getQualityKpis(query);

    expect(result).toEqual({
      filters: query,
      totals: {
        checkedQty: 100,
        passedQty: 90,
        rejectedQty: 5,
        wasteQty: 5,
        wasteCost: 12.5,
      },
      rates: { passRate: 90, rejectionRate: 5, wasteRate: 5 },
    });
    expect(prisma.qualityCheck.aggregate).toHaveBeenCalledWith({
      where: {
        status: QualityCheckStatus.COMPLETED,
        workOrderId: 'wo-1',
        stage: WorkOrderStatus.SEWING,
        checkedAt: {
          gte: new Date(query.from),
          lte: new Date(query.to),
        },
      },
      _sum: {
        checkedQty: true,
        passedQty: true,
        rejectedQty: true,
        wasteQty: true,
        wasteCost: true,
      },
    });
  });

  it('يرفض فحصًا ثانيًا لنفس stageRun قبل أي كتابة', async () => {
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      bomVersionId: 'bom-1',
    });
    prisma.productionStageRun.findFirst.mockResolvedValue({
      id: 'run-1',
      stage: ProductionStage.CUTTING,
      status: ProductionStageRunStatus.COMPLETED,
      inputQty: 10,
    });
    prisma.qualityCheck.findUnique.mockResolvedValue({ id: 'qc-existing' });

    await expect(
      service.addQualityCheck({
        workOrderId: 'wo-1',
        stageRunId: 'run-1',
        stage: ProductionStage.CUTTING,
        checkedQty: 10,
        passedQty: 10,
        rejectedQty: 0,
        wasteQty: 0,
      }),
    ).rejects.toThrow('A quality check already exists for this stage run');
    expect(prisma.qualityCheck.create).not.toHaveBeenCalled();
    expect(prisma.productionCostSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('يرفض conservation غير الصحيحة قبل أي كتابة', async () => {
    await expect(
      service.addQualityCheck({
        workOrderId: 'wo-1',
        stageRunId: 'run-1',
        stage: ProductionStage.CUTTING,
        checkedQty: 50,
        passedQty: 40,
        rejectedQty: 0,
        wasteQty: 0,
      }),
    ).rejects.toThrow(
      'checkedQty must equal passedQty + rejectedQty + wasteQty',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('يعيد نفس الاستجابة عند إعادة استخدام مفتاح idempotency دون إنشاء فحص جديد', async () => {
    const input = {
      workOrderId: 'wo-1',
      stageRunId: 'run-1',
      stage: ProductionStage.CUTTING,
      checkedQty: 10,
      passedQty: 10,
      rejectedQty: 0,
      wasteQty: 0,
    };
    const response = {
      id: 'qc-existing',
      ...input,
      wasteCost: 0,
    };
    const runTransaction = (
      callback: (tx: typeof prisma) => Promise<unknown>,
    ) => callback(prisma);

    prisma.$transaction.mockImplementation(runTransaction);
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      scope: 'quality-check-create',
      requestHash: computeRequestHash({ ...input, actorId: 'user-1' }),
      response,
    });

    const result = await service.addQualityCheck(
      input,
      'user-1',
      'quality-key-replay',
    );

    expect(result).toMatchObject({ id: 'qc-existing', replayed: true });
    expect(prisma.qualityCheck.create).not.toHaveBeenCalled();
  });
});
