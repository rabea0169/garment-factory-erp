import {
  Prisma,
  ProductionStage,
  ProductionStageRunStatus,
  QualityCheckStatus,
  StockMovementType,
  ProductionWasteReason,
  UserRole,
  WarehouseType,
  WorkOrderStatus,
} from '@prisma/client';
import { EventEmitter2 } from 'eventemitter2';
import { randomUUID } from 'node:crypto';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ProductionWorkflowService } from '../src/modules/production/production-workflow.service';
import { FinancialPostingService } from '../src/core/financial/financial-posting.service';
import { PrismaService } from '../src/prisma/prisma.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

type Scenario = {
  userId: string;
  rawWarehouseId: string;
  rawMaterialId: string;
  productVariantId: string;
  bomVersionId: string;
  workOrderId: string;
};

integrationDescribe('GF-0013 production workflow integration', () => {
  let prisma: PrismaService;
  let inventoryService: InventoryService;
  let workflowService: ProductionWorkflowService;
  let scenario: Scenario;

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;

    prisma = new PrismaService();
    await prisma.$connect();
    inventoryService = new InventoryService(
      prisma,
      new EventEmitter2(),
      new FinancialPostingService(prisma),
    );
    workflowService = new ProductionWorkflowService(
      prisma,
      inventoryService,
      new FinancialPostingService(prisma),
    );
  });

  beforeEach(async () => {
    if (!prisma) return;
    // This suite requires a disposable PostgreSQL database. Never point it at production.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "production_cost_snapshots",
        "production_material_consumptions",
        "work_order_stage_transitions",
        "production_stage_runs",
        "stock_ledger_entries",
        "idempotency_keys",
        "work_orders",
        "bom_lines",
        "bom_versions",
        "finished_good_stocks",
        "finished_goods",
        "product_variants",
        "products",
        "raw_materials",
        "warehouses",
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
        name: 'GF-0013 Integration User',
        email: `gf0013-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.PRODUCTION_MANAGER,
      },
    });

    const rawWarehouse = await prisma.warehouse.create({
      data: {
        code: `GF13-RAW-${randomUUID().slice(0, 8)}`,
        name: 'GF-0013 Raw Materials Test Warehouse',
        type: WarehouseType.RAW_MATERIAL,
      },
    });

    const rawMaterial = await prisma.rawMaterial.create({
      data: {
        code: `RM-GF13-${randomUUID().slice(0, 8)}`,
        name: 'GF-0013 Test Fabric',
        unit: 'METER',
        currentStock: 0,
        costPerUnit: 5,
      },
    });

    const product = await prisma.product.create({
      data: {
        code: `PR-GF13-${randomUUID().slice(0, 8)}`,
        name: 'GF-0013 Test Shirt',
        retailPrice: 100,
        wholesalePrice: 80,
      },
    });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        size: 'M',
        color: 'BLUE',
      },
    });

    const bomVersion = await prisma.bomVersion.create({
      data: {
        productId: product.id,
        versionName: 'GF-0013 v1',
        isActive: true,
        lines: {
          create: {
            rawMaterialId: rawMaterial.id,
            quantity: 1,
            unit: 'METER',
          },
        },
      },
    });

    const workOrder = await prisma.workOrder.create({
      data: {
        code: `WO-GF13-${randomUUID().slice(0, 8)}`,
        productVariantId: variant.id,
        bomVersionId: bomVersion.id,
        quantity: 10,
        status: WorkOrderStatus.PLANNED,
        createdById: user.id,
      },
    });

    await inventoryService.receive(
      {
        rawMaterialId: rawMaterial.id,
        warehouseId: rawWarehouse.id,
        quantity: 10,
        unitCost: 5,
        reference: workOrder.code,
        idempotencyKey: `gf0013-receive-${randomUUID()}`,
      },
      user.id,
    );

    return {
      userId: user.id,
      rawWarehouseId: rawWarehouse.id,
      rawMaterialId: rawMaterial.id,
      productVariantId: variant.id,
      bomVersionId: bomVersion.id,
      workOrderId: workOrder.id,
    };
  }

  it('allows only sequential transitions and replays the same transition idempotently', async () => {
    const transitionKey = `gf0013-transition-${randomUUID()}`;
    const first = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
        idempotencyKey: transitionKey,
      },
      scenario.userId,
    );

    expect(first.replayed).toBe(false);
    expect(first.fromStage).toBeNull();
    expect(first.toStage).toBe(ProductionStage.CUTTING);

    const replay = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
        idempotencyKey: transitionKey,
      },
      scenario.userId,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.transitionId).toBe(first.transitionId);

    await expect(
      workflowService.transitionStage(
        {
          workOrderId: scenario.workOrderId,
          toStage: ProductionStage.PACKING,
          idempotencyKey: `gf0013-invalid-${randomUUID()}`,
        },
        scenario.userId,
      ),
    ).rejects.toThrow('Invalid stage transition');

    await workflowService.recordStageOutput({
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.CUTTING,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
    });

    const next = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.SEWING,
        idempotencyKey: `gf0013-transition-${randomUUID()}`,
      },
      scenario.userId,
    );
    expect(next.fromStage).toBe(ProductionStage.CUTTING);
    expect(next.toStage).toBe(ProductionStage.SEWING);

    expect(
      await prisma.workOrderStageTransition.count({
        where: { workOrderId: scenario.workOrderId },
      }),
    ).toBe(2);
  });

  it('handles concurrent identical transitions as one committed operation', async () => {
    const input = {
      workOrderId: scenario.workOrderId,
      toStage: ProductionStage.CUTTING,
      idempotencyKey: `gf0013-concurrent-transition-${randomUUID()}`,
    };

    const results = await Promise.all([
      workflowService.transitionStage(input, scenario.userId),
      workflowService.transitionStage(input, scenario.userId),
    ]);

    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(
      await prisma.workOrderStageTransition.count({
        where: { workOrderId: scenario.workOrderId },
      }),
    ).toBe(1);
    expect(
      await prisma.productionStageRun.count({
        where: { workOrderId: scenario.workOrderId },
      }),
    ).toBe(1);
  });

  it('enforces quantity conservation for a stage output', async () => {
    const transition = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
      },
      scenario.userId,
    );

    const stageRun = await prisma.productionStageRun.findUnique({
      where: { id: transition.stageRunId },
    });
    expect(stageRun?.status).toBe(ProductionStageRunStatus.IN_PROGRESS);

    await expect(
      workflowService.recordStageOutput({
        workOrderId: scenario.workOrderId,
        stage: ProductionStage.CUTTING,
        inputQty: 10,
        acceptedQty: 8,
        rejectedQty: 1,
        wasteQty: 0,
      }),
    ).rejects.toThrow('inputQty must equal');

    await workflowService.recordStageOutput({
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.CUTTING,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
      notes: 'Integration split',
    });

    const saved = await prisma.productionStageRun.findUnique({
      where: { id: transition.stageRunId },
    });
    expect(saved).toMatchObject({
      status: ProductionStageRunStatus.COMPLETED,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
    });
  });

  it('replays identical stage output without a second completion or activity log', async () => {
    const transition = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
      },
      scenario.userId,
    );
    const input = {
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.CUTTING,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
      idempotencyKey: `gf0013-stage-output-${randomUUID()}`,
    };

    const first = await workflowService.recordStageOutput(
      input,
      scenario.userId,
    );
    const replay = await workflowService.recordStageOutput(
      input,
      scenario.userId,
    );

    expect(first).toMatchObject({
      replayed: false,
      stageRunId: transition.stageRunId,
      status: ProductionStageRunStatus.COMPLETED,
    });
    expect(replay).toMatchObject({
      replayed: true,
      stageRunId: transition.stageRunId,
      status: ProductionStageRunStatus.COMPLETED,
    });
    expect(
      await prisma.productionStageRun.count({
        where: {
          id: transition.stageRunId,
          status: ProductionStageRunStatus.COMPLETED,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.activityLog.count({
        where: {
          userId: scenario.userId,
          action: 'PRODUCTION_STAGE_OUTPUT_RECORDED',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.idempotencyKey.count({
        where: { key: input.idempotencyKey },
      }),
    ).toBe(1);
  });

  it('rejects a different stage-output payload with the same idempotency key', async () => {
    await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
      },
      scenario.userId,
    );
    const key = `gf0013-stage-output-mismatch-${randomUUID()}`;
    const input = {
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.CUTTING,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
      idempotencyKey: key,
    };
    await workflowService.recordStageOutput(input, scenario.userId);

    await expect(
      workflowService.recordStageOutput(
        { ...input, acceptedQty: 7, rejectedQty: 2 },
        scenario.userId,
      ),
    ).rejects.toThrow('Idempotency key payload mismatch');

    const saved = await prisma.productionStageRun.findUnique({
      where: {
        workOrderId_stage: {
          workOrderId: scenario.workOrderId,
          stage: ProductionStage.CUTTING,
        },
      },
    });
    expect(saved).toMatchObject({ acceptedQty: 8, rejectedQty: 1 });
  });

  it('handles concurrent identical stage outputs as one completion', async () => {
    const transition = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
      },
      scenario.userId,
    );
    const input = {
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.CUTTING,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
      idempotencyKey: `gf0013-stage-output-concurrent-${randomUUID()}`,
    };

    const results = await Promise.all([
      workflowService.recordStageOutput(input, scenario.userId),
      workflowService.recordStageOutput(input, scenario.userId),
    ]);

    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(
      await prisma.productionStageRun.count({
        where: { id: transition.stageRunId },
      }),
    ).toBe(1);
    expect(
      await prisma.activityLog.count({
        where: {
          userId: scenario.userId,
          action: 'PRODUCTION_STAGE_OUTPUT_RECORDED',
        },
      }),
    ).toBe(1);
  });

  it('records consumption, calculates material waste cost, and replays safely', async () => {
    const transition = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
      },
      scenario.userId,
    );

    const input = {
      workOrderId: scenario.workOrderId,
      stageRunId: transition.stageRunId,
      rawMaterialId: scenario.rawMaterialId,
      warehouseId: scenario.rawWarehouseId,
      plannedQuantity: 3,
      actualQuantity: 4,
      wasteQuantity: 1,
      unit: 'METER',
      wasteReason: ProductionWasteReason.CUTTING_LOSS,
      reference: scenario.workOrderId,
      idempotencyKey: `gf0013-consume-${randomUUID()}`,
    };

    const result = await workflowService.consumeMaterial(
      input,
      scenario.userId,
    );
    expect(result.replayed).toBe(false);
    expect(result.unitCost).toBe(5);
    expect(result.totalCost).toBe(20);
    expect(result.wasteCost).toBe(5);

    const replay = await workflowService.consumeMaterial(
      input,
      scenario.userId,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.consumptionId).toBe(result.consumptionId);

    expect(
      await prisma.stockLedgerEntry.count({
        where: {
          rawMaterialId: scenario.rawMaterialId,
          type: StockMovementType.ISSUE,
        },
      }),
    ).toBe(1); // replay must not create a second ISSUE

    await workflowService.recordStageOutput(
      {
        workOrderId: scenario.workOrderId,
        stage: ProductionStage.CUTTING,
        inputQty: 10,
        acceptedQty: 8,
        rejectedQty: 1,
        wasteQty: 1,
      },
      scenario.userId,
    );
    expect(
      await prisma.activityLog.count({
        where: {
          userId: scenario.userId,
          action: 'PRODUCTION_STAGE_OUTPUT_RECORDED',
        },
      }),
    ).toBe(1);

    await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.SEWING,
      },
      scenario.userId,
    );
    await workflowService.recordStageOutput({
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.SEWING,
      inputQty: 8,
      acceptedQty: 7,
      rejectedQty: 1,
      wasteQty: 0,
    });

    const cost = await workflowService.finalizeCost(
      scenario.workOrderId,
      scenario.userId,
    );
    expect(Number(cost.materialCost)).toBe(20);
    expect(Number(cost.wasteCost)).toBe(5);
    expect(Number(cost.totalCost)).toBe(20);
    expect(Number(cost.unitCost)).toBeCloseTo(20 / 7, 4);
  });

  it('handles concurrent identical material consumption as one issue', async () => {
    const transition = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
      },
      scenario.userId,
    );

    const input = {
      workOrderId: scenario.workOrderId,
      stageRunId: transition.stageRunId,
      rawMaterialId: scenario.rawMaterialId,
      warehouseId: scenario.rawWarehouseId,
      plannedQuantity: 3,
      actualQuantity: 4,
      wasteQuantity: 1,
      unit: 'METER',
      idempotencyKey: `gf0013-concurrent-consume-${randomUUID()}`,
    };

    const results = await Promise.all([
      workflowService.consumeMaterial(input, scenario.userId),
      workflowService.consumeMaterial(input, scenario.userId),
    ]);

    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(
      await prisma.productionMaterialConsumption.count({
        where: { workOrderId: scenario.workOrderId },
      }),
    ).toBe(1);
    expect(
      await prisma.stockLedgerEntry.count({
        where: {
          rawMaterialId: scenario.rawMaterialId,
          type: StockMovementType.ISSUE,
        },
      }),
    ).toBe(1);
  });

  it('rolls back the ledger and consumption when material is insufficient', async () => {
    const transition = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
      },
      scenario.userId,
    );

    await expect(
      workflowService.consumeMaterial(
        {
          workOrderId: scenario.workOrderId,
          stageRunId: transition.stageRunId,
          rawMaterialId: scenario.rawMaterialId,
          warehouseId: scenario.rawWarehouseId,
          plannedQuantity: 100,
          actualQuantity: 100,
          wasteQuantity: 0,
          unit: 'METER',
          idempotencyKey: `gf0013-rollback-${randomUUID()}`,
        },
        scenario.userId,
      ),
    ).rejects.toThrow();

    const material = await prisma.rawMaterial.findUnique({
      where: { id: scenario.rawMaterialId },
    });
    expect(Number(material?.currentStock)).toBe(10);
    expect(
      await prisma.productionMaterialConsumption.count({
        where: { workOrderId: scenario.workOrderId },
      }),
    ).toBe(0);
    expect(
      await prisma.stockLedgerEntry.count({
        where: {
          rawMaterialId: scenario.rawMaterialId,
          type: StockMovementType.RECEIVE,
        },
      }),
    ).toBe(1); // initial RECEIVE only
  });
});

// Corrective Cluster 5 coverage: PACKING must post accepted output exactly once.
// This test intentionally runs only when GF_INTEGRATION_DATABASE_URL is configured.
integrationDescribe('Cluster 5 finished-good posting', () => {
  let prisma: PrismaService;
  let inventoryService: InventoryService;
  let workflowService: ProductionWorkflowService;
  let scenario: Scenario;

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    inventoryService = new InventoryService(
      prisma,
      new EventEmitter2(),
      new FinancialPostingService(prisma),
    );
    workflowService = new ProductionWorkflowService(
      prisma,
      inventoryService,
      new FinancialPostingService(prisma),
    );
  });

  beforeEach(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE
      "production_cost_snapshots", "production_material_consumptions",
      "work_order_stage_transitions", "production_stage_runs",
      "stock_ledger_entries", "idempotency_keys", "work_orders",
      "bom_lines", "bom_versions", "finished_good_stocks", "finished_goods",
      "product_variants", "products", "raw_materials", "warehouses", "users"
      CASCADE`);
    scenario = await createScenarioForPosting(prisma, inventoryService);
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function createScenarioForPosting(
    db: PrismaService,
    inventory: InventoryService,
  ): Promise<Scenario> {
    const user = await db.user.create({
      data: {
        name: 'Cluster 5 Posting User',
        email: `cluster5-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.PRODUCTION_MANAGER,
      },
    });
    const rawWarehouse = await db.warehouse.create({
      data: {
        code: `C5-RAW-${randomUUID().slice(0, 8)}`,
        name: 'Cluster 5 Raw Warehouse',
        type: WarehouseType.RAW_MATERIAL,
      },
    });
    await db.warehouse.create({
      data: {
        code: 'WH-FG',
        name: 'Cluster 5 Finished Goods',
        type: WarehouseType.FINISHED_GOODS,
      },
    });
    const rawMaterial = await db.rawMaterial.create({
      data: {
        code: `C5-RM-${randomUUID().slice(0, 8)}`,
        name: 'Cluster 5 Fabric',
        unit: 'METER',
        currentStock: 0,
        costPerUnit: 5,
      },
    });
    const product = await db.product.create({
      data: {
        code: `C5-PR-${randomUUID().slice(0, 8)}`,
        name: 'Cluster 5 Shirt',
        retailPrice: 100,
        wholesalePrice: 80,
      },
    });
    const variant = await db.productVariant.create({
      data: { productId: product.id, size: 'M', color: 'BLUE' },
    });
    const bomVersion = await db.bomVersion.create({
      data: {
        productId: product.id,
        versionName: 'Cluster 5 v1',
        isActive: true,
        lines: {
          create: { rawMaterialId: rawMaterial.id, quantity: 1, unit: 'METER' },
        },
      },
    });
    const workOrder = await db.workOrder.create({
      data: {
        code: `C5-WO-${randomUUID().slice(0, 8)}`,
        productVariantId: variant.id,
        bomVersionId: bomVersion.id,
        quantity: 10,
        status: WorkOrderStatus.PLANNED,
        createdById: user.id,
      },
    });
    await inventory.receive(
      {
        rawMaterialId: rawMaterial.id,
        warehouseId: rawWarehouse.id,
        quantity: 10,
        unitCost: 5,
        reference: workOrder.code,
        idempotencyKey: `c5-receive-${randomUUID()}`,
      },
      user.id,
    );
    return {
      userId: user.id,
      rawWarehouseId: rawWarehouse.id,
      rawMaterialId: rawMaterial.id,
      productVariantId: variant.id,
      bomVersionId: bomVersion.id,
      workOrderId: workOrder.id,
    };
  }

  it('posts accepted PACKING output to authoritative stock and ledger once', async () => {
    const cutting = await workflowService.transitionStage(
      { workOrderId: scenario.workOrderId, toStage: ProductionStage.CUTTING },
      scenario.userId,
    );
    await workflowService.consumeMaterial(
      {
        workOrderId: scenario.workOrderId,
        stageRunId: cutting.stageRunId,
        rawMaterialId: scenario.rawMaterialId,
        warehouseId: scenario.rawWarehouseId,
        plannedQuantity: 3,
        actualQuantity: 4,
        wasteQuantity: 1,
        unit: 'METER',
        idempotencyKey: `c5-consume-${randomUUID()}`,
      },
      scenario.userId,
    );
    await workflowService.recordStageOutput({
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.CUTTING,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
    });
    await workflowService.transitionStage(
      { workOrderId: scenario.workOrderId, toStage: ProductionStage.SEWING },
      scenario.userId,
    );
    await workflowService.recordStageOutput({
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.SEWING,
      inputQty: 8,
      acceptedQty: 7,
      rejectedQty: 1,
      wasteQty: 0,
    });
    await workflowService.transitionStage(
      { workOrderId: scenario.workOrderId, toStage: ProductionStage.IRONING },
      scenario.userId,
    );
    await workflowService.recordStageOutput({
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.IRONING,
      inputQty: 7,
      acceptedQty: 7,
      rejectedQty: 0,
      wasteQty: 0,
    });
    await workflowService.transitionStage(
      { workOrderId: scenario.workOrderId, toStage: ProductionStage.PACKING },
      scenario.userId,
    );
    // OPS-F05:PACKING requires a QualityCheck before the work order can
    // transition to COMPLETED via recordStageOutput. Seed one to satisfy
    // the guard introduced in WAVE2-B2.
    await prisma.qualityCheck.create({
      data: {
        workOrderId: scenario.workOrderId,
        stage: WorkOrderStatus.PACKAGING,
        checkedQty: 7,
        passedQty: 7,
        rejectedQty: 0,
        wasteQty: 0,
        unitCost: new Prisma.Decimal('2.86'),
        wasteCost: new Prisma.Decimal('0'),
        status: QualityCheckStatus.COMPLETED,
        checkedAt: new Date(),
      },
    });
    await workflowService.recordStageOutput({
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.PACKING,
      inputQty: 7,
      acceptedQty: 7,
      rejectedQty: 0,
      wasteQty: 0,
    });

    const stock = await prisma.finishedGoodStock.findUnique({
      where: {
        warehouseId_productVariantId: {
          warehouseId: (
            await prisma.warehouse.findUniqueOrThrow({
              where: { code: 'WH-FG' },
            })
          ).id,
          productVariantId: scenario.productVariantId,
        },
      },
    });
    expect(stock?.quantity).toBe(7);
    expect(Number(stock?.unitCost)).toBeCloseTo(20 / 7, 4);
    expect(
      await prisma.stockLedgerEntry.count({
        where: {
          productVariantId: scenario.productVariantId,
          type: StockMovementType.RECEIVE,
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.workOrder.findUnique({
          where: { id: scenario.workOrderId },
        })
      )?.status,
    ).toBe(WorkOrderStatus.COMPLETED);
  });
});
