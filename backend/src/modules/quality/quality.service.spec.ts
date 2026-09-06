import { PrismaService } from '../../prisma/prisma.service';
import { computeRequestHash } from '../../core/common/idempotency.util';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
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
import { QualityCheckQueryDto } from './dto/quality-check-query.dto';

describe('QualityService — GF-0014', () => {
  let service: QualityService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let financial: { postJournalEntryInTx: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    // QLT-1 (P0 — GF-IMP-W1): mock محرك الترحيل المالي للتحقق من قيد الهدر.
    financial = { postJournalEntryInTx: jest.fn() };
    service = new QualityService(
      prisma as unknown as PrismaService,
      financial as unknown as FinancialPostingService,
    );
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
    // QLT-1: الفحص ذو الهدر يُرحّل قيدًا ماليًا (Dr WASTE_EXPENSE / Cr WIP).
    expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
    const postingCall = financial.postJournalEntryInTx.mock.calls[0] as [
      unknown,
      {
        postingKey: string;
        reference: string;
        isAuto: boolean;
        lines: {
          debitAccountId: string;
          creditAccountId: string;
          amount: number;
          description: string;
        }[];
      },
      unknown,
    ];
    expect(postingCall[1].postingKey).toBe('quality-inspection:qc-2');
    expect(postingCall[1].reference).toBe('QUALITY:qc-2');
    expect(postingCall[1].isAuto).toBe(true);
    expect(postingCall[1].lines).toEqual([
      {
        debitAccountId: CHART_OF_ACCOUNTS.WASTE_EXPENSE,
        creditAccountId: CHART_OF_ACCOUNTS.WIP,
        amount: 12.5,
        description: 'عيوب وهالك في خط الخياطة',
      },
    ]);
  });

  // QLT-1 (P0 — GF-IMP-W1): تكلفة هدر الجودة يجب أن تصل الدفتر العام.
  describe('QLT-1 — ترحيل تكلفة هدر الجودة', () => {
    const baseInput = {
      workOrderId: 'wo-1',
      stageRunId: 'run-1',
      stage: ProductionStage.SEWING,
      rejectionReason: RejectionReason.SEWING_DEFECT,
      wasteReason: QualityWasteReason.DEFECT_RELATED,
      notes: 'هدر خياطة',
    };

    const setupCreated = (overrides: Record<string, unknown> = {}) => {
      prisma.$transaction.mockImplementation(
        (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
      );
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
      prisma.qualityCheck.create.mockResolvedValue({
        id: 'qc-waste',
        workOrderId: 'wo-1',
        stageRunId: 'run-1',
        stage: WorkOrderStatus.SEWING,
        checkedQty: 100,
        passedQty: 90,
        rejectedQty: 5,
        wasteQty: 5,
        rejectionReason: RejectionReason.SEWING_DEFECT,
        wasteReason: QualityWasteReason.DEFECT_RELATED,
        unitCost: new Prisma.Decimal(2.5),
        wasteCost: new Prisma.Decimal(12.5),
        status: QualityCheckStatus.COMPLETED,
        createdById: 'user-1',
        checkedAt: new Date('2026-08-30T10:00:00.000Z'),
        closedAt: new Date('2026-08-30T10:00:00.000Z'),
        ...overrides,
      });
      prisma.idempotencyKey.update.mockResolvedValue(undefined);
      prisma.activityLog.create.mockResolvedValue(undefined);
    };

    it('هدر موجب يُرحّل قيد Dr WASTE_EXPENSE / Cr WIP بمبلغ wasteCost داخل نفس المعاملة', async () => {
      setupCreated();

      await service.addQualityCheck(
        {
          ...baseInput,
          checkedQty: 100,
          passedQty: 90,
          rejectedQty: 5,
          wasteQty: 5,
        },
        'user-1',
        'quality-waste-key',
      );

      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const call = financial.postJournalEntryInTx.mock.calls[0] as [
        unknown,
        {
          postingKey: string;
          reference: string;
          isAuto: boolean;
          lines: {
            debitAccountId: string;
            creditAccountId: string;
            amount: number;
          }[];
          metadata: Record<string, unknown>;
        },
        unknown,
      ];
      expect(call[0]).toBe(prisma); // نفس المعاملة (tx) التي أنشأت الفحص
      expect(call[1].postingKey).toBe('quality-inspection:qc-waste');
      expect(call[1].reference).toBe('QUALITY:qc-waste');
      expect(call[1].isAuto).toBe(true);
      expect(call[1].lines).toEqual([
        {
          debitAccountId: CHART_OF_ACCOUNTS.WASTE_EXPENSE,
          creditAccountId: CHART_OF_ACCOUNTS.WIP,
          amount: 12.5,
          description: 'هدر خياطة',
        },
      ]);
      expect(call[1].metadata).toEqual(
        expect.objectContaining({
          source: 'quality.inspection',
          qualityCheckId: 'qc-waste',
          wasteQty: 5,
          wasteCost: 12.5,
        }),
      );
      expect(call[2]).toBe('user-1');
    });

    it('هدر صفري (wasteCost = 0) لا يُرحّل أي قيد', async () => {
      setupCreated({
        checkedQty: 10,
        passedQty: 10,
        rejectedQty: 0,
        wasteQty: 0,
        wasteReason: null,
        wasteCost: new Prisma.Decimal('0.00'),
      });

      const result = await service.addQualityCheck(
        {
          ...baseInput,
          checkedQty: 10,
          passedQty: 10,
          rejectedQty: 0,
          wasteQty: 0,
          wasteReason: undefined,
          notes: 'لا هدر',
        },
        'user-1',
        'quality-zero-waste-key',
      );

      expect(result).toMatchObject({ wasteQty: 0, wasteCost: 0 });
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('فشل ترحيل قيد الهدر يُرجع المعاملة كاملة (لا فحص بلا قيد)', async () => {
      setupCreated();
      financial.postJournalEntryInTx.mockRejectedValueOnce(
        new Error('posting failed'),
      );

      await expect(
        service.addQualityCheck(
          {
            ...baseInput,
            checkedQty: 100,
            passedQty: 90,
            rejectedQty: 5,
            wasteQty: 5,
          },
          'user-1',
          'quality-waste-fail-key',
        ),
      ).rejects.toThrow('posting failed');
    });
  });

  // QLT-3 (P1 — GF-IMP-W2): فلاتر قائمة الفحوص (نفس مرشحات KPI).
  describe('QLT-3 — فلاتر قائمة الفحوصات', () => {
    it('يطبّق stage وworkOrderId وfrom/to في where (نفس مرشحات KPI)', async () => {
      prisma.qualityCheck.findMany.mockResolvedValue([]);
      prisma.qualityCheck.count.mockResolvedValue(0);

      const query = {
        stage: ProductionStage.SEWING,
        workOrderId: 'wo-1',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.999Z',
        page: 1,
        limit: 20,
      } as QualityCheckQueryDto;

      await service.getQualityChecks(query);

      const expectedWhere = {
        workOrderId: 'wo-1',
        stage: WorkOrderStatus.SEWING,
        checkedAt: {
          gte: new Date(query.from as string),
          lte: new Date(query.to as string),
        },
      };
      expect(prisma.qualityCheck.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.qualityCheck.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('بلا مرشحات → where فارغة (توافق خلفي) مع ترقيم الصفحات', async () => {
      prisma.qualityCheck.findMany.mockResolvedValue([]);
      prisma.qualityCheck.count.mockResolvedValue(0);

      await service.getQualityChecks({
        page: 2,
        limit: 5,
      });

      expect(prisma.qualityCheck.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 5, take: 5 }),
      );
      expect(prisma.qualityCheck.count).toHaveBeenCalledWith({ where: {} });
    });

    it('تاريخ غير صالح → 400 قبل أي استعلام', async () => {
      await expect(
        service.getQualityChecks({
          from: 'not-a-date',
        }),
      ).rejects.toThrow('فلاتر الفحوصات تتطلب تواريخ ISO صالحة');
      expect(prisma.qualityCheck.findMany).not.toHaveBeenCalled();
    });

    it('from بعد to → 400', async () => {
      await expect(
        service.getQualityChecks({
          from: '2026-09-01T00:00:00.000Z',
          to: '2026-08-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(
        'تاريخ بداية الفلاتر لا يمكن أن يكون بعد تاريخ النهاية',
      );
    });

    it('الاستدعاء بلا وسيطات يعمل (الافتراض من الخدمة)', async () => {
      prisma.qualityCheck.findMany.mockResolvedValue([]);
      prisma.qualityCheck.count.mockResolvedValue(0);

      const result = await service.getQualityChecks();

      expect(result.data).toEqual([]);
      expect(prisma.qualityCheck.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
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
