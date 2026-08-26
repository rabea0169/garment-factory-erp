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
import { ReturnToSupplierDto } from './dto/return-to-supplier.dto';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
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
    private readonly financialPosting: FinancialPostingService,
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

    const existing =
      (await this.prisma.purchaseReceiptItem.findMany({
        where: { purchaseOrderItemId: { in: itemIds } },
        select: { purchaseOrderItemId: true, quantity: true },
      })) || [];
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
          // Serialize all receipts for one purchase order. The preflight checks
          // above are only for fast feedback; this lock is the source of truth
          // against two concurrent receipts exceeding the ordered quantity.
          const lockedOrder = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT id FROM purchase_orders WHERE id = ${orderId} FOR UPDATE`,
          );
          if (lockedOrder.length === 0) {
            throw new NotFoundException('Purchase order not found');
          }

          const currentOrder = await tx.purchaseOrder.findUnique({
            where: { id: orderId },
            include: { items: true },
          });
          if (!currentOrder) {
            throw new NotFoundException('Purchase order not found');
          }
          if (currentOrder.status === PurchaseOrderStatus.CANCELLED) {
            throw new BadRequestException('Cannot receive a cancelled order');
          }

          const currentExisting = await tx.purchaseReceiptItem.findMany({
            where: {
              purchaseOrderItemId: {
                in: currentOrder.items.map((item) => item.id),
              },
            },
            select: { purchaseOrderItemId: true, quantity: true },
          });
          const currentReceivedByItem = new Map<string, number>();
          for (const item of currentExisting) {
            currentReceivedByItem.set(
              item.purchaseOrderItemId,
              (currentReceivedByItem.get(item.purchaseOrderItemId) ?? 0) +
                Number(item.quantity),
            );
          }
          const currentOrderItems = new Map(
            currentOrder.items.map((item) => [item.id, item]),
          );
          for (const item of dto.items) {
            const orderItem = currentOrderItems.get(item.purchaseOrderItemId);
            if (!orderItem) {
              throw new NotFoundException('Item not found in order');
            }
            const alreadyReceived =
              currentReceivedByItem.get(item.purchaseOrderItemId) ?? 0;
            if (alreadyReceived + item.quantity > Number(orderItem.quantity)) {
              throw new BadRequestException(
                `كمية الاستلام تتجاوز المتبقي للبند ${item.purchaseOrderItemId}`,
              );
            }
          }

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

          let receiptTotal = 0;
          for (const item of dto.items) {
            const orderItem = currentOrderItems.get(item.purchaseOrderItemId);
            if (!orderItem) {
              throw new NotFoundException('Item not found in order');
            }
            receiptTotal += item.quantity * Number(orderItem.unitCost);
            await this.inventoryService.receive(
              {
                rawMaterialId: orderItem.rawMaterialId,
                warehouseId: rawWarehouse.id,
                quantity: item.quantity,
                unitCost: Number(orderItem.unitCost),
                reference: receipt.code,
                notes: `استلام ${receipt.code} من أمر الشراء ${currentOrder.code}`,
              },
              userId,
              tx,
            );
          }

          await this.financialPosting.postJournalEntryInTx(
            tx,
            {
              description: `استلام مشتريات ${receipt.code}`,
              reference: receipt.code,
              isAuto: true,
              lines: [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.INVENTORY,
                  creditAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
                  amount: receiptTotal,
                  description: `إثبات مخزون مقابل مورد ${currentOrder.supplierId}`,
                },
              ],
              supplierUpdates: [
                { supplierId: currentOrder.supplierId, delta: receiptTotal },
              ],
              metadata: {
                source: 'PURCHASE_RECEIPT',
                purchaseReceiptId: receipt.id,
              },
              postingKey: `purchasing.grn:${receipt.id}`,
            },
            userId,
          );

          const allReceived = currentOrder.items.every((item) => {
            const previous = currentReceivedByItem.get(item.id) ?? 0;
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

    // 1. Safe rejection for final states before unnecessary queries
    if (order.status === PurchaseOrderStatus.RECEIVED) {
      throw new BadRequestException('Order is already fully received');
    }
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot receive a cancelled order');
    }

    // 2. Fetch existing receipts to calculate remaining quantities
    // Use fallback to empty array to handle potential mock issues in tests
    const existingItems =
      (await this.prisma.purchaseReceiptItem.findMany({
        where: { purchaseOrderItemId: { in: order.items.map((i) => i.id) } },
      })) || [];

    const receivedMap = new Map<string, number>();
    existingItems.forEach((ei) => {
      receivedMap.set(
        ei.purchaseOrderItemId,
        (receivedMap.get(ei.purchaseOrderItemId) ?? 0) + Number(ei.quantity),
      );
    });

    const itemsToReceive = order.items
      .map((item) => ({
        purchaseOrderItemId: item.id,
        quantity: Number(item.quantity) - (receivedMap.get(item.id) ?? 0),
      }))
      .filter((item) => item.quantity > 0);

    if (itemsToReceive.length === 0) {
      throw new BadRequestException('All items are already received');
    }

    const dto: CreatePurchaseReceiptDto = {
      items: itemsToReceive,
      notes: `استلام كامل (legacy) لأمر الشراء ${order.code}`,
    };

    // Derive the legacy key from the remaining quantities. A key based only on
    // orderId would replay an earlier legacy receipt after a later partial receipt.
    const remainingHash = computeRequestHash({
      operation: 'purchasing.legacy-receive',
      orderId,
      items: itemsToReceive,
    }).slice(0, 16);
    const idempotencyKey = `legacy-receive-${order.id}-${remainingHash}`;

    return this.createReceipt(orderId, dto, userId, idempotencyKey);
  }

  async returnToSupplier(
    orderId: string,
    dto: ReturnToSupplierDto,
    userId: string,
    idempotencyKey?: string,
  ) {
    const requestHash = computeRequestHash({
      orderId,
      dto,
      userId,
    });
    const scope = 'purchasing-return-create';

    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Purchase order not found');

    // Safe rejection for invalid states before unnecessary queries
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot return from a cancelled order');
    }
    if (order.status === PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Cannot return from a draft order');
    }

    const item = order.items.find((i) => i.id === dto.purchaseOrderItemId);
    if (!item) throw new NotFoundException('Item not found in order');

    const rawWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-RAW' },
    });
    if (!rawWarehouse)
      throw new BadRequestException('Default RAW warehouse not found');

    try {
      return await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // Serialize returns for one purchase order before calculating the
          // cumulative returned quantity. This prevents two distinct keys from
          // both passing the limit check concurrently.
          const lockedOrder = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT id FROM purchase_orders WHERE id = ${orderId} FOR UPDATE`,
          );
          if (lockedOrder.length === 0) {
            throw new NotFoundException('Purchase order not found');
          }

          const returnIdempotencyKeyId = await createIdempotencyKey(
            tx,
            idempotencyKey,
            scope,
            requestHash,
          );

          // 1. Calculate cumulative received quantity
          const receipts = await tx.purchaseReceiptItem.aggregate({
            where: { purchaseOrderItemId: dto.purchaseOrderItemId },
            _sum: { quantity: true },
          });
          const totalReceived = Number(receipts._sum.quantity ?? 0);

          // 2. Calculate cumulative returned quantity
          // We use the reference field as a matchable anchor since the schema lacks a dedicated return table
          const referenceAnchor = `PURCHASE_RETURN_ITEM:${dto.purchaseOrderItemId}`;
          const returns = await tx.stockLedgerEntry.aggregate({
            where: {
              rawMaterialId: item.rawMaterialId,
              reference: { startsWith: referenceAnchor },
            },
            _sum: { quantityDelta: true },
          });
          const totalReturned = Math.abs(
            Number(returns._sum.quantityDelta ?? 0),
          );

          if (totalReturned + dto.quantity > totalReceived) {
            throw new BadRequestException(
              `الكمية المرتجعة (${totalReturned + dto.quantity}) تتجاوز الكمية المستلمة (${totalReceived})`,
            );
          }

          // 3. Issue items from inventory
          // Note: We use the referenceAnchor to allow cumulative tracking
          const result = await this.inventoryService.issue(
            {
              rawMaterialId: item.rawMaterialId,
              warehouseId: rawWarehouse.id,
              quantity: dto.quantity,
              reference: `${referenceAnchor}:${returnIdempotencyKeyId ?? 'manual'}`,
              notes: dto.notes ?? `مرتجع للمورد من أمر الشراء ${order.code}`,
              idempotencyKey: idempotencyKey
                ? `return-${idempotencyKey}`
                : undefined,
            },
            userId,
            tx,
          );

          const returnValue = Number(result.totalValue ?? 0);
          if (!Number.isFinite(returnValue) || returnValue <= 0) {
            throw new BadRequestException(
              'تعذر تحديد تكلفة المرتجع من حركة المخزون',
            );
          }
          const returnReference = `PURCHASE_RETURN:${order.code}:${dto.purchaseOrderItemId}:${returnIdempotencyKeyId ?? result.entryCode}`;
          const supplierUpdates = [
            { supplierId: order.supplierId, delta: -returnValue },
          ];
          const posting = await this.financialPosting.postJournalEntryInTx(
            tx,
            {
              description: `عكس مخزون مرتجع للمورد ${order.code}`,
              reference: returnReference,
              postingKey: idempotencyKey
                ? `purchasing-return:${idempotencyKey}`
                : undefined,
              isAuto: true,
              lines: [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
                  creditAccountId: CHART_OF_ACCOUNTS.INVENTORY,
                  amount: returnValue,
                  description: `تخفيض التزام المورد مقابل مرتجع ${order.code}`,
                },
              ],
              userId,
              supplierUpdates,
              metadata: {
                source: 'PURCHASE_RETURN',
                purchaseOrderId: order.id,
                purchaseOrderItemId: dto.purchaseOrderItemId,
                supplierUpdates,
              },
            },
            userId,
          );

          const response = {
            success: true,
            message: 'Return processed',
            entryCode: result.entryCode,
            journalEntryCode: posting.entryCode,
          };

          if (idempotencyKey) {
            await storeIdempotencyResponse(tx, idempotencyKey, response);
          }

          return response;
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
}
