import {
  Prisma,
  ProductionStage,
  ProductionStageRunStatus,
  ProductionCostStatus,
  RejectionReason,
  QualityWasteReason,
  UserRole,
  WorkOrderStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { QualityService } from '../src/modules/quality/quality.service';
import { PrismaService } from '../src/prisma/prisma.service';

type Scenario = {
  userId: string;
  workOrderId: string;
  stageRunId: string;
  bomVersionId: string;
};

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe('GF-0014 quality and waste integration', () => {
  let prisma: PrismaService;
  let qualityService: QualityService;
  let scenario: Scenario;

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    qualityService = new QualityService(prisma);
  });

  beforeEach(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "activity_logs",
        "quality_checks",
        "production_cost_snapshots",
        "production_stage_runs",
        "idempotency_keys",
        "work_orders",
        "bom_lines",
        "bom_versions",
        "product_variants",
        "products",
        "users"
      CASCADE
    `);
    scenario = await createScenario();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function createScenario(): Promise<Scenario> {
    const user = await prisma.user.create({
      data: {
        name: 'GF-0014 Quality Integration User',
        email: `gf0014-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.PRODUCTION_MANAGER,
      },
    });
    const product = await prisma.product.create({
      data: {
        code: `PR-GF14-${randomUUID().slice(0, 8)}`,
        name: 'GF-0014 Test Product',
        retailPrice: 100,
        wholesalePrice: 80,
      },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, size: 'M', color: 'BLUE' },
    });
    const bomVersion = await prisma.bomVersion.create({
      data: {
        productId: product.id,
        versionName: 'GF-0014 v1',
        isActive: true,
      },
    });
    const workOrder = await prisma.workOrder.create({
      data: {
        code: `WO-GF14-${randomUUID().slice(0, 8)}`,
        productVariantId: variant.id,
        bomVersionId: bomVersion.id,
        quantity: 100,
        status: WorkOrderStatus.PLANNED,
        createdById: user.id,
      },
    });
    const stageRun = await prisma.productionStageRun.create({
      data: {
        workOrderId: workOrder.id,
        stage: ProductionStage.SEWING,
        sequence: 2,
        status: ProductionStageRunStatus.COMPLETED,
        plannedQty: 100,
        inputQty: 100,
        acceptedQty: 95,
        rejectedQty: 5,
        wasteQty: 0,
      },
    });
    await prisma.productionCostSnapshot.create({
      data: {
        workOrderId: workOrder.id,
        status: ProductionCostStatus.FINALIZED,
        materialCost: 250,
        laborCost: 0,
        overheadCost: 0,
        wasteCost: 0,
        totalCost: 250,
        acceptedQty: 100,
        unitCost: new Prisma.Decimal(2.5),
        createdById: user.id,
      },
    });
    return {
      userId: user.id,
      workOrderId: workOrder.id,
      stageRunId: stageRun.id,
      bomVersionId: bomVersion.id,
    };
  }

  it('records balanced outcomes, classified waste, cost, and audit actor', async () => {
    const result = await qualityService.addQualityCheck(
      {
        workOrderId: scenario.workOrderId,
        stageRunId: scenario.stageRunId,
        stage: ProductionStage.SEWING,
        checkedQty: 100,
        passedQty: 90,
        rejectedQty: 5,
        wasteQty: 5,
        rejectionReason: RejectionReason.SEWING_DEFECT,
        wasteReason: QualityWasteReason.DEFECT_RELATED,
      },
      scenario.userId,
      `gf0014-quality-${randomUUID()}`,
    );

    expect(result.wasteQty).toBe(5);
    expect(result.wasteCost).toBe(12.5);
    expect(result.createdById).toBe(scenario.userId);
    expect(await prisma.qualityCheck.count()).toBe(1);
    expect(
      await prisma.activityLog.count({
        where: { action: 'QUALITY_CHECK_CREATED', userId: scenario.userId },
      }),
    ).toBe(1);
  });

  it('aggregates completed quality KPIs with server-side rates', async () => {
    await qualityService.addQualityCheck(
      {
        workOrderId: scenario.workOrderId,
        stageRunId: scenario.stageRunId,
        stage: ProductionStage.SEWING,
        checkedQty: 100,
        passedQty: 90,
        rejectedQty: 5,
        wasteQty: 5,
        rejectionReason: RejectionReason.SEWING_DEFECT,
        wasteReason: QualityWasteReason.DEFECT_RELATED,
      },
      scenario.userId,
      `gf0014-kpi-${randomUUID()}`,
    );

    await expect(
      qualityService.getQualityKpis({
        stage: ProductionStage.SEWING,
        workOrderId: scenario.workOrderId,
      }),
    ).resolves.toEqual({
      filters: {
        stage: ProductionStage.SEWING,
        workOrderId: scenario.workOrderId,
        from: null,
        to: null,
      },
      totals: {
        checkedQty: 100,
        passedQty: 90,
        rejectedQty: 5,
        wasteQty: 5,
        wasteCost: 12.5,
      },
      rates: { passRate: 90, rejectionRate: 5, wasteRate: 5 },
    });
  });

  it('rejects a second quality check for the same stage run', async () => {
    const input = {
      workOrderId: scenario.workOrderId,
      stageRunId: scenario.stageRunId,
      stage: ProductionStage.SEWING,
      checkedQty: 100,
      passedQty: 95,
      rejectedQty: 5,
      wasteQty: 0,
      rejectionReason: RejectionReason.SEWING_DEFECT,
    };
    await qualityService.addQualityCheck(input, scenario.userId);

    await expect(
      qualityService.addQualityCheck(input, scenario.userId),
    ).rejects.toThrow('A quality check already exists for this stage run');
    expect(await prisma.qualityCheck.count()).toBe(1);
  });

  it('replays the same idempotency key without creating a second check', async () => {
    const input = {
      workOrderId: scenario.workOrderId,
      stageRunId: scenario.stageRunId,
      stage: ProductionStage.SEWING,
      checkedQty: 100,
      passedQty: 95,
      rejectedQty: 5,
      wasteQty: 0,
      rejectionReason: RejectionReason.SEWING_DEFECT,
    };
    const key = `gf0014-replay-${randomUUID()}`;
    const first = await qualityService.addQualityCheck(
      input,
      scenario.userId,
      key,
    );
    const second = await qualityService.addQualityCheck(
      input,
      scenario.userId,
      key,
    );

    expect(second).toMatchObject({ id: first.id, replayed: true });
    expect(await prisma.qualityCheck.count()).toBe(1);
  });

  it('rejects quality before the stage run is completed', async () => {
    await prisma.productionStageRun.update({
      where: { id: scenario.stageRunId },
      data: { status: ProductionStageRunStatus.IN_PROGRESS },
    });

    await expect(
      qualityService.addQualityCheck(
        {
          workOrderId: scenario.workOrderId,
          stageRunId: scenario.stageRunId,
          stage: ProductionStage.SEWING,
          checkedQty: 100,
          passedQty: 100,
          rejectedQty: 0,
          wasteQty: 0,
        },
        scenario.userId,
      ),
    ).rejects.toThrow('Quality can only be recorded for a completed stage run');
  });

  it('rejects a stage mismatch and missing waste classification', async () => {
    await expect(
      qualityService.addQualityCheck(
        {
          workOrderId: scenario.workOrderId,
          stageRunId: scenario.stageRunId,
          stage: ProductionStage.CUTTING,
          checkedQty: 100,
          passedQty: 95,
          rejectedQty: 5,
          wasteQty: 0,
          rejectionReason: RejectionReason.CUTTING_DEFECT,
        },
        scenario.userId,
      ),
    ).rejects.toThrow('Quality stage must match the selected stage run');

    await expect(
      qualityService.addQualityCheck(
        {
          workOrderId: scenario.workOrderId,
          stageRunId: scenario.stageRunId,
          stage: ProductionStage.SEWING,
          checkedQty: 100,
          passedQty: 90,
          rejectedQty: 5,
          wasteQty: 5,
        },
        scenario.userId,
      ),
    ).rejects.toThrow(
      'wasteReason is required when wasteQty is greater than zero',
    );
    expect(await prisma.qualityCheck.count()).toBe(0);
  });

  it('enforces conservation at the database boundary for new rows', async () => {
    await expect(
      prisma.qualityCheck.create({
        data: {
          workOrderId: scenario.workOrderId,
          stage: WorkOrderStatus.SEWING,
          checkedQty: 100,
          passedQty: 95,
          rejectedQty: 5,
          wasteQty: 1,
        },
      }),
    ).rejects.toThrow();
  });
});
