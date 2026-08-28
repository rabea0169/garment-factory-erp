import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkOrderStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../../events/event-types';
import { InventoryService } from '../inventory/inventory.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';
import {
  computeRequestHash,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly inventoryService: InventoryService,
  ) {}

  async getAllWorkOrders(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        skip,
        take: limit,
        include: {
          variant: { include: { product: true } },
          bomVersion: true,
          stageUpdates: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workOrder.count(),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async createWorkOrder(
    dto: { productVariantId: string; bomVersionId: string; quantity: number },
    creatorId: string,
    idempotencyKey?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      productVariantId: dto.productVariantId,
      bomVersionId: dto.bomVersionId,
      quantity: dto.quantity,
      creatorId,
    });
    const scope = 'work-order-create';
    const workOrder = await this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay)
        return replay as Awaited<ReturnType<typeof tx.workOrder.create>> & {
          replayed: true;
        };

      const created = await tx.workOrder.create({
        data: {
          code: generateDocumentCode(DocumentCodePrefix.WORK_ORDER),
          productVariantId: dto.productVariantId,
          bomVersionId: dto.bomVersionId,
          quantity: dto.quantity,
          status: WorkOrderStatus.PLANNED,
          createdById: creatorId,
        },
      });
      await storeIdempotencyResponse(tx, idempotencyKey, created);
      return created;
    });

    void this.eventEmitter.emitAsync(EVENTS.WORK_ORDER_CREATED, workOrder);
    return workOrder;
  }

  async updateOrderStatus(
    id: string,
    status: WorkOrderStatus,
    _userId?: string,
  ) {
    const existing = await this.prisma.workOrder.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Work order not found');
    }

    // 1. منع تعديل أمر تشغيل مكتمل (Immutability)
    if (existing.status === WorkOrderStatus.COMPLETED) {
      throw new BadRequestException(
        'Completed work orders are immutable. Use approved reversal workflows if needed.',
      );
    }

    // 2. منع الإكمال المباشر عبر هذا المسار (Bypass Prevention)
    if (status === WorkOrderStatus.COMPLETED) {
      throw new BadRequestException(
        'Direct completion is disabled. Use ProductionWorkflowService stages (PACKING) to complete production.',
      );
    }

    // 3. منع الانتقال المباشر لحالات الـ workflow النشطة
    const workflowStatuses: WorkOrderStatus[] = [
      WorkOrderStatus.IN_PROGRESS,
      WorkOrderStatus.CUTTING,
      WorkOrderStatus.SEWING,
      WorkOrderStatus.IRONING,
      WorkOrderStatus.FINISHING,
      WorkOrderStatus.PACKAGING,
    ];

    if (workflowStatuses.includes(status)) {
      throw new BadRequestException(
        `Direct transition to ${status} is disabled. Use ProductionWorkflowService.transitionStage instead.`,
      );
    }

    // تحديث الحالة المسموحة (مثل CANCELLED أو PLANNED)
    const order = await this.prisma.workOrder.update({
      where: { id },
      data: { status },
    });

    if (status === WorkOrderStatus.CANCELLED) {
      void this.eventEmitter.emitAsync(EVENTS.WORK_ORDER_CANCELLED, order);
    }

    return order;
  }
}
