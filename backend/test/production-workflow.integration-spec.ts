import {
  ProductionStage,
  ProductionStageRunStatus,
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
import { PrismaService } from '../src/prisma/prisma.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

type Scenario = {
  userId: string;
  rawWarehouseId: string;
  finishedGoodsWarehouseId: string;
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
    inventoryService = new InventoryService(prisma, new EventEmitter2());
    workflowService = new ProductionWorkflowService(prisma, inventoryService);
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

    const finishedGoodsWarehouse = await prisma.warehouse.create({
      data: {
        code: `GF13-FG-${randomUUID().slice(0, 8)}`,
        name: 'GF-0013 Finished Goods Test Warehouse',
        type: WarehouseType.FINISHED_GOODS,
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
      finishedGoodsWarehouseId: finishedGoodsWarehouse.id,
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

  it('records consumption, calculates material waste cost, and replays safely', async () => {
    const transition = await workflowService.transitionStage(
      {
        workOrderId: scenario.workOrderId,
        toStage: ProductionStage.CUTTING,
      },
      scenario.userId,
    );
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
    await workflowService.recordStageOutput({
      workOrderId: scenario.workOrderId,
      stage: ProductionStage.CUTTING,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
    });

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

  it('posts accepted PACKING output to finished-good stock and ledger exactly once', async () => {
    const stages = [
      { stage: ProductionStage.CUTTING, inputQty: 10, acceptedQty: 9 },
      { stage: ProductionStage.SEWING, inputQty: 9, acceptedQty: 8 },
      { stage: ProductionStage.IRONING, inputQty: 8, acceptedQty: 7 },
      { stage: ProductionStage.PACKING, inputQty: 7, acceptedQty: 6 },
    ];

    for (const [index, output] of stages.entries()) {
      const transition = await workflowService.transitionStage(
        {
          workOrderId: scenario.workOrderId,
          toStage: output.stage,
        },
        scenario.userId,
      );
      expect(transition.toStage).toBe(output.stage);

      await workflowService.recordStageOutput(
        {
          workOrderId: scenario.workOrderId,
          stage: output.stage,
          inputQty: output.inputQty,
          acceptedQty: output.acceptedQty,
          rejectedQty: index === stages.length - 1 ? 0 : 1,
          wasteQty: index === stages.length - 1 ? 1 : 0,
          ...(output.stage === ProductionStage.PACKING
            ? { finishedGoodsWarehouseId: scenario.finishedGoodsWarehouseId }
            : {}),
        },
        scenario.userId,
      );
    }

    const stock = await prisma.finishedGoodStock.findUnique({
      where: {
        warehouseId_productVariantId: {
          warehouseId: scenario.finishedGoodsWarehouseId,
          productVariantId: scenario.productVariantId,
        },
      },
    });
    expect(stock?.quantity).toBe(6);

    const finishedLedger = await prisma.stockLedgerEntry.findFirst({
      where: {
        warehouseId: scenario.finishedGoodsWarehouseId,
        productVariantId: scenario.productVariantId,
        type: StockMovementType.RECEIVE,
      },
    });
    expect(Number(finishedLedger?.quantityDelta)).toBe(6);
    expect(Number(finishedLedger?.balanceAfter)).toBe(6);

    const workOrder = await prisma.workOrder.findUnique({
      where: { id: scenario.workOrderId },
    });
    expect(workOrder).toMatchObject({
      status: WorkOrderStatus.COMPLETED,
      currentStage: ProductionStage.PACKING,
      completedQty: 6,
      rejectedQty: 0,
      wasteQty: 1,
    });

    await expect(
      workflowService.recordStageOutput(
        {
          workOrderId: scenario.workOrderId,
          stage: ProductionStage.PACKING,
          inputQty: 7,
          acceptedQty: 6,
          rejectedQty: 0,
          wasteQty: 1,
          finishedGoodsWarehouseId: scenario.finishedGoodsWarehouseId,
        },
        scenario.userId,
      ),
    ).rejects.toThrow('already completed');

    expect(
      await prisma.stockLedgerEntry.count({
        where: {
          warehouseId: scenario.finishedGoodsWarehouseId,
          productVariantId: scenario.productVariantId,
          type: StockMovementType.RECEIVE,
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
