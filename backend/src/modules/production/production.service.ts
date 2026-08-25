import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkOrderStatus, StockMovementType, Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../../events/event-types';
import { InventoryService } from '../inventory/inventory.service';

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly inventoryService: InventoryService,
  ) {}

  async getAllWorkOrders() {
    return this.prisma.workOrder.findMany({
      include: {
        variant: { include: { product: true } },
        bomVersion: true,
        stageUpdates: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createWorkOrder(
    dto: { productVariantId: string; bomVersionId: string; quantity: number },
    creatorId: string,
  ) {
    const workOrder = await this.prisma.workOrder.create({
      data: {
        code: `WO-${Date.now()}`,
        productVariantId: dto.productVariantId,
        bomVersionId: dto.bomVersionId,
        quantity: dto.quantity,
        status: WorkOrderStatus.PLANNED,
        createdById: creatorId,
      },
    });

    this.eventEmitter.emit(EVENTS.WORK_ORDER_CREATED, workOrder);
    return workOrder;
  }

  async updateOrderStatus(
    id: string,
    status: WorkOrderStatus,
    userId?: string,
  ) {
    if (status !== WorkOrderStatus.COMPLETED) {
      // تحديث الحالة العادية فقط بدون صرف استثنائي
      const order = await this.prisma.workOrder.update({
        where: { id },
        data: { status },
      });
      return order;
    }

    // إتمام الإنتاج: صرف خامات + استلام منتج تام
    const order = await this.prisma.workOrder.findUnique({
      where: { id },
      include: {
        bomVersion: { include: { lines: true } },
      },
    });

    if (!order) throw new NotFoundException('Work order not found');
    if (order.status === WorkOrderStatus.COMPLETED) {
      throw new BadRequestException('Work order is already completed');
    }

    // المخازن الافتراضية
    const rawWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-RAW' },
    });
    const fgWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-FG' },
    });
    if (!rawWarehouse || !fgWarehouse) {
      throw new BadRequestException('Default warehouses not found');
    }

    const updatedOrder = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. تحديث الحالة
        const updated = await tx.workOrder.update({
          where: { id },
          data: { status: WorkOrderStatus.COMPLETED },
        });

        // 2. صرف الخامات وفقاً لـ BOM Version (GF-0008)
        for (const line of order.bomVersion.lines) {
          const totalQty = Number(line.quantity) * order.quantity;
          await this.inventoryService.issue(
            {
              rawMaterialId: line.rawMaterialId,
              warehouseId: rawWarehouse.id,
              quantity: totalQty,
              reference: updated.code,
              notes: `صرف خامات لأمر تشغيل ${updated.code}`,
            },
            userId,
            tx,
          );
        }

        // 3. استلام التام في المخزن
        const fgRecord = await tx.finishedGood.findFirst({
          where: { productVariantId: order.productVariantId },
        });

        const newBalance = (fgRecord?.quantity || 0) + order.quantity;

        if (fgRecord) {
          await tx.finishedGood.update({
            where: { id: fgRecord.id },
            data: { quantity: newBalance },
          });
        } else {
          await tx.finishedGood.create({
            data: {
              productVariantId: order.productVariantId,
              quantity: newBalance,
            },
          });
        }

        // إدراج حركة ledger للتام
        await tx.stockLedgerEntry.create({
          data: {
            entryCode: `SLE-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            type: StockMovementType.RECEIVE,
            warehouseId: fgWarehouse.id,
            productVariantId: order.productVariantId,
            quantityDelta: order.quantity,
            balanceAfter: newBalance,
            reference: updated.code,
            notes: `استلام تام من أمر تشغيل ${updated.code}`,
            createdById: userId,
          },
        });

        return updated;
      },
    );

    this.eventEmitter.emit(EVENTS.WORK_ORDER_COMPLETED, updatedOrder);
    return updatedOrder;
  }
}
