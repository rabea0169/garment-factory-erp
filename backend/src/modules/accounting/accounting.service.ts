import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async getChartOfAccounts() {
    return this.prisma.account.findMany({
      orderBy: { code: 'asc' },
    });
  }

  async createAccount(data: { code: string; name: string; type: any; parentId?: string; isGroup?: boolean }) {
    return this.prisma.account.create({
      data: {
        code: data.code,
        name: data.name,
        type: data.type,
        parentId: data.parentId,
        isGroup: data.isGroup || false,
      },
    });
  }

  async getVouchers() {
    return this.prisma.voucher.findMany({
      include: { createdBy: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async createVoucher(data: { type: any; amount: number; description: string; reference?: string; createdById: string }) {
    return this.prisma.voucher.create({
      data: {
        code: `VCH-${Date.now()}`,
        type: data.type,
        amount: data.amount,
        description: data.description,
        reference: data.reference,
        createdById: data.createdById,
      },
    });
  }
}
