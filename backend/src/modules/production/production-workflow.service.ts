import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductionCostStatus,
  ProductionStage,
  ProductionStageRunStatus,
  ProductionWasteReason,
  WorkOrderStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface TransitionStageInput {
  workOrderId: string;
  toStage: ProductionStage;
  reason?: string;
  idempotencyKey?: string;
}

export interface RecordStageOutputInput {
  workOrderId: string;
  stage: ProductionStage;
  inputQty: number;
  acceptedQty: number;
  rejectedQty: number;
  wasteQty: number;
  notes?: string;
}

export interface ConsumeMaterialInput {
  workOrderId: string;
  stageRunId: string;
  rawMaterialId: string;
  warehouseId: string;
  plannedQuantity: number;
  actualQuantity: number;
  wasteQuantity: number;
  unit: string;
  wasteReason?: string;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface StageTransitionResult {
  replayed: boolean;
  transitionId: string;
  workOrderId: string;
  fromStage: ProductionStage | null;
  toStage: ProductionStage;
  stageRunId: string;
  stageVersion: number;
}

export interface MaterialConsumptionResult {
  replayed: boolean;
  consumptionId: string;
  workOrderId: string;
  stageRunId: string;
  stockLedgerEntryId: string;
  actualQuantity: number;
  wasteQuantity: number;
  unitCost: number;
  totalCost: number;
  wasteCost: number;
}

const STAGE_ORDER: readonly ProductionStage[] = [
  ProductionStage.CUTTING,
  ProductionStage.SEWING,
  ProductionStage.IRONING,
  ProductionStage.PACKING,
];

function requestHash(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function assertNonNegativeQuantities(values: Record<string, number>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`${name} must be a non-negative number`);
    }
  }
}

