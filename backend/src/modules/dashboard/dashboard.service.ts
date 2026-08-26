import { Injectable } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type DashboardStats = {
  sales: number[];
  production: number[];
  topWorkers: { name: string; pieces: number }[];
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(now = new Date()): Promise<DashboardStats> {
    const salesMonthStarts = Array.from({ length: 7 }, (_, index) => {
      const monthOffset = index - 5;
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1),
      );
    });
    const salesRows = await this.prisma.salesOrder.findMany({
      where: {
        createdAt: {
          gte: salesMonthStarts[0],
          lt: salesMonthStarts[6],
        },
        status: { not: SalesOrderStatus.CANCELLED },
      },
      select: { createdAt: true, totalAmount: true },
    });
    const sales = salesMonthStarts.slice(0, 6).map((monthStart, index) => {
      const monthEnd = salesMonthStarts[index + 1];
      return round2(
        salesRows
          .filter(
            (row) => row.createdAt >= monthStart && row.createdAt < monthEnd,
          )
          .reduce((total, row) => total + Number(row.totalAmount), 0),
      );
    });

    const firstProductionDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 5),
    );
    const productionEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const productionRows = await this.prisma.dailyProduction.findMany({
      where: { date: { gte: firstProductionDay, lt: productionEnd } },
      select: {
        date: true,
        piecesCount: true,
        worker: { select: { name: true } },
      },
    });
    const production = Array.from({ length: 6 }, (_, index) => {
      const dayStart = new Date(firstProductionDay);
      dayStart.setUTCDate(dayStart.getUTCDate() + index);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      return productionRows
        .filter((row) => row.date >= dayStart && row.date < dayEnd)
        .reduce((total, row) => total + row.piecesCount, 0);
    });

    const workerTotals = new Map<string, number>();
    for (const row of productionRows) {
      const workerName = row.worker.name;
      workerTotals.set(
        workerName,
        (workerTotals.get(workerName) ?? 0) + row.piecesCount,
      );
    }
    const topWorkers = Array.from(workerTotals.entries())
      .map(([name, pieces]) => ({ name, pieces }))
      .sort((left, right) => right.pieces - left.pieces)
      .slice(0, 5);

    return { sales, production, topWorkers };
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
