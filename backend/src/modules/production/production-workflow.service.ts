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
import { createHash, randomUUID } from 'node:crypto';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';

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
  idempotencyKey?: string;
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

export interface StageOutputResult {
  replayed: boolean;
  workOrderId: string;
  stage: ProductionStage;
  stageRunId: string;
  status: ProductionStageRunStatus;
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

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'P2002';
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
    private readonly financialPosting: FinancialPostingService,
  ) {}

  async transitionStage(
    input: TransitionStageInput,
    actorId: string,
  ): Promise<StageTransitionResult> {
    const hash = requestHash(input);
    const replay = await this.findTransitionReplay(input.idempotencyKey, hash);
    if (replay) return replay;

    try {
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
    } catch (error) {
      // Two identical requests can pass the pre-check concurrently. Once the
      // winner commits the unique idempotency key, return its committed result.
      if (input.idempotencyKey && isUniqueConstraintViolation(error)) {
        const replay = await this.findTransitionReplay(
          input.idempotencyKey,
          hash,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }

  async recordStageOutput(
    input: RecordStageOutputInput,
    actorId?: string,
  ): Promise<StageOutputResult> {
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

    const hash = requestHash(input);
    const replay = await this.findStageOutputReplay(input.idempotencyKey, hash);
    if (replay) return replay;

    // OPS-F03: Prevent production workflow bypass — load the work order first and
    // reject any non-active status. CANCELLED/COMPLETED orders must not accept new
    // stage output. Done outside the transaction so idempotency replay (above)
    // wins, but bypass rejection still triggers for callers without a key.
    const workOrderStatus = await this.prisma.workOrder.findUnique({
      where: { id: input.workOrderId },
      select: { status: true },
    });
    if (!workOrderStatus) {
      throw new NotFoundException('Work order not found');
    }
    if (
      workOrderStatus.status === WorkOrderStatus.CANCELLED ||
      workOrderStatus.status === WorkOrderStatus.COMPLETED
    ) {
      throw new BadRequestException(
        'لا يمكن تسجيل إنتاج على أمر تشغيل بحالة ' + workOrderStatus.status,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        let stageRun = await tx.productionStageRun.findUnique({
          where: {
            workOrderId_stage: {
              workOrderId: input.workOrderId,
              stage: input.stage,
            },
          },
          include: {
            workOrder: {
              select: {
                currentStage: true,
                productVariantId: true,
                code: true,
                status: true,
              },
            },
          },
        });
        if (!stageRun) throw new NotFoundException('Stage run not found');
        // Serialize completions for the same stage. A pre-check outside the
        // transaction cannot distinguish two requests that arrive together.
        // Re-read after the row lock so the loser observes the committed key or
        // completion from the winner instead of throwing a false conflict.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM production_stage_runs WHERE id = ${stageRun.id} FOR UPDATE`,
        );
        stageRun = await tx.productionStageRun.findUnique({
          where: { id: stageRun.id },
          include: {
            workOrder: {
              select: {
                currentStage: true,
                productVariantId: true,
                code: true,
                status: true,
              },
            },
          },
        });
        if (!stageRun) throw new NotFoundException('Stage run not found');

        // OPS-F03 (defense-in-depth inside tx): re-check after acquiring locks.
        if (
          stageRun.workOrder.status === WorkOrderStatus.CANCELLED ||
          stageRun.workOrder.status === WorkOrderStatus.COMPLETED
        ) {
          throw new BadRequestException(
            'لا يمكن تسجيل إنتاج على أمر تشغيل بحالة ' +
              stageRun.workOrder.status,
          );
        }

        if (input.idempotencyKey) {
          const existingKey = await tx.idempotencyKey.findUnique({
            where: { key: input.idempotencyKey },
          });
          if (existingKey) {
            if (
              existingKey.scope !== 'production.stage-output' ||
              existingKey.requestHash !== hash
            ) {
              throw new ConflictException('Idempotency key payload mismatch');
            }
            if (existingKey.response) {
              return {
                ...(existingKey.response as Omit<
                  StageOutputResult,
                  'replayed'
                >),
                replayed: true,
              } satisfies StageOutputResult;
            }
            // Older completed stage outputs may have the relation saved but
            // no response JSON. Treat the committed stage run as a replay too.
            if (
              stageRun.status === ProductionStageRunStatus.COMPLETED &&
              stageRun.idempotencyKeyId === existingKey.id
            ) {
              return {
                replayed: true,
                workOrderId: stageRun.workOrderId,
                stage: stageRun.stage,
                stageRunId: stageRun.id,
                status: stageRun.status,
              } satisfies StageOutputResult;
            }
            throw new ConflictException('العملية السابقة لم تكتمل بعد');
          }
        }

        if (stageRun.workOrder.currentStage !== input.stage) {
          throw new BadRequestException(
            'Stage output must be recorded for the current production stage',
          );
        }
        if (stageRun.status === ProductionStageRunStatus.COMPLETED) {
          throw new ConflictException('Stage run is already completed');
        }
        if (stageRun.status === ProductionStageRunStatus.CANCELLED) {
          throw new BadRequestException('Stage run is cancelled');
        }

        let idempotencyKeyId: string | undefined;
        if (input.idempotencyKey) {
          const key = await tx.idempotencyKey.create({
            data: {
              key: input.idempotencyKey,
              scope: 'production.stage-output',
              requestHash: hash,
            },
            select: { id: true },
          });
          idempotencyKeyId = key.id;
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
            idempotencyKeyId,
          },
        });

        const result = {
          replayed: false,
          workOrderId: input.workOrderId,
          stage: input.stage,
          stageRunId: stageRun.id,
          status: ProductionStageRunStatus.COMPLETED,
        } satisfies StageOutputResult;

        if (input.idempotencyKey) {
          await tx.idempotencyKey.update({
            where: { key: input.idempotencyKey },
            data: { response: result },
          });
        }

        if (actorId) {
          await tx.activityLog.create({
            data: {
              userId: actorId,
              action: 'PRODUCTION_STAGE_OUTPUT_RECORDED',
              module: 'production',
              details: {
                workOrderId: input.workOrderId,
                stage: input.stage,
                inputQty: input.inputQty,
                acceptedQty: input.acceptedQty,
                rejectedQty: input.rejectedQty,
                wasteQty: input.wasteQty,
              },
            },
          });
        }

        if (
          input.stage !== ProductionStage.PACKING ||
          input.acceptedQty === 0
        ) {
          return result;
        }

        // OPS-F05: لا يمكن إكمال أمر تشغيل دون فحص جودة موثَّق. التحقق داخل
        // الـ tx قبل نقل الحالة إلى COMPLETED حتى يبقى ذريًا مع باقي الكتابات.
        const qcCount = await tx.qualityCheck.count({
          where: { workOrderId: input.workOrderId },
        });
        if (qcCount === 0) {
          throw new BadRequestException(
            'لا يمكن إكمال أمر تشغيل دون فحص جودة موثَّق',
          );
        }

        const warehouse = await tx.warehouse.findFirst({
          where: {
            code: 'WH-FG',
            type: 'FINISHED_GOODS',
            isActive: true,
          },
        });
        if (!warehouse) {
          throw new BadRequestException(
            'مخزن المنتج التام الافتراضي غير موجود',
          );
        }

        const consumptions = await tx.productionMaterialConsumption.findMany({
          where: { workOrderId: input.workOrderId },
        });
        if (consumptions.length === 0) {
          throw new BadRequestException(
            'لا يمكن ترحيل المنتج التام قبل تسجيل استهلاك خامات وتكلفة أمر التشغيل',
          );
        }
        const materialCost = consumptions.reduce(
          (sum, row) => sum.add(row.totalCost),
          new Prisma.Decimal(0),
        );
        const wasteCost = consumptions.reduce(
          (sum, row) => sum.add(row.wasteCost),
          new Prisma.Decimal(0),
        );
        const unitCost = materialCost.div(input.acceptedQty).toDecimalPlaces(4);
        await tx.productionCostSnapshot.upsert({
          where: {
            workOrderId_status: {
              workOrderId: input.workOrderId,
              status: ProductionCostStatus.FINALIZED,
            },
          },
          update: {
            materialCost,
            wasteCost,
            totalCost: materialCost,
            acceptedQty: input.acceptedQty,
            unitCost,
            capturedAt: new Date(),
          },
          create: {
            workOrderId: input.workOrderId,
            status: ProductionCostStatus.FINALIZED,
            materialCost,
            wasteCost,
            totalCost: materialCost,
            acceptedQty: input.acceptedQty,
            unitCost,
          },
        });

        // Atomic weighted-average receipt into the authoritative finished-good stock.
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "finished_good_stocks"
          ("id", "warehouseId", "productVariantId", "quantity", "unitCost", "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${warehouse.id}, ${stageRun.workOrder.productVariantId}, ${input.acceptedQty}, ${unitCost}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("warehouseId", "productVariantId") DO UPDATE SET
          "unitCost" = CASE
            WHEN "finished_good_stocks"."quantity" + EXCLUDED."quantity" = 0 THEN 0
            ELSE (("finished_good_stocks"."quantity" * "finished_good_stocks"."unitCost") + (EXCLUDED."quantity" * EXCLUDED."unitCost"))
              / ("finished_good_stocks"."quantity" + EXCLUDED."quantity")
          END,
          "quantity" = "finished_good_stocks"."quantity" + EXCLUDED."quantity",
          "updatedAt" = CURRENT_TIMESTAMP`,
        );
        const stock = await tx.finishedGoodStock.findUniqueOrThrow({
          where: {
            warehouseId_productVariantId: {
              warehouseId: warehouse.id,
              productVariantId: stageRun.workOrder.productVariantId,
            },
          },
        });
        await tx.stockLedgerEntry.create({
          data: {
            entryCode: `SLE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`,
            type: 'RECEIVE',
            warehouseId: warehouse.id,
            productVariantId: stageRun.workOrder.productVariantId,
            quantityDelta: input.acceptedQty,
            balanceAfter: stock.quantity,
            unitCost,
            totalValue: unitCost.mul(input.acceptedQty),
            reference: stageRun.workOrder.code,
            notes: `إنتاج تام من التعبئة ${stageRun.workOrder.code}`,
          },
        });
        await tx.workOrder.update({
          where: { id: input.workOrderId },
          data: {
            status: WorkOrderStatus.COMPLETED,
            completedQty: { increment: input.acceptedQty },
            rejectedQty: { increment: input.rejectedQty },
            wasteQty: { increment: input.wasteQty },
            endDate: new Date(),
          },
        });

        // ACC-F01 / OPS-F01: قيد GL لترحيل تكلفة الخامات المستهلكة من WIP
        // إلى مخزون المنتج التام. يُستخدم postingKey مستقر (مرتبط بمعرّف أمر
        // التشغيل) فيمنع الترحيل المزدوج عبر الـ unique constraint على
        // JournalEntry.postingKey. الكمية المُرحَّلة = إجمالي totalCost لكل
        // سجلات ProductionMaterialConsumption على هذا الـ WorkOrder.
        const glAmount = materialCost.toNumber();
        if (glAmount > 0) {
          await this.financialPosting.postJournalEntryInTx(
            tx,
            {
              description:
                'ترحيل إنتاج تام من أمر تشغيل #' + stageRun.workOrder.code,
              reference: stageRun.workOrder.code,
              postingKey: 'production-completion:' + input.workOrderId,
              isAuto: true,
              lines: [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK,
                  creditAccountId: CHART_OF_ACCOUNTS.WIP,
                  amount: glAmount,
                  description:
                    'ترحيل تكلفة خامات إلى مخزون المنتج التام — أمر تشغيل ' +
                    stageRun.workOrder.code,
                },
              ],
              userId: actorId,
              metadata: {
                source: 'production.completion',
                workOrderId: input.workOrderId,
                acceptedQty: input.acceptedQty,
              },
            },
            actorId,
          );
        }
        return result;
      });
    } catch (error) {
      if (input.idempotencyKey && isUniqueConstraintViolation(error)) {
        const replay = await this.findStageOutputReplay(
          input.idempotencyKey,
          hash,
        );
        if (replay) return replay;
      }
      throw error;
    }
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

    try {
      return await this.prisma.$transaction(async (tx) => {
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
            notes:
              input.notes ?? `Production consumption for ${stageRun.stage}`,
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
    } catch (error) {
      // Two identical requests can pass the pre-check concurrently. Once the
      // winner commits the unique idempotency key, return its committed result.
      if (input.idempotencyKey && isUniqueConstraintViolation(error)) {
        const replay = await this.findConsumptionReplay(
          input.idempotencyKey,
          hash,
        );
        if (replay) return replay;
      }
      throw error;
    }
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
    const latestCompletedStageRun = stageRuns
      .filter((row) => row.status === ProductionStageRunStatus.COMPLETED)
      .sort((a, b) => b.sequence - a.sequence)[0];
    // Each stage reports the same units at a different routing point. The
    // denominator must therefore be the latest completed output, not the sum
    // of accepted quantities across all stages.
    const acceptedQty = latestCompletedStageRun?.acceptedQty ?? 0;
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
      include: {
        toRun: true,
        workOrder: { select: { stageVersion: true } },
      },
    });
    if (!transition || !transition.toRun) return null;
    return {
      replayed: true,
      transitionId: transition.id,
      workOrderId: transition.workOrderId,
      fromStage: transition.fromStage,
      toStage: transition.toStage,
      stageRunId: transition.toRun.id,
      stageVersion: transition.workOrder.stageVersion,
    };
  }

  private async findStageOutputReplay(
    key: string | undefined,
    hash: string,
  ): Promise<StageOutputResult | null> {
    if (!key) return null;
    const idempotency = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });
    if (!idempotency) return null;
    if (idempotency.scope !== 'production.stage-output') {
      throw new ConflictException('Idempotency key scope mismatch');
    }
    if (idempotency.requestHash !== hash) {
      throw new ConflictException('Idempotency key payload mismatch');
    }
    const stageRun = await this.prisma.productionStageRun.findUnique({
      where: { idempotencyKeyId: idempotency.id },
    });
    if (!stageRun || stageRun.status !== ProductionStageRunStatus.COMPLETED) {
      return null;
    }
    return {
      replayed: true,
      workOrderId: stageRun.workOrderId,
      stage: stageRun.stage,
      stageRunId: stageRun.id,
      status: stageRun.status,
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
