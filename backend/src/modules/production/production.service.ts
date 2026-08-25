import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkOrderStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../../events/event-types';

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getAllWorkOrders() {
    return this.prisma.workOrder.findMany({
      include: {
        product: true,
        stageUpdates: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createWorkOrder(
    dto: { productId: string; quantity: number },
    creatorId: string,
  ) {
    const workOrder = await this.prisma.workOrder.create({
      data: {
        code: `WO-${Date.now()}`,
        productId: dto.productId,
        quantity: dto.quantity,
        status: WorkOrderStatus.PLANNED,
        // P0-04: الهوية من الجلسة (يمررها الـ controller) — تُتجاهل أي قيمة من body
        createdById: creatorId,
      },
    });

    this.eventEmitter.emit(EVENTS.WORK_ORDER_CREATED, workOrder);
    return workOrder;
  }

  async updateOrderStatus(id: string, status: WorkOrderStatus) {
    const order = await this.prisma.workOrder.update({
      where: { id },
      data: { status },
    });

    if (status === WorkOrderStatus.COMPLETED) {
      // NOTE: Should map to a variant in a real app, assuming first variant for now
      const variant = await this.prisma.productVariant.findFirst({
        where: { productId: order.productId },
      });
      if (variant) {
        await this.prisma.finishedGood.create({
          data: {
            productVariantId: variant.id,
            quantity: order.quantity,
          },
        });
      }
      this.eventEmitter.emit(EVENTS.WORK_ORDER_COMPLETED, order);
    }

    return order;
  }
}
