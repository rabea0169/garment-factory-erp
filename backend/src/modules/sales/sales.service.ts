import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async getCustomers() {
    return this.prisma.customer.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async createCustomer(data: { name: string; phone?: string; address?: string }) {
    return this.prisma.customer.create({
      data: {
        ...data,
        code: `CUST-${Date.now()}`
      }
    });
  }

  async getSalesOrders() {
    return this.prisma.salesOrder.findMany({
      include: {
        customer: true,
        items: {
          include: { variant: { include: { product: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createSalesOrder(data: {
    customerId: string;
    userId: string;
    paymentType: any;
    discount: number;
    items: { productVariantId: string; quantity: number; unitPrice: number }[];
  }) {
    let totalAmount = 0;
    for (const item of data.items) {
      totalAmount += item.quantity * item.unitPrice;
    }
    totalAmount -= data.discount;

    return this.prisma.salesOrder.create({
      data: {
        code: `SO-${Date.now()}`,
        customerId: data.customerId,
        userId: data.userId,
        paymentType: data.paymentType,
        totalAmount,
        discount: data.discount,
        items: {
          create: data.items.map(item => ({
            productVariantId: item.productVariantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice,
          }))
        }
      }
    });
  }
}
