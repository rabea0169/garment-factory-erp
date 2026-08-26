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
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
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

          let receiptTotal = 0;
          for (const item of dto.items) {
            const orderItem = orderItems.get(item.purchaseOrderItemId);
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
                notes: `استلام ${receipt.code} من أمر الشراء ${order.code}`,
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
                  description: `إثبات مخزون مقابل مورد ${order.supplierId}`,
                },
              ],
              supplierUpdates: [
                { supplierId: order.supplierId, delta: receiptTotal },
              ],
              metadata: {
                source: 'PURCHASE_RECEIPT',
                purchaseReceiptId: receipt.id,
              },
              postingKey: `purchasing.grn:${receipt.id}`,
            },
            userId,
          );

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

  async receiveOrder(orderId: string, userId: string, idempotencyKey?: string) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status === PurchaseOrderStatus.RECEIVED) {
      throw new BadRequestException('Order is already received');
    }

    // حساب الكميات المتبقية للاستلام
    const existingReceipts = await this.prisma.purchaseReceiptItem.findMany({
      where: { purchaseOrderItemId: { in: order.items.map((i) => i.id) } },
      select: { purchaseOrderItemId: true, quantity: true },
    });

    const receivedMap = new Map<string, number>();
    for (const r of existingReceipts) {
      receivedMap.set(
        r.purchaseOrderItemId,
        (receivedMap.get(r.purchaseOrderItemId) ?? 0) + Number(r.quantity),
      );
    }

    const itemsToReceive = order.items
      .map((item) => ({
        purchaseOrderItemId: item.id,
        quantity: Number(item.quantity) - (receivedMap.get(item.id) ?? 0),
      }))
      .filter((item) => item.quantity > 0);

    if (itemsToReceive.length === 0) {
      // تحديث الحالة إذا كانت الكميات مستلمة بالفعل ولكن الحالة لم تتحدث
      return this.prisma.purchaseOrder.update({
        where: { id: orderId },
        data: { status: PurchaseOrderStatus.RECEIVED },
      });
    }

    return this.createReceipt(
      orderId,
      {
        items: itemsToReceive,
        notes: 'استلام كامل (مسار legacy)',
      },
      userId,
      idempotencyKey,
    );
  }

  async returnToSupplier(
    orderId: string,
    dto: CreatePurchaseReturnDto,
    userId: string,
    idempotencyKey?: string,
  ) {
    const requestHash = computeRequestHash({
      orderId,
      items: dto.items,
      notes: dto.notes ?? null,
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

    const itemIds = dto.items.map((i) => i.purchaseOrderItemId);
    const orderItems = new Map(order.items.map((i) => [i.id, i]));

    // التحقق من الكميات المستلمة والمرتجعة سابقًا
    const receipts = await this.prisma.purchaseReceiptItem.findMany({
      where: { purchaseOrderItemId: { in: itemIds } },
      select: { purchaseOrderItemId: true, quantity: true },
    });

    const ledgerReturns = await this.prisma.stockLedgerEntry.findMany({
      where: {
        type: 'RETURN',
        reference: { startsWith: `RET-${order.code}` },
      },
      select: { reference: true, quantityDelta: true },
    });

    const receivedMap = new Map<string, number>();
    for (const r of receipts) {
      receivedMap.set(
        r.purchaseOrderItemId,
        (receivedMap.get(r.purchaseOrderItemId) ?? 0) + Number(r.quantity),
      );
    }

    const returnedMap = new Map<string, number>();
    for (const r of ledgerReturns) {
      // نفترض أن المرجع هو RET-ORDERCODE-ITEMID
      const parts = r.reference?.split('-');
      const itemId = parts?.[parts.length - 1];
      if (itemId) {
        returnedMap.set(
          itemId,
          (returnedMap.get(itemId) ?? 0) + Math.abs(Number(r.quantityDelta)),
        );
      }
    }

    for (const item of dto.items) {
      const orderItem = orderItems.get(item.purchaseOrderItemId);
      if (!orderItem) throw new NotFoundException('Item not found in order');

      const netReceived =
        (receivedMap.get(item.purchaseOrderItemId) ?? 0) -
        (returnedMap.get(item.purchaseOrderItemId) ?? 0);

      if (item.quantity > netReceived) {
        throw new BadRequestException(
          `كمية المرتجع (${item.quantity}) تتجاوز الكمية المتاحة للاسترجاع (${netReceived}) للبند ${item.purchaseOrderItemId}`,
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
          await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);

          let returnTotal = 0;
          const results: any[] = [];

          for (const item of dto.items) {
            const orderItem = orderItems.get(item.purchaseOrderItemId)!;
            returnTotal += item.quantity * Number(orderItem.unitCost);

            const movement = await this.inventoryService.return(
              {
                rawMaterialId: orderItem.rawMaterialId,
                warehouseId: rawWarehouse.id,
                quantity: item.quantity,
                reference: `RET-${order.code}-${item.purchaseOrderItemId}`,
                notes: dto.notes ?? `مرتجع للمورد: ${order.code}`,
                idempotencyKey: idempotencyKey
                  ? `${idempotencyKey}-${item.purchaseOrderItemId}`
                  : undefined,
              },
              userId,
              tx,
            );
            results.push(movement);
          }

          // الترحيل المالي: عكس الاستلام (مدين للمورد، دائن للمخزون)
          await this.financialPosting.postJournalEntryInTx(
            tx,
            {
              description: `مرتجع مشتريات ${order.code}`,
              reference: `RET-${order.code}`,
              isAuto: true,
              lines: [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
                  creditAccountId: CHART_OF_ACCOUNTS.INVENTORY,
                  amount: returnTotal,
                  description: `عكس إثبات مخزون للمورد ${order.supplierId}`,
                },
              ],
              supplierUpdates: [
                { supplierId: order.supplierId, delta: -returnTotal },
              ],
              metadata: {
                source: 'PURCHASE_RETURN',
                orderId: order.id,
                itemIds: itemIds,
              },
              postingKey: `purchasing.return:${order.id}:${requestHash}`,
            },
            userId,
          );

          // تحديث حالة الطلب إذا لزم الأمر
          // إذا تم إرجاع كل شيء، ربما يظل RECEIVED أو PENDING؟
          // حسب المتطلبات، سنبقيها PENDING إذا كان هناك متبقي للاستلام
          const allReceived = order.items.every((item) => {
            const net =
              (receivedMap.get(item.id) ?? 0) -
              (returnedMap.get(item.id) ?? 0) -
              (dto.items.find((i) => i.purchaseOrderItemId === item.id)
                ?.quantity ?? 0);
            return net >= Number(item.quantity);
          });

          await tx.purchaseOrder.update({
            where: { id: orderId },
            data: {
              status: allReceived
                ? PurchaseOrderStatus.RECEIVED
                : PurchaseOrderStatus.PENDING,
            },
          });

          const response = { success: true, results };
          await storeIdempotencyResponse(tx, idempotencyKey, response);
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
