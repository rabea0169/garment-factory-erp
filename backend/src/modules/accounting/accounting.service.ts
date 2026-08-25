import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountType, VoucherType } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async getChartOfAccounts(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = { orderBy: { code: 'asc' } as const, skip, take: pageSize };

    const [data, total] = await Promise.all([
      this.prisma.account.findMany(options),
      this.prisma.account.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  async createAccount(data: {
    code: string;
    name: string;
    type: AccountType;
    parentId?: string;
    isGroup?: boolean;
  }) {
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

  async getVouchers(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = {
      include: { createdBy: { select: { name: true } } },
      orderBy: { date: 'desc' } as const,
      skip,
      take: pageSize,
    };

    const [data, total] = await Promise.all([
      this.prisma.voucher.findMany(options),
      this.prisma.voucher.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  async createVoucher(
    data: {
      type: VoucherType;
      amount: number;
      description: string;
      reference?: string;
    },
    createdById: string,
  ) {
    // P0-04: createdById من الجلسة (يمرره الـ controller من التوكن) — يُتجاهل أي value من body
    return this.prisma.voucher.create({
      data: {
        code: `VCH-${Date.now()}`,
        type: data.type,
        amount: data.amount,
        description: data.description,
        reference: data.reference,
        createdById,
      },
    });
  }
}
