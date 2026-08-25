import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RejectionReason, WorkOrderStatus } from '@prisma/client';

@Injectable()
export class QualityService {
  constructor(private readonly prisma: PrismaService) {}

  async getQualityChecks() {
    return this.prisma.qualityCheck.findMany({
      orderBy: { checkedAt: 'desc' },
      include: { workOrder: { include: { product: true } } },
    });
  }

  async addQualityCheck(data: {
    workOrderId: string;
    stage: WorkOrderStatus;
    checkedQty: number;
    passedQty: number;
    rejectedQty: number;
    rejectionReason?: RejectionReason;
    notes?: string;
  }) {
    return this.prisma.qualityCheck.create({ data });
  }
}
