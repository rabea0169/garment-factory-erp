import {
  AccountType,
  PaymentType,
  Prisma,
  UserRole,
  WarehouseType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CHART_OF_ACCOUNTS } from '../src/core/financial/chart-of-accounts';
import { FinancialPostingService } from '../src/core/financial/financial-posting.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { SalesService } from '../src/modules/sales/sales.service';
import { PrismaService } from '../src/prisma/prisma.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe('P0 cash sale reconciliation integration', () => {
  let prisma: PrismaService;
  let sales: SalesService;
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
    const inventory = new InventoryService(
      prisma,
      new EventEmitter2(),
      new FinancialPostingService(prisma),
    );
    sales = new SalesService(
      prisma,
      inventory,
      new FinancialPostingService(prisma),
    );
  });

  beforeEach(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "journal_lines",
        "journal_entries",
        "accounts",
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

  it('updates Treasury, CASH GL, stock, and COGS atomically for cash sale', async () => {
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
    expect(journal?.lines).toHaveLength(3);
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
    ).toBe(1);
  });
});
