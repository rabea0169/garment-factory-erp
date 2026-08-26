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
  QualityCheckStatus,
  QualityWasteReason,
  RejectionReason,
  WorkOrderStatus,
} from '@prisma/client';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { QualityKpiQueryDto } from './dto/quality-kpi-query.dto';

export interface CreateQualityCheckInput {
  workOrderId: string;
  stageRunId: string;
  stage: ProductionStage;
  checkedQty: number;
  passedQty: number;
  rejectedQty: number;
  wasteQty: number;
  rejectionReason?: RejectionReason;
  wasteReason?: QualityWasteReason;
  notes?: string;
}

type QualityCheckResponse = {
  id: string;
  workOrderId: string;
  stageRunId: string;
  stage: ProductionStage;
  checkedQty: number;
  passedQty: number;
  rejectedQty: number;
  wasteQty: number;
  rejectionReason: RejectionReason | null;
  wasteReason: QualityWasteReason | null;
  unitCost: number;
  wasteCost: number;
  status: string;
  createdById: string | null;
  checkedAt: Date;
  closedAt: Date;
};

function isStageRunUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown };
  return (
    candidate.code === 'P2002' &&
    JSON.stringify(candidate.meta ?? {}).includes('stageRunId')
  );
}

const LEGACY_STAGE: Record<ProductionStage, WorkOrderStatus> = {
  [ProductionStage.CUTTING]: WorkOrderStatus.CUTTING,
  [ProductionStage.SEWING]: WorkOrderStatus.SEWING,
  [ProductionStage.IRONING]: WorkOrderStatus.IRONING,
  [ProductionStage.PACKING]: WorkOrderStatus.PACKAGING,
};

@Injectable()
export class QualityService {
  constructor(private readonly prisma: PrismaService) {}

  async getQualityChecks(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const where = {};
    const options = {
      where,
      orderBy: { checkedAt: 'desc' } as const,
      skip,
      take: pageSize,
      include: {
        workOrder: {
          include: {
            variant: { include: { product: true } },
            bomVersion: true,
          },
        },
        stageRun: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.qualityCheck.findMany(options),
      this.prisma.qualityCheck.count({ where }),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  async getQualityKpis(query: QualityKpiQueryDto = new QualityKpiQueryDto()) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime()))
    ) {
      throw new BadRequestException('KPI dates must be valid ISO dates');
    }
    if (from && to && from > to) {
      throw new BadRequestException('KPI start date cannot be after end date');
    }

    const checkedAt =
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : undefined;
    const where = {
      status: QualityCheckStatus.COMPLETED,
      ...(query.workOrderId ? { workOrderId: query.workOrderId } : {}),
      ...(query.stage ? { stage: LEGACY_STAGE[query.stage] } : {}),
      ...(checkedAt ? { checkedAt } : {}),
    };
    const aggregate = await this.prisma.qualityCheck.aggregate({
      where,
      _sum: {
        checkedQty: true,
        passedQty: true,
        rejectedQty: true,
        wasteQty: true,
        wasteCost: true,
      },
    });
    const checkedQty = aggregate._sum.checkedQty ?? 0;
    const passedQty = aggregate._sum.passedQty ?? 0;
    const rejectedQty = aggregate._sum.rejectedQty ?? 0;
    const wasteQty = aggregate._sum.wasteQty ?? 0;
    const wasteCost =
      aggregate._sum.wasteCost instanceof Prisma.Decimal
        ? aggregate._sum.wasteCost.toNumber()
        : Number(aggregate._sum.wasteCost ?? 0);
    const percentage = (value: number, total: number) =>
      total === 0 ? 0 : Number(((value / total) * 100).toFixed(2));

