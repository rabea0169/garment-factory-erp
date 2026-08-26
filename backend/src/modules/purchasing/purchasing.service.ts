import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PurchaseOrderStatus, Prisma } from '@prisma/client';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';

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

  async createReceipt(
    orderId: string,
    dto: CreatePurchaseReceiptDto,
    userId: string,
    idempotencyKey?: string,
  ) {
    if (!dto.items.length) {
      throw new BadRequestException(
        'يجب أن يحتوي إذن الاستلام على بند واحد على الأقل',
      );
    }

    const requestHash = computeRequestHash({
      orderId,
      items: dto.items,
      notes: dto.notes ?? null,
      userId,
    });
    const scope = 'purchasing-receipt-create';
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    const itemIds = dto.items.map((item) => item.purchaseOrderItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException(
        'لا يجوز تكرار بند أمر الشراء في إذن الاستلام',
      );
    }

    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot receive a cancelled order');
    }

    const existing = await this.prisma.purchaseReceiptItem.findMany({
      where: { purchaseOrderItemId: { in: itemIds } },
      select: { purchaseOrderItemId: true, quantity: true },
    });
    const receivedByItem = new Map<string, number>();
    for (const item of existing) {
      receivedByItem.set(
        item.purchaseOrderItemId,
        (receivedByItem.get(item.purchaseOrderItemId) ?? 0) +
          Number(item.quantity),
      );
    }

    const orderItems = new Map(order.items.map((item) => [item.id, item]));
    for (const item of dto.items) {
      const orderItem = orderItems.get(item.purchaseOrderItemId);
      if (!orderItem) throw new NotFoundException('Item not found in order');
      const alreadyReceived = receivedByItem.get(item.purchaseOrderItemId) ?? 0;
      if (alreadyReceived + item.quantity > Number(orderItem.quantity)) {
        throw new BadRequestException(
          `كمية الاستلام تتجاوز المتبقي للبند ${item.purchaseOrderItemId}`,
        );
      }
    }

    const rawWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-RAW' },
    });
    if (!rawWarehouse) {
      throw new BadRequestException('Default RAW warehouse not found');
    }

    try {
      return await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const receiptIdempotencyKeyId = await createIdempotencyKey(
            tx,
            idempotencyKey,
            scope,
            requestHash,
          );
          const receipt = await tx.purchaseReceipt.create({
            data: {
              code: generateDocumentCode(DocumentCodePrefix.PURCHASE_RECEIPT),
              purchaseOrderId: orderId,
              userId,
              notes: dto.notes,
              idempotencyKeyId: receiptIdempotencyKeyId,
              items: {
                create: dto.items.map((item) => ({
                  purchaseOrderItemId: item.purchaseOrderItemId,
                  quantity: item.quantity,
                })),
              },
            },
            include: { items: true },
          });

          for (const item of dto.items) {
            const orderItem = orderItems.get(item.purchaseOrderItemId);
            if (!orderItem) {
              throw new NotFoundException('Item not found in order');
            }
            await this.inventoryService.receive(
              {
                rawMaterialId: orderItem.rawMaterialId,
                warehouseId: rawWarehouse.id,
                quantity: item.quantity,
                unitCost: Number(orderItem.unitCost),
                reference: receipt.code,
                notes: `استلام ${receipt.code} من أمر الشراء ${order.code}`,
              },
              userId,
              tx,
            );
          }

          const allReceived = order.items.every((item) => {
            const previous = receivedByItem.get(item.id) ?? 0;
            const current =
              dto.items.find(
                (receiptItem) => receiptItem.purchaseOrderItemId === item.id,
              )?.quantity ?? 0;
            return previous + current >= Number(item.quantity);
          });
          await tx.purchaseOrder.update({
            where: { id: orderId },
            data: {
              status: allReceived
                ? PurchaseOrderStatus.RECEIVED
                : PurchaseOrderStatus.PENDING,
            },
          });

          await storeIdempotencyResponse(tx, idempotencyKey, {
            id: receipt.id,
            code: receipt.code,
          });
          return receipt;
        },
      );
    } catch (error) {
      if (isIdempotencyUniqueViolation(error) && idempotencyKey) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
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
