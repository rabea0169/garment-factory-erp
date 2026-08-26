import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * MOBILE-F03 / MOBILE-F04 (backend side):
 * يجمع هذا الـ service بيانات حقيقية من جداول Prisma المختلفة (SalesOrder،
 * DailyProduction، WorkOrder، Treasury، RawMaterial، FinishedGoodStock،
 * Voucher) ويُرجعها في استجابة واحدة على شكل `/dashboard/stats`.
 *
 * الهدف: استبدال البيانات الـ hardcoded في شاشة لوحة التحكم والتقارير
 * ببيانات حقيقية من قاعدة البيانات، والسماح لكلا الشاشتين باستدعاء نفس الـ endpoint.
 *
 * ملاحظة دفاعية: كل استعلام مستقل بـ try/catch حتى لا يُسقط الكل إذا فشل جدول
 * واحد (مثلاً إذا كانت قاعدة البيانات فارغة بعد seed أولي). القيم الافتراضية
 * تكون 0 أو [] حسب السياق.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const now = new Date();

    const [
      today,
      inventory,
      pendingWorkOrders,
      treasuryBalance,
      recentTransactions,
      sales,
      production,
      topWorkers,
    ] = await Promise.all([
      this.fetchTodayStats(now),
      this.fetchInventoryStats(),
      this.fetchPendingWorkOrders(),
      this.fetchTreasuryBalance(),
      this.fetchRecentTransactions(),
      this.fetchSalesLast6Months(now),
      this.fetchProductionLast6Days(now),
      this.fetchTopWorkers(),
    ]);

    return {
      today,
      inventory,
      pendingWorkOrders,
      treasuryBalance,
      recentTransactions,
      sales,
      production,
      topWorkers,
    };
  }

  private async fetchTodayStats(now: Date) {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    let salesTotal = 0;
    let productionPieces = 0;

    try {
      const agg = await this.prisma.salesOrder.aggregate({
        _sum: { totalAmount: true },
        where: {
          status: { in: ['CONFIRMED', 'SHIPPED'] },
          createdAt: { gte: startOfToday, lte: endOfToday },
        },
      });
      salesTotal = Number(agg._sum.totalAmount ?? 0);
    } catch (error) {
      this.logger.warn(
        `fetchTodayStats.sales failed: ${(error as Error).message}`,
      );
    }

    try {
      // ملاحظة: التاريخ في DailyProduction هو Date (date-only)؛
      // نبني تطابقًا على نفس اليوم بـ UTC لتجنب offset التوقيت.
      const todayDateOnly = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const prodAgg = await this.prisma.dailyProduction.aggregate({
        _sum: { piecesCount: true },
        where: { date: todayDateOnly },
      });
      productionPieces = Number(prodAgg._sum.piecesCount ?? 0);
    } catch (error) {
      this.logger.warn(
        `fetchTodayStats.production failed: ${(error as Error).message}`,
      );
    }

    return {
      date: now.toISOString(),
      salesTotal: round2(salesTotal),
      productionPieces,
    };
  }

  private async fetchInventoryStats() {
    let totalMaterials = 0;
    let lowStockMaterials = 0;
    let totalFinishedGoodsTypes = 0;
    let inventoryValue = 0;

    try {
      const materials = await this.prisma.rawMaterial.findMany({
        select: {
          currentStock: true,
          costPerUnit: true,
          minStockLevel: true,
        },
      });
      totalMaterials = materials.length;
      let rawValue = 0;
      for (const m of materials) {
        const stock = Number(m.currentStock ?? 0);
        const cost = Number(m.costPerUnit ?? 0);
        rawValue += stock * cost;
        // lowStock = currentStock <= minStockLevel (نفس منطق InventoryService.getLowStockMaterials)
        if (stock <= Number(m.minStockLevel ?? 0)) {
          lowStockMaterials += 1;
        }
      }
      inventoryValue += rawValue;
    } catch (error) {
      this.logger.warn(
        `fetchInventoryStats.rawMaterials failed: ${(error as Error).message}`,
      );
    }

    try {
      const finishedGoods = await this.prisma.finishedGoodStock.findMany({
        where: { quantity: { gt: 0 } },
        select: { quantity: true, unitCost: true },
      });
      totalFinishedGoodsTypes = finishedGoods.length;
      let fgValue = 0;
      for (const f of finishedGoods) {
        fgValue += Number(f.quantity ?? 0) * Number(f.unitCost ?? 0);
      }
      inventoryValue += fgValue;
    } catch (error) {
      this.logger.warn(
        `fetchInventoryStats.finishedGoods failed: ${(error as Error).message}`,
      );
    }

    return {
      totalMaterials,
      lowStockMaterials,
      totalFinishedGoodsTypes,
      inventoryValue: round2(inventoryValue),
    };
  }

  private async fetchPendingWorkOrders(): Promise<number> {
    try {
      return await this.prisma.workOrder.count({
        where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      });
    } catch (error) {
      this.logger.warn(
        `fetchPendingWorkOrders failed: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  private async fetchTreasuryBalance(): Promise<number> {
    try {
      const agg = await this.prisma.treasury.aggregate({
        _sum: { balance: true },
        where: { isActive: true, deletedAt: null },
      });
      return round2(Number(agg._sum.balance ?? 0));
    } catch (error) {
      this.logger.warn(
        `fetchTreasuryBalance failed: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  private async fetchRecentTransactions() {
    try {
      const vouchers = await this.prisma.voucher.findMany({
        take: 5,
        orderBy: { date: 'desc' },
        select: {
          code: true,
          description: true,
          amount: true,
          type: true,
          date: true,
        },
      });
      return vouchers.map((v) => ({
        code: v.code,
        description: v.description,
        amount: round2(Number(v.amount)),
        type: String(v.type),
        date: v.date instanceof Date ? v.date.toISOString() : String(v.date),
      }));
    } catch (error) {
      this.logger.warn(
        `fetchRecentTransactions failed: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private async fetchSalesLast6Months(now: Date): Promise<number[]> {
    try {
      const start = new Date(
        now.getFullYear(),
        now.getMonth() - 5,
        1,
        0,
        0,
        0,
        0,
      );
      const orders = await this.prisma.salesOrder.findMany({
        where: {
          status: { in: ['CONFIRMED', 'SHIPPED'] },
          createdAt: { gte: start },
        },
        select: { totalAmount: true, createdAt: true },
      });

      const buckets: number[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthTotal = orders
          .filter(
            (o) =>
              o.createdAt.getFullYear() === d.getFullYear() &&
              o.createdAt.getMonth() === d.getMonth(),
          )
          .reduce((sum, o) => sum + Number(o.totalAmount ?? 0), 0);
        buckets.push(round2(monthTotal));
      }
      return buckets;
    } catch (error) {
      this.logger.warn(
        `fetchSalesLast6Months failed: ${(error as Error).message}`,
      );
      return [0, 0, 0, 0, 0, 0];
    }
  }

  private async fetchProductionLast6Days(now: Date): Promise<number[]> {
    try {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 5);

      const records = await this.prisma.dailyProduction.findMany({
        where: { date: { gte: start } },
        select: { date: true, piecesCount: true },
      });

      const buckets: number[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const dayTotal = records
          .filter((p) => sameCalendarDay(p.date, d))
          .reduce((sum, p) => sum + Number(p.piecesCount ?? 0), 0);
        buckets.push(dayTotal);
      }
      return buckets;
    } catch (error) {
      this.logger.warn(
        `fetchProductionLast6Days failed: ${(error as Error).message}`,
      );
      return [0, 0, 0, 0, 0, 0];
    }
  }

  private async fetchTopWorkers(): Promise<
    Array<{ name: string; pieces: number }>
  > {
    try {
      const grouped = await this.prisma.dailyProduction.groupBy({
        by: ['workerId'],
        _sum: { piecesCount: true },
        orderBy: { _sum: { piecesCount: 'desc' } },
        take: 5,
      });
      if (grouped.length === 0) return [];

      const ids = grouped.map((g) => g.workerId);
      const workers = await this.prisma.worker.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      return grouped.map((g) => ({
        name: workers.find((w) => w.id === g.workerId)?.name ?? '—',
        pieces: Number(g._sum.piecesCount ?? 0),
      }));
    } catch (error) {
      this.logger.warn(`fetchTopWorkers failed: ${(error as Error).message}`);
      return [];
    }
  }
}

function sameCalendarDay(value: Date | string, ref: Date): boolean {
  const d = value instanceof Date ? value : new Date(value);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
