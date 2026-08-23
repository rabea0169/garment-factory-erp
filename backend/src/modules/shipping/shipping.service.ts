import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  async getShipments() {
    return this.prisma.shipment.findMany({
      orderBy: { createdAt: 'desc' },
      include: { salesOrder: { include: { customer: true } } }
    });
  }

  async createShipment(data: any) {
    return this.prisma.shipment.create({
      data: {
        code: `SHP-${Date.now()}`,
        ...data
      }
    });
  }
}
