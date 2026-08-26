import { SalesOrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  it('aggregates six sales months, six production days, and top workers', async () => {
    const prisma = createPrismaMock();
    const now = new Date('2026-08-26T12:00:00.000Z');
    prisma.salesOrder.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        totalAmount: new Prisma.Decimal('100.00'),
      },
      {
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
        totalAmount: new Prisma.Decimal('50.50'),
      },
    ]);
    prisma.dailyProduction.findMany.mockResolvedValue([
      {
        date: new Date('2026-08-25T00:00:00.000Z'),
        piecesCount: 40,
        worker: { name: 'أحمد' },
      },
      {
        date: new Date('2026-08-25T00:00:00.000Z'),
        piecesCount: 10,
        worker: { name: 'سارة' },
      },
    ]);

    const result = await new DashboardService(
      prisma as unknown as PrismaService,
    ).getStats(now);

    expect(result.sales).toHaveLength(6);
    expect(result.sales[5]).toBe(150.5);
    expect(result.production).toHaveLength(6);
    expect(result.production[4]).toBe(50);
    expect(result.topWorkers).toEqual([
      { name: 'أحمد', pieces: 40 },
      { name: 'سارة', pieces: 10 },
    ]);
    type SalesQueryCall = [{ where: { status: { not: SalesOrderStatus } } }];
    const salesQuery = prisma.salesOrder.findMany.mock
      .calls[0] as unknown as SalesQueryCall;
    expect(salesQuery[0].where.status).toEqual({
      not: SalesOrderStatus.CANCELLED,
    });
  });
});
