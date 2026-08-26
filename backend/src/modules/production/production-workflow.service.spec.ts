import { Test, TestingModule } from '@nestjs/testing';
import { ProductionWorkflowService } from './production-workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  ProductionStage,
  ProductionStageRunStatus,
  WorkOrderStatus,
} from '@prisma/client';
import {
  createPrismaMock,
  PrismaMock,
} from '../../../test/helpers/prisma-mock';

describe('ProductionWorkflowService', () => {
  let service: ProductionWorkflowService;
  let prisma: PrismaMock;
  let inventoryService: {
    issue: jest.Mock;
    receiveFinishedGood: jest.Mock;
  };

  beforeEach(async () => {
    prisma = createPrismaMock();
    inventoryService = {
      issue: jest.fn(),
      receiveFinishedGood: jest.fn(),
    };

    // GF-0013: Ensure $transaction returns the mock itself to allow nested calls
    prisma.$transaction.mockImplementation((cb: (tx: PrismaMock) => unknown) =>
      cb(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: inventoryService },
      ],
    }).compile();

    service = module.get<ProductionWorkflowService>(ProductionWorkflowService);
  });

  describe('recordStageOutput', () => {
    it('يمنع تسجيل مخرجات لمرحلة غير الحالية', async () => {
      prisma.productionStageRun.findUnique.mockResolvedValue({
        id: 'run-1',
        workOrderId: 'wo-1',
        stage: ProductionStage.CUTTING,
        status: ProductionStageRunStatus.IN_PROGRESS,
        workOrder: { currentStage: ProductionStage.SEWING },
      });

      await expect(
        service.recordStageOutput({
          workOrderId: 'wo-1',
          stage: ProductionStage.CUTTING,
          inputQty: 10,
          acceptedQty: 10,
          rejectedQty: 0,
          wasteQty: 0,
        }),
      ).rejects.toThrow(
        'Stage output must be recorded for the current production stage',
      );
    });

    it('إتمام الإنتاج عند مرحلة PACKING: يحدّث المخزون والتكلفة والحالة', async () => {
      const workOrderId = 'wo-1';
      const stage = ProductionStage.PACKING;

      prisma.productionStageRun.findUnique.mockResolvedValue({
        id: 'run-packing',
        workOrderId,
        stage,
        status: ProductionStageRunStatus.IN_PROGRESS,
        workOrder: {
          currentStage: stage,
          productVariantId: 'v-1',
          code: 'WO-1',
        },
      });

      prisma.warehouse.findFirst.mockResolvedValue({
        id: 'wh-fg',
        code: 'WH-FG',
      });

      prisma.productionMaterialConsumption.findMany.mockResolvedValue([
        { totalCost: 100, wasteCost: 10 },
      ]);

      prisma.finishedGoodStock.findUniqueOrThrow.mockResolvedValue({
        quantity: 10,
      });

      // mock executeRaw to avoid error
      prisma.$executeRaw.mockResolvedValue(1);

      await service.recordStageOutput({
        workOrderId,
        stage,
        inputQty: 10,
        acceptedQty: 10,
        rejectedQty: 0,
        wasteQty: 0,
      });

      expect(prisma.productionStageRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ProductionStageRunStatus.COMPLETED,
          }) as unknown,
        }) as unknown,
      );

      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: workOrderId },
          data: expect.objectContaining({
            status: WorkOrderStatus.COMPLETED,
          }) as unknown,
        }) as unknown,
      );

      expect(prisma.stockLedgerEntry.create).toHaveBeenCalled();
    });
  });
});
