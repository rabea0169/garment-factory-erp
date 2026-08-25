import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentType, SalesOrderStatus, Prisma } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async getCustomers(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count(),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async createCustomer(data: {
    name: string;
    phone?: string;
    address?: string;
  }) {
    return this.prisma.customer.create({
      data: {
        ...data,
        // A7: كود عشوائي مشفّر بدل Date.now() — يمنع الاصطدامات وكشف التوقيت.
        code: generateDocumentCode(DocumentCodePrefix.CUSTOMER),
      },
    });
  }

  async getSalesOrders(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        skip,
        take: limit,
        // B1: include مختصر — نعرض فقط بيانات العميل الأدنى (id/name/code)
        // بدلاً من كائن العميل الكامل (الذي يحوي phone/address/balance/creditLimit
        // ومعلومات حساسة). تقليل حجم الـ response ومنع تسريب بيانات غير ضرورية.
        include: {
          customer: {
            select: { id: true, name: true, code: true },
          },
          items: {
            include: { variant: { include: { product: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.salesOrder.count(),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async createSalesOrder(
    data: {
      customerId: string;
      paymentType: PaymentType;
      discount: number;
      items: {
        productVariantId: string;
        quantity: number;
      }[];
    },
    userId: string,
  ) {
    const variantIds = data.items.map((i) => i.productVariantId);

    // 1. Fetch variants to get actual prices from DB
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });

    if (variants.length !== variantIds.length) {
      throw new BadRequestException('One or more product variants not found');
    }

    // A5 (pre-check): تأكد من وفرة المخزون قبل إنشاء الأمر (fail-fast).
    // هذا الفحص استشاري فقط — الفحص atomic الحقيقي يحدث في confirmOrder
    // (لا يمكن ضمان atomicity عبر عدة طلبات HTTP). الهدف هنا منع إنشاء
    // أمر بيع لمستحيل من البداية (كمية أكبر بكثير من المتوفر).
    const availability = await Promise.all(
      data.items.map(async (item) => {
        const fg = await this.prisma.finishedGood.findFirst({
          where: { productVariantId: item.productVariantId },
          select: { quantity: true },
        });
        return {
          productVariantId: item.productVariantId,
          available: fg?.quantity ?? 0,
          requested: item.quantity,
        };
      }),
    );
    const insufficient = availability.filter((a) => a.available < a.requested);
    if (insufficient.length > 0) {
      const detail = insufficient
        .map(
          (a) =>
            `${a.productVariantId}: مطلوب ${a.requested}، متوفر ${a.available}`,
        )
        .join('; ');
      throw new BadRequestException(
        `مخزون غير كافٍ قبل إنشاء الأمر — ${detail}. يُنصح بمراجعة المخزون أو تقليل الكمية.`,
      );
    }

    let totalAmount = 0;
    const orderItemsData = data.items.map((item) => {
      const variant = variants.find((v) => v.id === item.productVariantId);
      // We will use wholesalePrice or retailPrice. For now, default to retailPrice
      const unitPrice = Number(variant!.product.retailPrice);
      const itemTotal = unitPrice * item.quantity;
      totalAmount += itemTotal;

      return {
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        unitPrice: unitPrice,
        totalPrice: itemTotal,
      };
    });

    totalAmount -= data.discount;
    if (totalAmount < 0) totalAmount = 0;

    // 2. Create the order as DRAFT
    return this.prisma.salesOrder.create({
      data: {
        // A7: كود عشوائي مشفّر YYYYMMDD-XXXXXXXX بدل Date.now().
        code: generateDocumentCode(DocumentCodePrefix.SALES_ORDER),
        customerId: data.customerId,
        userId,
        paymentType: data.paymentType,
        totalAmount,
        discount: data.discount,
        status: SalesOrderStatus.DRAFT,
        items: {
          create: orderItemsData,
        },
      },
      include: { items: true },
    });
  }

  async confirmOrder(orderId: string, userId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new BadRequestException('Can only confirm DRAFT orders');
    }

    const fgWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-FG' },
    });
    if (!fgWarehouse)
      throw new BadRequestException('Default FG warehouse not found');

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Mark order as CONFIRMED
      const updatedOrder = await tx.salesOrder.update({
        where: { id: orderId },
        data: { status: SalesOrderStatus.CONFIRMED },
      });

      // 2. Issue items from Inventory (Finished Goods)
      // A5: الطريقة atomic — نستخدم updateMany WHERE quantity >= N
      // بدلاً من findFirst+update (الذي يسمح بـ race condition بين طلبين متزامنين).
      // إذا count === 0، يعني أن مخزون آخر لحظة غير كافٍ (race-loser) — نرمي ConflictException.
      for (const item of order.items) {
        const fgRecord = await tx.finishedGood.findFirst({
          where: { productVariantId: item.productVariantId },
        });
        if (!fgRecord) {
          throw new BadRequestException(
            `لا يوجد سجل مخزون نهائي للمنتج ${item.productVariantId}`,
          );
        }

        // A5: الـ atomic decrement — WHERE quantity >= item.quantity
        // يضمن أن المستخدم الذي "يفوز" بالـ update هو الذي يرى الكمية الكافية.
        // المتزامن الآخر يرى count=0 (لأن الكمية نقصت) ويرمي ConflictException.
        const updateResult = await tx.finishedGood.updateMany({
          where: {
            id: fgRecord.id,
            quantity: { gte: item.quantity },
          },
          data: {
            quantity: { decrement: item.quantity },
          },
        });

        if (updateResult.count === 0) {
          // Race-loser — مستخدم آخر أخذ المخزون بين pre-check و update.
          throw new ConflictException(
            `فشل صرف ${item.quantity} من المنتج ${item.productVariantId} — المخزون الحالي غير كافٍ. يُرجى إعادة المراجعة.`,
          );
        }

        // A5: الكمية الجديدة محسوبة بعد الـ atomic update — نقرأها مرة أخرى.
        const updatedFg = await tx.finishedGood.findUnique({
          where: { id: fgRecord.id },
          select: { quantity: true },
        });
        const newBalance = updatedFg?.quantity ?? 0;

        await tx.stockLedgerEntry.create({
          data: {
            // A7: كود عشوائي مشفّر
            entryCode: generateDocumentCode(
              DocumentCodePrefix.STOCK_LEDGER_ENTRY,
            ),
            type: 'ISSUE', // StockMovementType.ISSUE
            warehouseId: fgWarehouse.id,
            productVariantId: item.productVariantId,
            quantityDelta: -item.quantity,
            balanceAfter: newBalance,
            reference: updatedOrder.code,
            notes: `صرف فاتورة مبيعات ${updatedOrder.code}`,
            createdById: userId,
          },
        });
      }

      return updatedOrder;
    });
  }
}
