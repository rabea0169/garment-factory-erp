import {
  PaymentType,
  Prisma,
  PurchaseOrderStatus,
  RawMaterialUnit,
  UserRole,
  WarehouseType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { FinancialPostingService } from '../src/core/financial/financial-posting.service';
import { PurchasingService } from '../src/modules/purchasing/purchasing.service';
import { PrismaService } from '../src/prisma/prisma.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe('GF-0016 purchasing receipt integration', () => {
  let prisma: PrismaService;
  let service: PurchasingService;
  let userId: string;
  let orderId: string;
  let itemId: string;
  let rawMaterialId: string;
  const warehouseCode = `WH-GF16-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    service = new PurchasingService(
      prisma,
      new InventoryService(prisma, new EventEmitter2()),
      new FinancialPostingService(prisma),
    );
  });

  beforeEach(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "purchase_receipt_items",
        "purchase_receipts",
        "purchase_order_items",
        "purchase_orders",
        "stock_ledger_entries",
        "raw_materials",
        "suppliers",
        "warehouses",
        "idempotency_keys",
        "users"
      CASCADE
    `);
    const user = await prisma.user.create({
      data: {
        name: 'GF-0016 Purchasing Integration User',
        email: `gf0016-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.INVENTORY_MANAGER,
      },
    });
    userId = user.id;
    const supplier = await prisma.supplier.create({
      data: {
        code: `SUP-GF16-${randomUUID().slice(0, 8)}`,
        name: 'GF-0016 Supplier',
      },
    });
    const warehouse = await prisma.warehouse.create({
      data: {
        code: warehouseCode,
        name: 'GF-0016 Raw Warehouse',
        type: WarehouseType.RAW_MATERIAL,
      },
    });
    const rawMaterial = await prisma.rawMaterial.create({
      data: {
        code: `RM-GF16-${randomUUID().slice(0, 8)}`,
        name: 'GF-0016 Fabric',
        unit: RawMaterialUnit.METER,
        costPerUnit: new Prisma.Decimal('10.00'),
        supplierId: supplier.id,
      },
    });
    rawMaterialId = rawMaterial.id;
    const order = await prisma.purchaseOrder.create({
      data: {
        code: `PO-GF16-${randomUUID().slice(0, 8)}`,
        supplierId: supplier.id,
        userId,
        paymentType: PaymentType.CREDIT,
        totalAmount: new Prisma.Decimal('50.00'),
        status: PurchaseOrderStatus.PENDING,
        items: {
          create: {
            rawMaterialId,
            quantity: new Prisma.Decimal('5.0000'),
            unitCost: new Prisma.Decimal('10.00'),
            totalCost: new Prisma.Decimal('50.00'),
          },
        },
      },
      include: { items: true },
    });
    orderId = order.id;
    itemId = order.items[0].id;
    await prisma.warehouse.update({
      where: { id: warehouse.id },
      data: { code: 'WH-RAW' },
    });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('creates one receipt, one RECEIVE ledger entry, and replays safely', async () => {
    const dto = { items: [{ purchaseOrderItemId: itemId, quantity: 5 }] };
    const key = `gf0016-receipt-${randomUUID()}`;
    const first = (await service.createReceipt(orderId, dto, userId, key)) as {
      id: string;
      code: string;
    };
    const replay = await service.createReceipt(orderId, dto, userId, key);

    expect(replay).toMatchObject({
      id: first.id,
      code: first.code,
      replayed: true,
    });
    expect(await prisma.purchaseReceipt.count()).toBe(1);
    expect(
      await prisma.stockLedgerEntry.count({ where: { reference: first.code } }),
    ).toBe(1);
    const material = await prisma.rawMaterial.findUnique({
      where: { id: rawMaterialId },
    });
    expect(material?.currentStock.toNumber()).toBe(5);
    expect(
      await prisma.purchaseOrder.count({
        where: { id: orderId, status: PurchaseOrderStatus.RECEIVED },
      }),
    ).toBe(1);
  });

  it('rejects a receipt above the remaining ordered quantity before writing', async () => {
    await expect(
      service.createReceipt(
        orderId,
        { items: [{ purchaseOrderItemId: itemId, quantity: 6 }] },
        userId,
      ),
    ).rejects.toThrow('تتجاوز المتبقي');
    expect(await prisma.purchaseReceipt.count()).toBe(0);
    expect(await prisma.stockLedgerEntry.count()).toBe(0);
  });
});
