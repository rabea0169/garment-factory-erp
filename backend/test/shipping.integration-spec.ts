import {
  PaymentType,
  Prisma,
  SalesOrderStatus,
  ShipmentStatus,
  UserRole,
  WarehouseType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ShippingService } from '../src/modules/shipping/shipping.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe('GF-0017 shipping lifecycle integration', () => {
  let prisma: PrismaService;
  let service: ShippingService;
  let userId: string;
  let shipmentId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    const inventory = new InventoryService(prisma, new EventEmitter2());
    service = new ShippingService(prisma, inventory);
  });

  beforeEach(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE "activity_logs", "shipments", "sales_orders", "customers", "users" CASCADE
    `);
    const user = await prisma.user.create({
      data: {
        name: 'GF-0017 Shipping Integration User',
        email: `gf0017-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.GENERAL_MANAGER,
      },
    });
    userId = user.id;
    await prisma.warehouse.create({
      data: {
        code: 'WH-FG',
        name: 'GF-0017 Finished Goods Warehouse',
        type: WarehouseType.FINISHED_GOODS,
      },
    });
    const customer = await prisma.customer.create({
      data: {
        code: `CUS-GF17-${randomUUID().slice(0, 8)}`,
        name: 'GF-0017 Customer',
      },
    });
    const order = await prisma.salesOrder.create({
      data: {
        code: `SO-GF17-${randomUUID().slice(0, 8)}`,
        customerId: customer.id,
        userId,
        paymentType: PaymentType.CREDIT,
        status: SalesOrderStatus.CONFIRMED,
        subtotal: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('100.00'),
      },
    });
    const shipment = await prisma.shipment.create({
      data: {
        code: `SHP-GF17-${randomUUID().slice(0, 8)}`,
        salesOrderId: order.id,
      },
    });
    shipmentId = shipment.id;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('enforces lifecycle order and records auditable proof of delivery', async () => {
    await service.updateShipmentStatus(
      shipmentId,
      ShipmentStatus.SHIPPED,
      userId,
    );
    await service.updateShipmentStatus(
      shipmentId,
      ShipmentStatus.IN_TRANSIT,
      userId,
    );
    await service.updateShipmentStatus(
      shipmentId,
      ShipmentStatus.DELIVERED,
      userId,
      'POD-GF17-001',
    );

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    expect(shipment).toMatchObject({
      status: ShipmentStatus.DELIVERED,
      proofOfDelivery: 'POD-GF17-001',
      deliveredById: userId,
    });
    expect(
      await prisma.activityLog.count({
        where: { action: 'SHIPMENT_STATUS_CHANGED', userId },
      }),
    ).toBe(3);
  });

  it('rejects delivery without proof and does not mutate the shipment', async () => {
    await service.updateShipmentStatus(
      shipmentId,
      ShipmentStatus.SHIPPED,
      userId,
    );
    await service.updateShipmentStatus(
      shipmentId,
      ShipmentStatus.IN_TRANSIT,
      userId,
    );
    await expect(
      service.updateShipmentStatus(
        shipmentId,
        ShipmentStatus.DELIVERED,
        userId,
      ),
    ).rejects.toThrow('إثبات التسليم مطلوب');
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    expect(shipment?.status).toBe(ShipmentStatus.IN_TRANSIT);
  });
});
