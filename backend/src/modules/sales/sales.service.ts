import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentType, SalesOrderStatus, Prisma } from '@prisma/client';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async getCustomers() {
    return this.prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCustomer(data: {
    name: string;
    phone?: string;
    address?: string;
  }) {
    return this.prisma.customer.create({
      data: {
        ...data,
        code: `CUST-${Date.now()}`,
      },
    });
  }

  async getSalesOrders() {
    return this.prisma.salesOrder.findMany({
      include: {
        customer: true,
        items: {
          include: { variant: { include: { product: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
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
        code: `SO-${Date.now()}`,
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
      for (const item of order.items) {
        const fgRecord = await tx.finishedGood.findFirst({
          where: { productVariantId: item.productVariantId },
        });

        const currentQty = fgRecord?.quantity || 0;
        if (currentQty < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product variant ${item.productVariantId}`,
          );
        }

        const newBalance = currentQty - item.quantity;
        await tx.finishedGood.update({
          where: { id: fgRecord!.id },
          data: { quantity: newBalance },
        });

        await tx.stockLedgerEntry.create({
          data: {
            entryCode: `SLE-${Date.now()}-${Math.random().toString(36).substring(7)}`,
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
