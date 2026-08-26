import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

type DashboardDateRange = {
  from: Date;
  to: Date;
  fromIso: string;
  toIso: string;
};

function parseDateRange(query: DashboardQueryDto): DashboardDateRange {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setUTCMonth(defaultFrom.getUTCMonth() - 6);
  defaultFrom.setUTCHours(0, 0, 0, 0);

  const from = query.from ? new Date(query.from) : defaultFrom;
  const to = query.to ? new Date(query.to) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException('Dashboard dates must be valid ISO dates');
  }
  if (from > to) {
    throw new BadRequestException(
      'Dashboard start date cannot be after end date',
    );
  }
  return {
    from,
    to,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
  };
}

function numberValue(value: unknown): number {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return Number(value ?? 0);
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(query: DashboardQueryDto = new DashboardQueryDto()) {
    const range = parseDateRange(query);

    const [sales, production, topWorkers, inventory] = await Promise.all([
      this.getSalesSeries(range),
      this.getProductionSeries(range),
      this.getTopWorkers(range),
      this.getInventorySummary(),
    ]);

    return {
      filters: {
        from: range.fromIso,
        to: range.toIso,
      },
      generatedAt: new Date().toISOString(),
      sales,
      production,
      topWorkers,
      inventory,
      definitions: {
        sales: 'مجموع totalAmount لطلبات البيع غير الملغاة حسب شهر الإنشاء.',
        production:
          'مجموع piecesCount من DailyProduction حسب تاريخ الإنتاج داخل الفترة.',
        topWorkers:
          'أعلى خمسة عمال حسب مجموع piecesCount في DailyProduction داخل الفترة.',
        inventory:
          'الخامات من raw_materials، النقص من currentStock <= minStockLevel، والمنتج التام من FinishedGoodStock ذي الكمية الموجبة.',
      },
    };
  }

  private async getSalesSeries(range: DashboardDateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ period: string; amount: Prisma.Decimal }>
    >`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS period,
             COALESCE(SUM("totalAmount"), 0) AS amount
      FROM sales_orders
      WHERE "createdAt" >= ${range.from}
        AND "createdAt" <= ${range.to}
        AND status <> 'CANCELLED'
      GROUP BY date_trunc('month', "createdAt")
      ORDER BY date_trunc('month', "createdAt") ASC
    `;
    return rows.map((row) => ({
      period: row.period,
      amount: numberValue(row.amount),
    }));
  }

  private async getProductionSeries(range: DashboardDateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ period: string; pieces: bigint }>
    >`
      SELECT to_char("date", 'YYYY-MM-DD') AS period,
             COALESCE(SUM("piecesCount"), 0)::bigint AS pieces
      FROM daily_production
      WHERE "date" >= ${range.from.toISOString().slice(0, 10)}::date
        AND "date" <= ${range.to.toISOString().slice(0, 10)}::date
      GROUP BY "date"
      ORDER BY "date" ASC
    `;
    return rows.map((row) => ({
      period: row.period,
      pieces: Number(row.pieces ?? 0),
    }));
  }

  private async getTopWorkers(range: DashboardDateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ workerId: string; name: string; pieces: bigint }>
    >`
      SELECT w.id AS "workerId",
             w.name,
             COALESCE(SUM(dp."piecesCount"), 0)::bigint AS pieces
      FROM daily_production dp
      JOIN workers w ON w.id = dp."workerId"
      WHERE dp."date" >= ${range.from.toISOString().slice(0, 10)}::date
        AND dp."date" <= ${range.to.toISOString().slice(0, 10)}::date
      GROUP BY w.id, w.name
      ORDER BY pieces DESC, w.name ASC
      LIMIT 5
    `;
    return rows.map((row) => ({
      workerId: row.workerId,
      name: row.name,
      pieces: Number(row.pieces ?? 0),
    }));
  }

  private async getInventorySummary() {
    const [totalMaterials, lowStockRows, finishedGoodsTypes] =
      await Promise.all([
        this.prisma.rawMaterial.count(),
        this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM raw_materials
          WHERE "currentStock" <= "minStockLevel"
        `,
        this.prisma.finishedGoodStock.count({ where: { quantity: { gt: 0 } } }),
      ]);

    return {
      totalMaterials,
      lowStockMaterials: Number(lowStockRows[0]?.count ?? 0),
      totalFinishedGoodsTypes: finishedGoodsTypes,
    };
  }
}
