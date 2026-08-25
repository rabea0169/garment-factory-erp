import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllWorkers(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = {
      orderBy: { createdAt: 'desc' } as const,
      skip,
      take: pageSize,
    };

    const [data, total] = await Promise.all([
      this.prisma.worker.findMany(options),
      this.prisma.worker.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  async getWorkerDetails(id: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { id },
      include: {
        dailyProduction: {
          take: 10,
          orderBy: { date: 'desc' },
        },
        advances: {
          take: 5,
          orderBy: { date: 'desc' },
        },
      },
    });
    if (!worker) throw new NotFoundException('العامل غير موجود');
    return worker;
  }

  async recordDailyProduction(data: {
    workerId: string;
    workOrderId?: string;
    date: Date;
    piecesCount: number;
  }) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: data.workerId },
    });
    if (!worker) throw new NotFoundException('العامل غير موجود');

    const totalAmount = data.piecesCount * Number(worker.pieceRate);

    return this.prisma.dailyProduction.create({
      data: {
        workerId: data.workerId,
        workOrderId: data.workOrderId,
        date: new Date(data.date),
        piecesCount: data.piecesCount,
        pieceRate: worker.pieceRate,
        totalAmount,
      },
    });
  }

  async recordAdvance(data: {
    workerId: string;
    amount: number;
    notes?: string;
  }) {
    return this.prisma.workerAdvance.create({
      data: {
        workerId: data.workerId,
        amount: data.amount,
        notes: data.notes,
      },
    });
  }
}
