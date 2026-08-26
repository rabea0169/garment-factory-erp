import {
  PaymentType,
  Prisma,
  RawMaterialUnit,
  SalesOrderStatus,
  UserRole,
  WorkerSpecialty,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';
import { PrismaService } from '../src/prisma/prisma.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe('GF-REMAINING-004 dashboard integration', () => {
  let prisma: PrismaService;
  let service: DashboardService;

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    service = new DashboardService(prisma);
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('يعيد KPIs من بيانات PostgreSQL الحقيقية ضمن الفترة المطلوبة', async () => {
    const suffix = randomUUID().slice(0, 8);
    const reportDate = new Date('2099-01-15T12:00:00.000Z');
    const reportDay = new Date('2099-01-15T00:00:00.000Z');
    const [user, customer, worker, rawMaterial] = await Promise.all([
      prisma.user.create({
        data: {
          name: `GF-004 Dashboard User ${suffix}`,
          email: `gf004-dashboard-${suffix}@example.test`,
          password: 'integration-only-hash',
          role: UserRole.GENERAL_MANAGER,
        },
      }),
      prisma.customer.create({
        data: {
          code: `CUS-GF004-${suffix}`,
          name: `GF-004 Customer ${suffix}`,
        },
      }),
      prisma.worker.create({
        data: {
          code: `WRK-GF004-${suffix}`,
          name: `GF-004 Worker ${suffix}`,
          specialty: WorkerSpecialty.SEWING,
          pieceRate: new Prisma.Decimal('2.00'),
        },
      }),
      prisma.rawMaterial.create({
        data: {
          code: `RM-GF004-${suffix}`,
          name: `GF-004 Fabric ${suffix}`,
          unit: RawMaterialUnit.METER,
          costPerUnit: new Prisma.Decimal('10.00'),
          minStockLevel: new Prisma.Decimal('5.0000'),
        },
      }),
    ]);

    await Promise.all([
      prisma.salesOrder.create({
        data: {
          code: `SO-GF004-${suffix}`,
          customerId: customer.id,
          userId: user.id,
          paymentType: PaymentType.CASH,
          status: SalesOrderStatus.CONFIRMED,
          subtotal: new Prisma.Decimal('1234.50'),
          totalAmount: new Prisma.Decimal('1234.50'),
          createdAt: reportDate,
        },
      }),
      prisma.dailyProduction.create({
        data: {
          workerId: worker.id,
          date: reportDay,
          piecesCount: 42,
          pieceRate: new Prisma.Decimal('2.00'),
          totalAmount: new Prisma.Decimal('84.00'),
        },
      }),
    ]);

    const result = await service.getStats({
      from: '2099-01-15T00:00:00.000Z',
      to: '2099-01-15T23:59:59.999Z',
    });

    expect(result.sales).toEqual([{ period: '2099-01', amount: 1234.5 }]);
    expect(result.production).toEqual([{ period: '2099-01-15', pieces: 42 }]);
    expect(result.topWorkers).toEqual([
      { workerId: worker.id, name: worker.name, pieces: 42 },
    ]);
    expect(result.inventory.totalMaterials).toBeGreaterThanOrEqual(1);
    expect(result.inventory.lowStockMaterials).toBeGreaterThanOrEqual(1);
    expect(result.filters).toEqual({
      from: '2099-01-15T00:00:00.000Z',
      to: '2099-01-15T23:59:59.999Z',
    });

    await prisma.rawMaterial.delete({ where: { id: rawMaterial.id } });
  });
});