    return {
      filters: {
        stage: query.stage ?? null,
        workOrderId: query.workOrderId ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      },
      totals: { checkedQty, passedQty, rejectedQty, wasteQty, wasteCost },
      rates: {
        passRate: percentage(passedQty, checkedQty),
        rejectionRate: percentage(rejectedQty, checkedQty),
        wasteRate: percentage(wasteQty, checkedQty),
      },
    };
  }

  async addQualityCheck(
    input: CreateQualityCheckInput,
    actorId?: string,
    idempotencyKey?: string,
  ): Promise<
    QualityCheckResponse | (QualityCheckResponse & { replayed: true })
  > {
    this.validateQuantities(input);
    const requestHash = computeRequestHash({
      ...input,
      actorId: actorId ?? null,
    });
    const scope = 'quality-check-create';

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tryReplayIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) {
          return replay as QualityCheckResponse & { replayed: true };
        }

        const [workOrder, stageRun] = await Promise.all([
          tx.workOrder.findUnique({
            where: { id: input.workOrderId },
            select: { id: true, bomVersionId: true },
          }),
          tx.productionStageRun.findFirst({
            where: { id: input.stageRunId, workOrderId: input.workOrderId },
            select: {
              id: true,
              stage: true,
              status: true,
              inputQty: true,
            },
          }),
        ]);

        if (!workOrder) {
          throw new NotFoundException('Work order not found');
        }
        if (!stageRun) {
          throw new NotFoundException(
            'Stage run not found for this work order',
          );
        }
        if (stageRun.stage !== input.stage) {
          throw new BadRequestException(
            'Quality stage must match the selected stage run',
          );
        }
        if (stageRun.status !== ProductionStageRunStatus.COMPLETED) {
          throw new ConflictException(
            'Quality can only be recorded for a completed stage run',
          );
        }
        if (input.checkedQty > stageRun.inputQty) {
          throw new BadRequestException(
            'Checked quantity cannot exceed stage input quantity',
          );
        }
        const existingCheck = await tx.qualityCheck.findUnique({
          where: { stageRunId: input.stageRunId },
          select: { id: true },
        });
        if (existingCheck) {
          throw new ConflictException(
            'A quality check already exists for this stage run',
          );
        }

        const unitCost = await this.resolveUnitCost(
          tx,
          workOrder.bomVersionId,
          input.workOrderId,
        );
        const wasteCost = new Prisma.Decimal(input.wasteQty)
          .mul(unitCost)
          .toDecimalPlaces(2);
        const idempotencyKeyId = await createIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );

        const created = await tx.qualityCheck.create({
          data: {
            workOrderId: input.workOrderId,
            stageRunId: input.stageRunId,
            stage: LEGACY_STAGE[input.stage],
            checkedQty: input.checkedQty,
            passedQty: input.passedQty,
            rejectedQty: input.rejectedQty,
            wasteQty: input.wasteQty,
            rejectionReason: input.rejectionReason,
            wasteReason: input.wasteReason,
            unitCost,
            wasteCost,
            notes: input.notes,
            createdById: actorId,
            idempotencyKeyId,
          },
        });

        const response = this.toResponse(created, input.stage);
        if (actorId) {
          await tx.activityLog.create({
            data: {
              userId: actorId,
              action: 'QUALITY_CHECK_CREATED',
              module: 'QUALITY',
              details: {
                qualityCheckId: response.id,
                workOrderId: response.workOrderId,
                stageRunId: response.stageRunId,
                stage: response.stage,
                checkedQty: response.checkedQty,
                passedQty: response.passedQty,
                rejectedQty: response.rejectedQty,
                wasteQty: response.wasteQty,
                wasteCost: response.wasteCost,
              },
            },
          });
        }
        await storeIdempotencyResponse(tx, idempotencyKey, response);
        return response;
      });
    } catch (error) {
      if (isStageRunUniqueViolation(error)) {
        throw new ConflictException(
          'A quality check already exists for this stage run',
        );
      }
      if (isIdempotencyUniqueViolation(error) && idempotencyKey) {
        const replay = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) {
          return replay as QualityCheckResponse & { replayed: true };
        }
      }
      throw error;
    }
  }

  private validateQuantities(input: CreateQualityCheckInput): void {
    const quantities = [
      input.checkedQty,
      input.passedQty,
      input.rejectedQty,
      input.wasteQty,
    ];
    if (quantities.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new BadRequestException(
        'Quality quantities must be non-negative integers',
      );
    }
    if (
      input.checkedQty !==
      input.passedQty + input.rejectedQty + input.wasteQty
    ) {
      throw new BadRequestException(
        'checkedQty must equal passedQty + rejectedQty + wasteQty',
      );
    }
    if (input.wasteQty > 0 && !input.wasteReason) {
      throw new BadRequestException(
        'wasteReason is required when wasteQty is greater than zero',
      );
    }
    if (input.rejectedQty > 0 && !input.rejectionReason) {
      throw new BadRequestException(
        'rejectionReason is required when rejectedQty is greater than zero',
      );
    }
  }

  private async resolveUnitCost(
    tx: Prisma.TransactionClient,
    bomVersionId: string,
    workOrderId: string,
  ): Promise<Prisma.Decimal> {
    const finalized = await tx.productionCostSnapshot.findFirst({
      where: { workOrderId, status: ProductionCostStatus.FINALIZED },
      orderBy: { capturedAt: 'desc' },
      select: { unitCost: true },
    });
    if (finalized?.unitCost) {
      return finalized.unitCost;
    }

    const bom = await tx.bomVersion.findUnique({
      where: { id: bomVersionId },
      include: {
        lines: { include: { rawMaterial: { select: { costPerUnit: true } } } },
      },
    });
    if (!bom) {
      throw new NotFoundException('BOM version not found');
    }

    return bom.lines.reduce(
      (sum, line) =>
        sum.add(
          new Prisma.Decimal(line.quantity).mul(line.rawMaterial.costPerUnit),
        ),
      new Prisma.Decimal(0),
    );
  }

  private toResponse(
    row: {
      id: string;
      workOrderId: string;
      stageRunId: string | null;
      checkedQty: number;
      passedQty: number;
      rejectedQty: number;
      wasteQty: number;
      rejectionReason: RejectionReason | null;
      wasteReason: QualityWasteReason | null;
      unitCost: Prisma.Decimal;
      wasteCost: Prisma.Decimal;
      status: string;
      createdById: string | null;
      checkedAt: Date;
      closedAt: Date;
    },
    stage: ProductionStage,
  ): QualityCheckResponse {
    if (!row.stageRunId) {
      throw new ConflictException(
        'A quality check must be linked to a stage run',
      );
    }
    return {
      id: row.id,
      workOrderId: row.workOrderId,
      stageRunId: row.stageRunId,
      stage,
      checkedQty: row.checkedQty,
      passedQty: row.passedQty,
      rejectedQty: row.rejectedQty,
      wasteQty: row.wasteQty,
      rejectionReason: row.rejectionReason,
      wasteReason: row.wasteReason,
      unitCost: row.unitCost.toNumber(),
      wasteCost: row.wasteCost.toNumber(),
      status: row.status,
      createdById: row.createdById,
      checkedAt: row.checkedAt,
      closedAt: row.closedAt,
    };
  }
}
