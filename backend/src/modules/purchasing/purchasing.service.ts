import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PurchaseOrderStatus, Prisma } from '@prisma/client';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async getPurchaseOrders(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        skip,
        take: limit,
        where: { supplier: { deletedAt: null } },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          items: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseOrder.count({
        where: { supplier: { deletedAt: null } },
      }),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto, creatorId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('المورد غير موجود أو غير نشط');

    const totalAmount = dto.items.reduce(
      (sum, item) => sum + item.quantity * item.unitCost,
      0,
    );

    return this.prisma.purchaseOrder.create({
      data: {
        code: generateDocumentCode(DocumentCodePrefix.PURCHASE_ORDER),
        supplierId: dto.supplierId,
        paymentType: dto.paymentType,
        totalAmount,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        notes: dto.notes,
        userId: creatorId,
        status: PurchaseOrderStatus.DRAFT,
        items: {
          create: dto.items.map((item) => ({
            rawMaterialId: item.rawMaterialId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            totalCost: item.quantity * item.unitCost,
          })),
        },
      },
      include: { items: true },
    });
  }

  async receiveOrder(orderId: string, userId: string) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status === PurchaseOrderStatus.RECEIVED) {
      throw new BadRequestException('Order is already received');
    }
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot receive a cancelled order');
    }

    const rawWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-RAW' },
    });
    if (!rawWarehouse)
      throw new BadRequestException('Default RAW warehouse not found');

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Update order status
      const updatedOrder = await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: PurchaseOrderStatus.RECEIVED },
      });

      // 2. Receive items into inventory
      for (const item of order.items) {
        await this.inventoryService.receive(
          {
            rawMaterialId: item.rawMaterialId,
            warehouseId: rawWarehouse.id,
            quantity: Number(item.quantity),
            unitCost: Number(item.unitCost), // Cost will be averaged in StockLedgerEntry
            reference: updatedOrder.code,
            notes: `استلام من أمر الشراء ${updatedOrder.code}`,
          },
          userId,
          tx,
        );
      }

      return updatedOrder;
    });
  }

  async returnToSupplier(
    orderId: string,
    itemId: string,
    quantity: number,
    userId: string,
  ) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.RECEIVED) {
      throw new BadRequestException('Can only return from received orders');
    }

    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Item not found in order');

    if (quantity > Number(item.quantity)) {
      throw new BadRequestException('Cannot return more than received');
    }

    const rawWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-RAW' },
    });
    if (!rawWarehouse)
      throw new BadRequestException('Default RAW warehouse not found');

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Issue (remove) items from inventory using RETURN type
      // Note: StockMovementType.RETURN should exist or we can use another valid type.
      // We will map it to 'RETURN' if supported, or just use issue logic
      await this.inventoryService.issue(
        {
          rawMaterialId: item.rawMaterialId,
          warehouseId: rawWarehouse.id,
          quantity: quantity,
          reference: `RET-${order.code}`,
          notes: `مرتجع للمورد من أمر الشراء ${order.code}`,
        },
        userId,
        tx,
      );

      return { success: true, message: 'Return processed' };
    });
  }
}
