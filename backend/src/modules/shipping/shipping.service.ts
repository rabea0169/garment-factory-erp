import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesOrderStatus, ShipmentStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';

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
    private readonly financialPosting: FinancialPostingService,
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
      treasuryId?: string;
      accrueToPayable?: boolean;
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
      treasuryId: data.treasuryId ?? null,
      accrueToPayable: data.accrueToPayable ?? false,
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
      select: { id: true, status: true, code: true },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status !== SalesOrderStatus.CONFIRMED) {
      throw new BadRequestException(
        'Cannot create shipment for an unconfirmed order',
      );
    }

    // COMM-F11 / ACC-F03: GL posting for shipping cost. Three modes:
    //   (a) treasuryId + shippingCost > 0 → Dr Shipping Expense / Cr Cash
    //       + treasury balance update (cash sale of shipping service).
    //   (b) accrueToPayable=true + shippingCost > 0 (no treasury) → Dr Shipping
    //       Expense / Cr Accounts Payable (credit to supplier, paid later).
    //   (c) neither flag → no GL posting; the cost is recorded on the shipment
    //       row only and may be expensed later via a separate voucher. This is
    //       the backward-compatible default (existing callers that don't send
    //       treasuryId / accrueToPayable behave exactly as before).
    const shippingCost = data.shippingCost ?? 0;
    if (!Number.isFinite(shippingCost) || shippingCost < 0) {
      throw new BadRequestException(
        'تكلفة الشحن يجب أن تكون رقمًا موجبًا أو صفرًا',
      );
    }
    if (data.treasuryId && data.accrueToPayable) {
      throw new BadRequestException(
        'لا يمكن تحديد treasuryId و accrueToPayable معًا — اختر إما صرف نقدي أو استحقاق',
      );
    }
    if (shippingCost > 0 && data.treasuryId) {
      const treasury = await this.prisma.treasury.findUnique({
        where: { id: data.treasuryId },
        select: { id: true, isActive: true },
      });
      if (!treasury || !treasury.isActive) {
        throw new NotFoundException('الخزينة غير موجودة أو غير نشطة');
      }
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
            salesOrderId: data.salesOrderId,
            shippingCompanyId: data.shippingCompanyId,
            shippingCost,
            trackingNumber: data.trackingNumber,
            notes: data.notes,
            idempotencyKeyId,
          },
        });

        // COMM-F11 / ACC-F03: post the GL entry INSIDE the same tx so the
        // shipping expense hit and the shipment row commit atomically.
        // postingKey is keyed to the shipment id → safe for idempotent retry.
        if (shippingCost > 0) {
          if (data.treasuryId) {
            // (a) cash mode — Dr Shipping Expense / Cr Cash
            await this.financialPosting.postJournalEntryInTx(
              tx,
              {
                description: `تكلفة شحن شحنة ${created.code}`,
                reference: `SHIPMENT:${created.id}`,
                postingKey: `shipping-cost-cash:${created.id}`,
                isAuto: true,
                lines: [
                  {
                    debitAccountId: CHART_OF_ACCOUNTS.SHIPPING_EXPENSE,
                    creditAccountId: CHART_OF_ACCOUNTS.CASH,
                    amount: shippingCost,
                    description: `شحن ${order.code ?? created.salesOrderId}`,
                  },
                ],
                treasuryUpdates: [
                  { treasuryId: data.treasuryId, delta: -shippingCost },
                ],
                metadata: {
                  source: 'SHIPPING_COST_CASH',
                  shipmentId: created.id,
                  salesOrderId: created.salesOrderId,
                  treasuryId: data.treasuryId,
                },
              },
              actorId,
            );
          } else if (data.accrueToPayable) {
            // (b) accrual mode — Dr Shipping Expense / Cr Accounts Payable
            await this.financialPosting.postJournalEntryInTx(
              tx,
              {
                description: `استحقاق تكلفة شحن ${created.code}`,
                reference: `SHIPMENT:${created.id}`,
                postingKey: `shipping-cost-accrual:${created.id}`,
                isAuto: true,
                lines: [
                  {
                    debitAccountId: CHART_OF_ACCOUNTS.SHIPPING_EXPENSE,
                    creditAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
                    amount: shippingCost,
                    description: `استحقاق شحن ${order.code ?? created.salesOrderId}`,
                  },
                ],
                metadata: {
                  source: 'SHIPPING_COST_ACCRUAL',
                  shipmentId: created.id,
                  salesOrderId: created.salesOrderId,
                  shippingCompanyId: data.shippingCompanyId ?? null,
                },
              },
              actorId,
            );
          }
          // (c) no flag → skip GL posting intentionally
        }

        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'SHIPMENT_CREATED',
            module: 'SHIPPING',
            details: {
              shipmentId: created.id,
              salesOrderId: created.salesOrderId,
              shippingCost,
              postedToGL:
                shippingCost > 0
                  ? data.treasuryId
                    ? 'CASH'
                    : data.accrueToPayable
                      ? 'ACCRUAL'
                      : 'NONE'
                  : 'NONE',
              treasuryId: data.treasuryId ?? null,
            },
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
