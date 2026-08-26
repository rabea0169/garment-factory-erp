import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WarehouseType } from '@prisma/client';
import { PrismaService as AppPrismaService } from '../../prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { SalesOrderStatus, ShipmentStatus } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: AppPrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async getShipments(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = {
      orderBy: { createdAt: 'desc' } as const,
      skip,
      take: pageSize,
      include: { salesOrder: { include: { customer: true } } },
    };

    const [data, total] = await Promise.all([
      this.prisma.shipment.findMany(options),
      this.prisma.shipment.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  async createShipment(data: {
    salesOrderId: string;
    shippingCompanyId?: string;
    shippingCost?: number;
    trackingNumber?: string;
    notes?: string;
  }) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: data.salesOrderId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status !== SalesOrderStatus.CONFIRMED) {
      throw new BadRequestException(
        'Cannot create shipment for an unconfirmed order',
      );
    }

    return this.prisma.shipment.create({
      data: {
        code: generateDocumentCode(DocumentCodePrefix.SHIPMENT),
        ...data,
      },
    });
  }

  async updateShipmentStatus(id: string, status: ShipmentStatus) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { salesOrder: { include: { items: true } } },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const allowed: Record<ShipmentStatus, ShipmentStatus[]> = {
      [ShipmentStatus.PREPARING]: [ShipmentStatus.SHIPPED],
      [ShipmentStatus.SHIPPED]: [ShipmentStatus.IN_TRANSIT],
      [ShipmentStatus.IN_TRANSIT]: [
        ShipmentStatus.DELIVERED,
        ShipmentStatus.RETURNED,
      ],
      [ShipmentStatus.DELIVERED]: [ShipmentStatus.RETURNED],
      [ShipmentStatus.RETURNED]: [],
    };
    if (!allowed[shipment.status].includes(status)) {
      throw new BadRequestException('Invalid shipment status transition');
    }

    if (status !== ShipmentStatus.SHIPPED) {
      return this.prisma.shipment.update({
        where: { id },
        data: {
          status,
          deliveredAt:
            status === ShipmentStatus.DELIVERED ? new Date() : undefined,
        },
      });
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        code: 'WH-FG',
        type: WarehouseType.FINISHED_GOODS,
        isActive: true,
      },
    });
    if (!warehouse)
      throw new BadRequestException('Finished goods warehouse not found');

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const transition = await tx.shipment.updateMany({
        where: { id, status: ShipmentStatus.PREPARING },
        data: { status: ShipmentStatus.SHIPPED, shippedAt: new Date() },
      });
      if (transition.count !== 1) {
        throw new BadRequestException('Shipment was changed concurrently');
      }

      for (const item of shipment.salesOrder.items) {
        await this.inventoryService.issueFinishedGood(
          {
            productVariantId: item.productVariantId,
            warehouseId: warehouse.id,
            quantity: item.quantity,
            reference: shipment.code,
            notes: `صرف شحنة ${shipment.code}`,
            idempotencyKey: `shipment.ship:${shipment.id}:${item.id}`,
          },
          undefined,
          tx,
        );
      }

      return tx.shipment.findUniqueOrThrow({ where: { id } });
    });
  }
}
