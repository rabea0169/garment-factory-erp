import {
  AccountType,
  PaymentType,
  Prisma,
  UserRole,
  ShipmentStatus,
  WarehouseType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CHART_OF_ACCOUNTS } from '../src/core/financial/chart-of-accounts';
import { FinancialPostingService } from '../src/core/financial/financial-posting.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { SalesService } from '../src/modules/sales/sales.service';
import { ShippingService } from '../src/modules/shipping/shipping.service';
import { PrismaService } from '../src/prisma/prisma.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe('P0 cash sale reconciliation integration', () => {
  let prisma: PrismaService;
  let sales: SalesService;
  let shipping: ShippingService;
  let userId: string;
  let customerId: string;
  let variantId: string;
  let treasuryId: string;
  let warehouseId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    const financial = new FinancialPostingService(prisma);
    const inventory = new InventoryService(
      prisma,
      new EventEmitter2(),
      financial,
    );
    sales = new SalesService(prisma, inventory, financial);
    shipping = new ShippingService(prisma, inventory, financial);
  });

  beforeEach(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "journal_lines",
        "journal_entries",
        "accounts",
        "customer_payments",
        "sales_order_items",
        "sales_orders",
        "customers",
        "finished_good_stocks",
        "stock_ledger_entries",
        "product_variants",
        "products",
        "treasuries",
        "warehouses",
        "idempotency_keys",
        "users"
      CASCADE
    `);

    const user = await prisma.user.create({
      data: {
        name: 'P0 Cash Sale Integration User',
        email: `p0-cash-sale-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.CASHIER,
      },
    });
    userId = user.id;

    await prisma.account.createMany({
      data: [
        {
          id: CHART_OF_ACCOUNTS.CASH,
          code: '1100-P0',
          name: 'P0 Cash',
          type: AccountType.ASSET,
        },
        {
          id: CHART_OF_ACCOUNTS.SALES_REVENUE,
          code: '4100-P0',
          name: 'P0 Sales Revenue',
          type: AccountType.REVENUE,
        },
        {
          id: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
          code: '1200-P0',
          name: 'P0 Accounts Receivable',
          type: AccountType.ASSET,
        },
        {
          id: CHART_OF_ACCOUNTS.VAT_PAYABLE,
          code: '2100-P0',
          name: 'P0 VAT Payable',
          type: AccountType.LIABILITY,
        },
        {
          id: CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
          code: '5100-P0',
          name: 'P0 COGS',
          type: AccountType.EXPENSE,
        },
        {
          id: CHART_OF_ACCOUNTS.INVENTORY,
          code: '1300-P0',
          name: 'P0 Inventory',
          type: AccountType.ASSET,
        },
      ],
    });

    const customer = await prisma.customer.create({
      data: {
        code: `CUS-P0-${randomUUID().slice(0, 8)}`,
        name: 'P0 Cash Sale Customer',
      },
    });
    customerId = customer.id;

    const warehouse = await prisma.warehouse.create({
      data: {
        code: 'WH-FG',
        name: 'P0 Finished Goods',
        type: WarehouseType.FINISHED_GOODS,
      },
    });
    warehouseId = warehouse.id;

    const product = await prisma.product.create({
      data: {
        code: `PRD-P0-${randomUUID().slice(0, 8)}`,
        name: 'P0 Cash Sale Product',
        retailPrice: new Prisma.Decimal('100.00'),
        wholesalePrice: new Prisma.Decimal('80.00'),
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        size: 'M',
        color: 'BLACK',
        barcode: `P0-${randomUUID()}`,
      },
    });
    variantId = variant.id;

    await prisma.finishedGoodStock.create({
      data: {
        warehouseId,
        productVariantId: variantId,
        quantity: 5,
        unitCost: new Prisma.Decimal('20.00'),
      },
    });

    const treasury = await prisma.treasury.create({
      data: {
        name: 'P0 Cash Treasury',
        type: 'CASH',
        balance: new Prisma.Decimal('0.00'),
      },
    });
    treasuryId = treasury.id;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('reconciles cash sale, then issues stock and COGS atomically at shipping', async () => {
    const order = await sales.createSalesOrder(
      {
        customerId,
        paymentType: PaymentType.CASH,
        discount: 0,
        items: [{ productVariantId: variantId, quantity: 2 }],
      },
      userId,
    );

    if (!('id' in order)) {
      throw new Error('Unexpected idempotency replay while creating fixture');
    }

    const confirmed = await sales.confirmOrder(
      order.id,
      userId,
      `p0-cash-confirm-${randomUUID()}`,
      treasuryId,
    );

    expect(confirmed).toMatchObject({ id: order.id, status: 'CONFIRMED' });
    const stockBeforeShipping = await prisma.finishedGoodStock.findUnique({
      where: {
        warehouseId_productVariantId: {
          warehouseId,
          productVariantId: variantId,
        },
      },
    });
    expect(stockBeforeShipping?.quantity).toBe(5);
    expect(
      await prisma.stockLedgerEntry.count({ where: { reference: order.code } }),
    ).toBe(0);

    const shipment = await shipping.createShipment(
      { salesOrderId: order.id },
      userId,
      `p0-cash-shipment-${randomUUID()}`,
    );
    if (!('id' in shipment)) {
      throw new Error('Unexpected idempotency replay while creating shipment');
    }
    const shipped = await shipping.updateShipmentStatus(
      shipment.id,
      ShipmentStatus.SHIPPED,
      userId,
      undefined,
      `p0-cash-shipped-${randomUUID()}`,
    );
    if (!('status' in shipped)) {
      throw new Error('Unexpected idempotency replay while shipping order');
    }
    expect(shipped.status).toBe('SHIPPED');

    const treasury = await prisma.treasury.findUnique({
      where: { id: treasuryId },
    });
    expect(treasury?.balance.toNumber()).toBe(228);

    const cashAccount = await prisma.account.findUnique({
      where: { id: CHART_OF_ACCOUNTS.CASH },
    });
    expect(cashAccount?.balance.toNumber()).toBe(228);

    const stock = await prisma.finishedGoodStock.findUnique({
      where: {
        warehouseId_productVariantId: {
          warehouseId,
          productVariantId: variantId,
        },
      },
    });
    expect(stock?.quantity).toBe(3);

    const issue = await prisma.stockLedgerEntry.findFirst({
      where: { productVariantId: variantId },
    });
    expect(issue).toMatchObject({
      type: 'ISSUE',
      quantityDelta: new Prisma.Decimal('-2'),
    });
    expect(issue?.totalValue?.toNumber()).toBe(40);

    const journal = await prisma.journalEntry.findFirst({
      where: { reference: order.code },
      include: { lines: true },
    });
    expect(journal?.metadata).toMatchObject({
      treasuryUpdates: [{ treasuryId, delta: 228 }],
    });
    expect(journal?.lines).toHaveLength(2);
    const cogsJournal = await prisma.journalEntry.findUnique({
      where: { postingKey: `shipment-cogs:${shipment.id}` },
      include: { lines: true },
    });
    expect(cogsJournal?.lines).toEqual([
      expect.objectContaining({
        debitAccountId: CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
        creditAccountId: CHART_OF_ACCOUNTS.INVENTORY,
        amount: new Prisma.Decimal('40.00'),
      }),
    ]);
  });

  it('replays cash confirmation without a second treasury, ledger, or journal effect', async () => {
    const order = await sales.createSalesOrder(
      {
        customerId,
        paymentType: PaymentType.CASH,
        discount: 0,
        items: [{ productVariantId: variantId, quantity: 1 }],
      },
      userId,
    );
    if (!('id' in order)) {
      throw new Error('Unexpected idempotency replay while creating fixture');
    }

    const key = `p0-cash-replay-${randomUUID()}`;
    const first = await sales.confirmOrder(order.id, userId, key, treasuryId);
    if (!('id' in first)) {
      throw new Error('Unexpected idempotency replay while confirming fixture');
    }
    const replay = await sales.confirmOrder(order.id, userId, key, treasuryId);

    expect(replay).toMatchObject({
      id: first.id,
      code: first.code,
      status: 'CONFIRMED',
    });
    expect(
      await prisma.treasury.findUnique({ where: { id: treasuryId } }),
    ).toMatchObject({
      balance: new Prisma.Decimal('114.00'),
    });
    expect(
      await prisma.journalEntry.count({ where: { reference: order.code } }),
    ).toBe(1);
    expect(
      await prisma.stockLedgerEntry.count({
        where: { productVariantId: variantId, reference: order.code },
      }),
    ).toBe(0);
  });

  it('records and replays a credit customer collection with balanced operational deltas', async () => {
    const order = await sales.createSalesOrder(
      {
        customerId,
        paymentType: PaymentType.CREDIT,
        discount: 0,
        items: [{ productVariantId: variantId, quantity: 1 }],
      },
      userId,
    );
    if (!('id' in order)) {
      throw new Error('Unexpected idempotency replay while creating fixture');
    }

    await sales.confirmOrder(order.id, userId, undefined);
    const key = `p0-customer-payment-${randomUUID()}`;
    const first = await sales.recordCustomerPayment(
      order.id,
      { amount: 40, treasuryId, notes: 'تحصيل جزئي' },
      userId,
      key,
    );
    if (!('id' in first)) {
      throw new Error('Unexpected idempotency replay while recording payment');
    }
    const replay = await sales.recordCustomerPayment(
      order.id,
      { amount: 40, treasuryId, notes: 'تحصيل جزئي' },
      userId,
      key,
    );

    expect(replay).toMatchObject({ id: first.id, amount: 40, replayed: true });
    expect(
      await prisma.customerPayment.count({ where: { salesOrderId: order.id } }),
    ).toBe(1);
    expect(
      await prisma.treasury.findUnique({ where: { id: treasuryId } }),
    ).toMatchObject({ balance: new Prisma.Decimal('40.00') });
    expect(
      await prisma.customer.findUnique({ where: { id: customerId } }),
    ).toMatchObject({ balance: new Prisma.Decimal('74.00') });
    expect(
      await prisma.account.findUnique({
        where: { id: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE },
      }),
    ).toMatchObject({ balance: new Prisma.Decimal('74.00') });
    const payment = await prisma.customerPayment.findUnique({
      where: { id: first.id },
    });
    expect(payment?.amount).toEqual(new Prisma.Decimal('40.00'));
    const paymentJournal = await prisma.journalEntry.findUnique({
      where: { postingKey: `customer-payment:${first.id}` },
      include: { lines: true },
    });
    expect(paymentJournal?.lines).toEqual([
      expect.objectContaining({
        debitAccountId: CHART_OF_ACCOUNTS.CASH,
        creditAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
        amount: new Prisma.Decimal('40.00'),
      }),
    ]);
  });
});
