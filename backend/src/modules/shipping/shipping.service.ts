import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SalesOrderStatus,
  ShipmentStatus,
  WarehouseType,
} from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
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

  async createShipment(
    data: {
      salesOrderId: string;
      shippingCompanyId?: string;
      shippingCost?: number;
      trackingNumber?: string;
      notes?: string;
    },
    actorId: string,
    idempotencyKey?: string,
  ) {
    const requestHash = computeRequestHash({
      operation: 'shipping.shipment.create',
      actorId,
      salesOrderId: data.salesOrderId,
      shippingCompanyId: data.shippingCompanyId ?? null,
      shippingCost: data.shippingCost ?? null,
      trackingNumber: data.trackingNumber ?? null,
      notes: data.notes ?? null,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      'shipping.shipment.create',
      requestHash,
    );
    if (replay) return replay;

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

    try {
      return await this.prisma.$transaction(async (tx) => {
        const idempotencyKeyId = await createIdempotencyKey(
          tx,
          idempotencyKey,
          'shipping.shipment.create',
          requestHash,
        );
        const created = await tx.shipment.create({
          data: {
            code: generateDocumentCode(DocumentCodePrefix.SHIPMENT),
            ...data,
            idempotencyKeyId,
          },
        });
        const response = {
          ...created,
          shippingCost: Number(created.shippingCost),
        };
        await storeIdempotencyResponse(tx, idempotencyKey, response);
        return created;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          'shipping.shipment.create',
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  async updateShipmentStatus(
    id: string,
    status: ShipmentStatus,
    actorId: string,
    proofOfDelivery?: string,
  ) {
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
    if (status === ShipmentStatus.DELIVERED && !proofOfDelivery?.trim()) {
      throw new BadRequestException(
        'إثبات التسليم مطلوب عند تحويل الشحنة إلى DELIVERED',
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const result = await tx.shipment.updateMany({
        where: { id, status: shipment.status },
        data: {
          status,
          shippedAt:
            status === ShipmentStatus.SHIPPED ? new Date() : shipment.shippedAt,
          deliveredAt:
            status === ShipmentStatus.DELIVERED
              ? new Date()
              : shipment.deliveredAt,
          proofOfDelivery:
            status === ShipmentStatus.DELIVERED
              ? proofOfDelivery?.trim()
              : undefined,
          deliveredById:
            status === ShipmentStatus.DELIVERED ? actorId : undefined,
        },
      });
      if (result.count !== 1) {
        throw new ConflictException('Shipment status changed concurrently');
      }

      if (status === ShipmentStatus.SHIPPED) {
        const warehouse = await tx.warehouse.findFirst({
          where: {
            code: 'WH-FG',
            type: WarehouseType.FINISHED_GOODS,
            isActive: true,
          },
        });
        if (!warehouse) {
          throw new BadRequestException('Finished goods warehouse not found');
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
            actorId,
            tx,
          );
        }
      }

      const updated = await tx.shipment.findUnique({ where: { id } });
      if (!updated) throw new NotFoundException('Shipment not found');
      await tx.activityLog.create({
        data: {
          userId: actorId,
          action: 'SHIPMENT_STATUS_CHANGED',
          module: 'SHIPPING',
          details: {
            shipmentId: id,
            from: shipment.status,
            to: status,
            proofOfDelivery: status === ShipmentStatus.DELIVERED,
          },
        },
      });
      return updated;
    });
  }
}
