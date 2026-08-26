import {
  Prisma,
  RawMaterialUnit,
  StockMovementType,
  UserRole,
  WarehouseType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

describe('GF-REMAINING-002 inventory warehouse balances', () => {
  let prisma: PrismaService;
  let service: InventoryService;
  let userId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    service = new InventoryService(prisma, new EventEmitter2());
    const user = await prisma.user.create({
      data: {
        name: 'GF-REMAINING-002 Integration User',
        email: `gf002-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.INVENTORY_MANAGER,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function createScenario() {
    const suffix = randomUUID().slice(0, 8);
    const [warehouseA, warehouseB] = await Promise.all([
      prisma.warehouse.create({
        data: {
          code: `WH-GF002-A-${suffix}`,
          name: 'GF-002 Warehouse A',
          type: WarehouseType.RAW_MATERIAL,
        },
      }),
      prisma.warehouse.create({
        data: {
          code: `WH-GF002-B-${suffix}`,
          name: 'GF-002 Warehouse B',
          type: WarehouseType.GENERAL,
        },
      }),
    ]);
    const material = await prisma.rawMaterial.create({
      data: {
        code: `RM-GF002-${suffix}`,
        name: 'GF-002 Fabric',
        unit: RawMaterialUnit.METER,
        costPerUnit: new Prisma.Decimal('10.00'),
        minStockLevel: new Prisma.Decimal('5.0000'),
      },
    });
    return { material, warehouseA, warehouseB };
  }

  integrationDescribe('real PostgreSQL warehouse reconciliation', () => {
    it('يفصل رصيد المستودعين ويطابق الإجمالي مع مجموع ledger', async () => {
      const { material, warehouseA, warehouseB } = await createScenario();

      await service.receive(
        {
          rawMaterialId: material.id,
          warehouseId: warehouseA.id,
          quantity: 10,
          unitCost: 10,
        },
        userId,
      );
      await service.receive(
        {
          rawMaterialId: material.id,
          warehouseId: warehouseB.id,
          quantity: 25,
          unitCost: 12,
        },
        userId,
      );
      await service.issue(
        { rawMaterialId: material.id, warehouseId: warehouseA.id, quantity: 3 },
        userId,
      );

      const balances = await service.getMaterialBalanceByWarehouse(material.id);
      const byWarehouse = new Map(
        balances.map((balance) => [balance.warehouseId, balance.balance]),
      );
      expect(byWarehouse.get(warehouseA.id)).toBe(7);
      expect(byWarehouse.get(warehouseB.id)).toBe(25);

      const rawMaterial = await prisma.rawMaterial.findUnique({
        where: { id: material.id },
      });
      const ledgerSum = await prisma.stockLedgerEntry.aggregate({
        where: { rawMaterialId: material.id },
        _sum: { quantityDelta: true },
      });
      expect(rawMaterial?.currentStock.toNumber()).toBe(32);
      expect(ledgerSum._sum.quantityDelta?.toNumber()).toBe(32);

      const latestByWarehouse = await prisma.stockLedgerEntry.findMany({
        where: { rawMaterialId: material.id },
        orderBy: { createdAt: 'asc' },
        select: { warehouseId: true, balanceAfter: true },
      });
      expect(
        latestByWarehouse
          .filter((entry) => entry.warehouseId === warehouseA.id)
          .at(-1)
          ?.balanceAfter.toNumber(),
      ).toBe(7);
      expect(
        latestByWarehouse
          .filter((entry) => entry.warehouseId === warehouseB.id)
          .at(-1)
          ?.balanceAfter.toNumber(),
      ).toBe(25);
    });
  });

  integrationDescribe('concurrent issue safety', () => {
    it('يمنع الصرف المتزامن من تجاوز رصيد المستودع ويُبقي ledger متسقاً', async () => {
      const { material, warehouseA } = await createScenario();
      await service.receive(
        {
          rawMaterialId: material.id,
          warehouseId: warehouseA.id,
          quantity: 70,
          unitCost: 10,
        },
        userId,
      );

      const results = await Promise.allSettled([
        service.issue(
          {
            rawMaterialId: material.id,
            warehouseId: warehouseA.id,
            quantity: 50,
          },
          userId,
        ),
        service.issue(
          {
            rawMaterialId: material.id,
            warehouseId: warehouseA.id,
            quantity: 30,
          },
          userId,
        ),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      const rawMaterial = await prisma.rawMaterial.findUnique({
        where: { id: material.id },
      });
      const finalStock = rawMaterial?.currentStock.toNumber();
      // Either request may win the race: the accepted issue is 50 or 30.
      // The invariant is that exactly one succeeds and no negative balance or
      // extra ledger entry is left behind.
      expect([20, 40]).toContain(finalStock);
      expect(
        await prisma.stockLedgerEntry.count({
          where: {
            rawMaterialId: material.id,
            type: StockMovementType.ISSUE,
          },
        }),
      ).toBe(1);
      const balance = await service.getMaterialBalanceByWarehouse(material.id);
      expect(balance[0]?.balance).toBe(finalStock);
    });
  });
});
