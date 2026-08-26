import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RejectionReason, WorkOrderStatus } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';

@Injectable()
export class QualityService {
  constructor(private readonly prisma: PrismaService) {}

  async getQualityChecks(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = {
      orderBy: { checkedAt: 'desc' } as const,
      skip,
      take: pageSize,
      include: {
        workOrder: {
          include: {
            variant: { include: { product: true } },
            bomVersion: true,
          },
        },
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.qualityCheck.findMany(options),
      this.prisma.qualityCheck.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
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
    const quantities = [data.checkedQty, data.passedQty, data.rejectedQty];
    if (
      quantities.some((quantity) => !Number.isInteger(quantity) || quantity < 0)
    ) {
      throw new BadRequestException(
        'كميات فحص الجودة يجب أن تكون أعدادًا صحيحة غير سالبة',
      );
    }

    if (data.checkedQty !== data.passedQty + data.rejectedQty) {
      throw new BadRequestException(
        'يجب أن تساوي الكمية المفحوصة مجموع الكمية الناجحة والمرفوضة',
      );
    }

    return this.prisma.qualityCheck.create({ data });
  }
}
