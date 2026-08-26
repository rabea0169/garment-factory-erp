import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkOrderStatus, Prisma } from '@prisma/client';
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
        bomVersion: {
          include: {
            lines: {
              include: { rawMaterial: { select: { costPerUnit: true } } },
            },
          },
        },
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

        // 3. استلام التام عبر مصدر الحقيقة الوحيد FinishedGoodStock + ledger.
        const totalMaterialCost = order.bomVersion.lines.reduce(
          (sum, line) =>
            sum +
            Number(line.quantity) *
              order.quantity *
              Number(line.rawMaterial.costPerUnit),
          0,
        );
        const unitCost =
          order.quantity > 0 ? totalMaterialCost / order.quantity : 0;
        await this.inventoryService.receiveFinishedGood(
          {
            productVariantId: order.productVariantId,
            warehouseId: fgWarehouse.id,
            quantity: order.quantity,
            unitCost,
            reference: updated.code,
            notes: `استلام تام من أمر تشغيل ${updated.code}`,
            idempotencyKey: `production.legacy.receive:${updated.id}`,
          },
          userId,
          tx,
        );

        return updated;
      },
    );

    void this.eventEmitter.emitAsync(EVENTS.WORK_ORDER_COMPLETED, updatedOrder);
    return updatedOrder;
  }
}
