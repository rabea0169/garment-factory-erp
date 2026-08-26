import { Prisma } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DashboardService (GF-REMAINING-004)', () => {
  it('يجمع المبيعات والإنتاج والعمال والمخزون من مصادرها الحقيقية', async () => {
    const prisma = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('sales_orders')) {
          return Promise.resolve([
            { period: '2026-08', amount: new Prisma.Decimal('1250.50') },
          ]);
        }
        if (sql.includes('workers')) {
          return Promise.resolve([
            { workerId: 'worker-1', name: 'عامل 1', pieces: BigInt(42) },
          ]);
        }
        if (sql.includes('daily_production')) {
          return Promise.resolve([
            { period: '2026-08-26', pieces: BigInt(42) },
          ]);
        }
        if (sql.includes('raw_materials')) {
          return Promise.resolve([{ count: BigInt(3) }]);
        }
        return Promise.resolve([]);
      }),
      rawMaterial: { count: jest.fn().mockResolvedValue(12) },
      finishedGoodStock: { count: jest.fn().mockResolvedValue(4) },
    };
    const service = new DashboardService(prisma as unknown as PrismaService);

    const result = await service.getStats({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-26T23:59:59.999Z',
    });

    expect(result.filters).toEqual({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-26T23:59:59.999Z',
    });
    expect(result.sales).toEqual([{ period: '2026-08', amount: 1250.5 }]);
    expect(result.production).toEqual([{ period: '2026-08-26', pieces: 42 }]);
    expect(result.topWorkers).toEqual([
      { workerId: 'worker-1', name: 'عامل 1', pieces: 42 },
    ]);
    expect(result.inventory).toEqual({
      totalMaterials: 12,
      lowStockMaterials: 3,
      totalFinishedGoodsTypes: 4,
    });
    expect(result.definitions.sales).toContain('totalAmount');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it('يرفض فترة تبدأ بعد نهايتها قبل تنفيذ أي استعلام', async () => {
    const prisma = {
      $queryRaw: jest.fn(),
      rawMaterial: { count: jest.fn() },
      finishedGoodStock: { count: jest.fn() },
    };
    const service = new DashboardService(prisma as unknown as PrismaService);

    await expect(
      service.getStats({
        from: '2026-08-27T00:00:00.000Z',
        to: '2026-08-26T00:00:00.000Z',
      }),
    ).rejects.toThrow('Dashboard start date cannot be after end date');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.rawMaterial.count).not.toHaveBeenCalled();
  });
});