@Injectable()
export class ProductionWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async transitionStage(
    input: TransitionStageInput,
    actorId: string,
  ): Promise<StageTransitionResult> {
    const hash = requestHash(input);
    const replay = await this.findTransitionReplay(input.idempotencyKey, hash);
    if (replay) return replay;

    const result = await this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.findUnique({
        where: { id: input.workOrderId },
      });
      if (!workOrder) throw new NotFoundException('Work order not found');
      if (
        workOrder.status === WorkOrderStatus.COMPLETED ||
        workOrder.status === WorkOrderStatus.CANCELLED
      ) {
        throw new BadRequestException('Work order is not active');
      }

      const targetIndex = STAGE_ORDER.indexOf(input.toStage);
      const currentIndex = workOrder.currentStage
        ? STAGE_ORDER.indexOf(workOrder.currentStage)
        : -1;
      if (targetIndex < 0) {
        throw new BadRequestException('Unsupported production stage');
      }
      if (targetIndex !== currentIndex + 1) {
        throw new BadRequestException(
          `Invalid stage transition from ${workOrder.currentStage ?? 'START'} to ${input.toStage}`,
        );
      }

      const fromRun = workOrder.currentStage
        ? await tx.productionStageRun.findUnique({
            where: {
              workOrderId_stage: {
                workOrderId: workOrder.id,
                stage: workOrder.currentStage,
              },
            },
          })
        : null;
      if (
        workOrder.currentStage &&
        (!fromRun || fromRun.status !== ProductionStageRunStatus.COMPLETED)
      ) {
        throw new BadRequestException(
          'Current production stage must be completed before advancing',
        );
      }

      const toRun = await tx.productionStageRun.create({
        data: {
          workOrderId: workOrder.id,
          stage: input.toStage,
          sequence: targetIndex + 1,
          status: ProductionStageRunStatus.IN_PROGRESS,
          plannedQty: workOrder.quantity,
          inputQty: workOrder.quantity,
        },
      });

      let idempotencyKeyId: string | undefined;
      if (input.idempotencyKey) {
        const key = await tx.idempotencyKey.create({
          data: {
            key: input.idempotencyKey,
            scope: 'production.transition',
            requestHash: hash,
          },
          select: { id: true },
        });
        idempotencyKeyId = key.id;
      }

      const updated = await tx.workOrder.update({
        where: { id: workOrder.id },
        data: {
          currentStage: input.toStage,
          status: WorkOrderStatus.IN_PROGRESS,
          stageVersion: { increment: 1 },
          startDate: workOrder.startDate ?? new Date(),
        },
      });

      const transition = await tx.workOrderStageTransition.create({
        data: {
          workOrderId: workOrder.id,
          fromStage: workOrder.currentStage,
          toStage: input.toStage,
          fromStatus: workOrder.status,
          toStatus: WorkOrderStatus.IN_PROGRESS,
          fromRunId: fromRun?.id,
          toRunId: toRun.id,
          actorId,
          reason: input.reason,
          idempotencyKeyId,
        },
      });

      return {
        replayed: false,
        transitionId: transition.id,
        workOrderId: updated.id,
        fromStage: workOrder.currentStage,
        toStage: input.toStage,
        stageRunId: toRun.id,
        stageVersion: updated.stageVersion,
      } satisfies StageTransitionResult;
    });

    return result;
  }

  async recordStageOutput(input: RecordStageOutputInput): Promise<void> {
    assertNonNegativeQuantities({
      inputQty: input.inputQty,
      acceptedQty: input.acceptedQty,
      rejectedQty: input.rejectedQty,
      wasteQty: input.wasteQty,
    });
    if (
      input.inputQty !==
      input.acceptedQty + input.rejectedQty + input.wasteQty
    ) {
      throw new BadRequestException(
        'inputQty must equal acceptedQty + rejectedQty + wasteQty',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const stageRun = await tx.productionStageRun.findUnique({
        where: {
          workOrderId_stage: {
            workOrderId: input.workOrderId,
            stage: input.stage,
          },
        },
      });
      if (!stageRun) throw new NotFoundException('Stage run not found');
      if (stageRun.status === ProductionStageRunStatus.COMPLETED) {
        throw new ConflictException('Stage run is already completed');
      }
      if (stageRun.status === ProductionStageRunStatus.CANCELLED) {
        throw new BadRequestException('Stage run is cancelled');
      }

      await tx.productionStageRun.update({
        where: { id: stageRun.id },
        data: {
          inputQty: input.inputQty,
          acceptedQty: input.acceptedQty,
          rejectedQty: input.rejectedQty,
          wasteQty: input.wasteQty,
          status: ProductionStageRunStatus.COMPLETED,
          completedAt: new Date(),
          notes: input.notes,
        },
      });
    });
  }

  async consumeMaterial(
    input: ConsumeMaterialInput,
    actorId: string,
  ): Promise<MaterialConsumptionResult> {
    assertNonNegativeQuantities({
      plannedQuantity: input.plannedQuantity,
      actualQuantity: input.actualQuantity,
      wasteQuantity: input.wasteQuantity,
    });
    if (input.wasteQuantity > input.actualQuantity) {
      throw new BadRequestException(
        'wasteQuantity cannot exceed actualQuantity',
      );
    }

    const hash = requestHash(input);
    const replay = await this.findConsumptionReplay(input.idempotencyKey, hash);
    if (replay) return replay;

    return this.prisma.$transaction(async (tx) => {
      const stageRun = await tx.productionStageRun.findUnique({
        where: { id: input.stageRunId },
      });
      if (!stageRun || stageRun.workOrderId !== input.workOrderId) {
        throw new NotFoundException('Stage run not found for work order');
      }
      if (stageRun.status === ProductionStageRunStatus.CANCELLED) {
        throw new BadRequestException('Stage run is cancelled');
      }

      let idempotencyKeyId: string | undefined;
      if (input.idempotencyKey) {
        const key = await tx.idempotencyKey.create({
          data: {
            key: input.idempotencyKey,
            scope: 'production.consume',
            requestHash: hash,
          },
          select: { id: true },
        });
        idempotencyKeyId = key.id;
      }

      const inventoryResult = await this.inventoryService.issue(
        {
          rawMaterialId: input.rawMaterialId,
          warehouseId: input.warehouseId,
          quantity: input.actualQuantity,
          reference: input.reference ?? input.workOrderId,
          notes: input.notes ?? `Production consumption for ${stageRun.stage}`,
          idempotencyKey: input.idempotencyKey
            ? `production.consume.inventory:${input.idempotencyKey}`
            : undefined,
        },
        actorId,
        tx,
      );

      const ledgerEntry = await tx.stockLedgerEntry.findUnique({
        where: { entryCode: inventoryResult.entryCode },
        select: { id: true },
      });
      if (!ledgerEntry) {
        throw new ConflictException('Inventory ledger entry was not found');
      }

      const unitCost = new Prisma.Decimal(inventoryResult.unitCost ?? 0);
      const actualQuantity = new Prisma.Decimal(input.actualQuantity);
      const wasteQuantity = new Prisma.Decimal(input.wasteQuantity);
      const totalCost = actualQuantity.mul(unitCost).toDecimalPlaces(2);
      const wasteCost = wasteQuantity.mul(unitCost).toDecimalPlaces(2);
      const variance = actualQuantity
        .sub(new Prisma.Decimal(input.plannedQuantity))
        .toDecimalPlaces(4);

      const consumption = await tx.productionMaterialConsumption.create({
        data: {
          workOrderId: input.workOrderId,
          stageRunId: input.stageRunId,
          rawMaterialId: input.rawMaterialId,
          warehouseId: input.warehouseId,
          stockLedgerEntryId: ledgerEntry.id,
          idempotencyKeyId,
          plannedQuantity: input.plannedQuantity,
          actualQuantity,
          variance,
          wasteQuantity,
          unit: input.unit,
          unitCost,
          totalCost,
          wasteCost,
          wasteReason: input.wasteReason as ProductionWasteReason | undefined,
          notes: input.notes,
          createdById: actorId,
        },
      });

      return {
        replayed: false,
        consumptionId: consumption.id,
        workOrderId: consumption.workOrderId,
        stageRunId: consumption.stageRunId,
        stockLedgerEntryId: ledgerEntry.id,
        actualQuantity: actualQuantity.toNumber(),
        wasteQuantity: wasteQuantity.toNumber(),
        unitCost: unitCost.toNumber(),
        totalCost: totalCost.toNumber(),
        wasteCost: wasteCost.toNumber(),
      } satisfies MaterialConsumptionResult;
    });
  }

  async finalizeCost(workOrderId: string, actorId?: string) {
    const [consumptions, stageRuns] = await Promise.all([
      this.prisma.productionMaterialConsumption.findMany({
        where: { workOrderId },
      }),
      this.prisma.productionStageRun.findMany({
        where: { workOrderId },
      }),
    ]);
    if (consumptions.length === 0) {
      throw new NotFoundException('No material consumption found');
    }

    const materialCost = consumptions.reduce(
      (sum, row) => sum.add(row.totalCost),
      new Prisma.Decimal(0),
    );
    const wasteCost = consumptions.reduce(
      (sum, row) => sum.add(row.wasteCost),
      new Prisma.Decimal(0),
    );
    const acceptedQty = stageRuns.reduce(
      (sum, row) => sum + row.acceptedQty,
      0,
    );
    const unitCost =
      acceptedQty > 0 ? materialCost.div(acceptedQty).toDecimalPlaces(4) : null;

    return this.prisma.productionCostSnapshot.upsert({
      where: {
        workOrderId_status: {
          workOrderId,
          status: ProductionCostStatus.FINALIZED,
        },
      },
      update: {
        materialCost,
        wasteCost,
        totalCost: materialCost,
        acceptedQty,
        unitCost,
        capturedAt: new Date(),
        createdById: actorId,
      },
      create: {
        workOrderId,
        status: ProductionCostStatus.FINALIZED,
        materialCost,
        wasteCost,
        totalCost: materialCost,
        acceptedQty,
        unitCost,
        createdById: actorId,
      },
    });
  }

  private async findTransitionReplay(
    key: string | undefined,
    hash: string,
  ): Promise<StageTransitionResult | null> {
    if (!key) return null;
    const idempotency = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });
    if (!idempotency) return null;
    if (idempotency.requestHash !== hash) {
      throw new ConflictException('Idempotency key payload mismatch');
    }
    const transition = await this.prisma.workOrderStageTransition.findUnique({
      where: { idempotencyKeyId: idempotency.id },
      include: { toRun: true },
    });
    if (!transition || !transition.toRun) return null;
    return {
      replayed: true,
      transitionId: transition.id,
      workOrderId: transition.workOrderId,
      fromStage: transition.fromStage,
      toStage: transition.toStage,
      stageRunId: transition.toRun.id,
      stageVersion: transition.toRun.sequence,
    };
  }

  private async findConsumptionReplay(
    key: string | undefined,
    hash: string,
  ): Promise<MaterialConsumptionResult | null> {
    if (!key) return null;
    const idempotency = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });
    if (!idempotency) return null;
    if (idempotency.requestHash !== hash) {
      throw new ConflictException('Idempotency key payload mismatch');
    }
    const consumption =
      await this.prisma.productionMaterialConsumption.findUnique({
        where: { idempotencyKeyId: idempotency.id },
        include: { stockLedgerEntry: true },
      });
    if (!consumption || !consumption.stockLedgerEntry) return null;
    return {
      replayed: true,
      consumptionId: consumption.id,
      workOrderId: consumption.workOrderId,
      stageRunId: consumption.stageRunId,
      stockLedgerEntryId: consumption.stockLedgerEntry.id,
      actualQuantity: Number(consumption.actualQuantity),
      wasteQuantity: Number(consumption.wasteQuantity),
      unitCost: Number(consumption.unitCost),
      totalCost: Number(consumption.totalCost),
      wasteCost: Number(consumption.wasteCost),
    };
  }
}
