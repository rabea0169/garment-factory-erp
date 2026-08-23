import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class QualityService {
  constructor(private readonly prisma: PrismaService) {}

  async getQualityChecks() {
    return this.prisma.qualityCheck.findMany({
      orderBy: { checkedAt: 'desc' },
      include: { workOrder: { include: { product: true } } }
    });
  }

  async addQualityCheck(data: any) {
    return this.prisma.qualityCheck.create({ data });
  }
}
