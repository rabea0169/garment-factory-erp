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
  ) {
    const workOrder = await this.prisma.workOrder.create({
      data: {
        code: generateDocumentCode(DocumentCodePrefix.WORK_ORDER),
        productVariantId: dto.productVariantId,
        bomVersionId: dto.bomVersionId,
        quantity: dto.quantity,
        status: WorkOrderStatus.PLANNED,
        createdById: creatorId,
      },
    });

    void this.eventEmitter.emitAsync(EVENTS.WORK_ORDER_CREATED, workOrder);
    return workOrder;
  }

  async updateOrderStatus(
    id: string,
    status: WorkOrderStatus,
    _userId?: string,
  ) {
    const order = await this.prisma.workOrder.findUnique({
      where: { id },
    });

    if (!order) throw new NotFoundException('Work order not found');

    // GF-AUDIT-001C: منع تعديل المكتمل
    if (order.status === WorkOrderStatus.COMPLETED) {
      throw new BadRequestException('Work order is already completed');
    }

    // GF-AUDIT-001C: منع الإكمال المباشر بلا مراحل (تجاوز الـ workflow)
    if (status === WorkOrderStatus.COMPLETED) {
      throw new BadRequestException(
        'Work orders must be completed via the production workflow (packing stage)',
      );
    }

    // منع الحالات التي يجب أن تتم عبر الـ workflow
    const workflowStatuses: WorkOrderStatus[] = [
      WorkOrderStatus.CUTTING,
      WorkOrderStatus.SEWING,
      WorkOrderStatus.FINISHING,
      WorkOrderStatus.IRONING,
      WorkOrderStatus.PACKAGING,
      WorkOrderStatus.IN_PROGRESS,
    ];

    if (workflowStatuses.includes(status)) {
      throw new BadRequestException(
        `Status ${status} is deprecated for direct updates. Use production workflow transitions.`,
      );
    }

    // السماح فقط بالإلغاء كمسار إداري سريع
    if (status !== WorkOrderStatus.CANCELLED) {
      throw new BadRequestException(
        `Direct status update to ${status} is not allowed.`,
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      // Re-fetch inside transaction for concurrency safety
      const currentOrder = await tx.workOrder.findUnique({
        where: { id },
      });

      if (!currentOrder) throw new NotFoundException('Work order not found');
      if (currentOrder.status === WorkOrderStatus.COMPLETED) {
        throw new BadRequestException('Work order is already completed');
      }

      if (
        status === WorkOrderStatus.CANCELLED &&
        currentOrder.status === WorkOrderStatus.CANCELLED
      ) {
        return currentOrder;
      }

      const updated = await tx.workOrder.update({
        where: { id },
        data: { status },
      });

      if (status === WorkOrderStatus.CANCELLED) {
        void this.eventEmitter.emitAsync(EVENTS.WORK_ORDER_CANCELLED, updated);
      }

      return updated;
    });
  }
}
