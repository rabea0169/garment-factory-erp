import {
  AccountType,
  FiscalPeriodStatus,
  UserRole,
  VoucherType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { FinancialPostingService } from '../src/core/financial/financial-posting.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CHART_OF_ACCOUNTS } from '../src/core/financial/chart-of-accounts';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe('GF-0018 accounting fiscal period integration', () => {
  let prisma: PrismaService;
  let accounting: AccountingService;
  let userId: string;
  let periodId: string;
  let debitAccountId: string;
  let creditAccountId: string;
  let treasuryId: string;
  let customerId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    accounting = new AccountingService(
      prisma,
      new FinancialPostingService(prisma),
    );
  });

  beforeEach(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE "journal_lines", "journal_entries", "fiscal_periods", "accounts", "users" CASCADE
    `);
    const user = await prisma.user.create({
      data: {
        name: 'GF-0018 Accounting Integration User',
        email: `gf0018-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.ACCOUNTANT,
      },
    });
    userId = user.id;
    const startDate = new Date('2026-08-01T00:00:00.000Z');
    const endDate = new Date('2026-08-31T00:00:00.000Z');
    const period = await prisma.fiscalPeriod.create({
      data: {
        name: `2026-08-${randomUUID().slice(0, 8)}`,
        startDate,
        endDate,
        status: FiscalPeriodStatus.OPEN,
        createdById: userId,
      },
    });
    periodId = period.id;
    const debit = await prisma.account.create({
      data: {
        code: `GF18-D-${randomUUID().slice(0, 8)}`,
        name: 'GF-0018 Debit Account',
        type: AccountType.ASSET,
      },
    });
    const credit = await prisma.account.create({
      data: {
        code: `GF18-C-${randomUUID().slice(0, 8)}`,
        name: 'GF-0018 Credit Account',
        type: AccountType.EXPENSE,
      },
    });
    await prisma.account.createMany({
      data: [
        {
          id: CHART_OF_ACCOUNTS.CASH,
          code: 'GF18-CASH',
          name: 'GF-0018 Cash',
          type: AccountType.ASSET,
        },
        {
          id: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
          code: 'GF18-AR',
          name: 'GF-0018 Accounts Receivable',
          type: AccountType.ASSET,
        },
      ],
    });
    const treasury = await prisma.treasury.create({
      data: { name: 'GF-0018 Treasury', type: 'CASH' },
    });
    treasuryId = treasury.id;
    const customer = await prisma.customer.create({
      data: {
        code: `GF18-CUST-${randomUUID().slice(0, 8)}`,
        name: 'GF-0018 Customer',
      },
    });
    customerId = customer.id;
    debitAccountId = debit.id;
    creditAccountId = credit.id;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('posts a multi-line journal into an open fiscal period', async () => {
    const result = await accounting.createJournalEntry(
      {
        description: 'GF-0018 integration journal',
        fiscalPeriodId: periodId,
        date: '2026-08-26T00:00:00.000Z',
        lines: [
          {
            debitAccountId,
            creditAccountId,
            amount: 125.5,
            description: 'integration line',
          },
        ],
      },
      userId,
    );

    const entry = await prisma.journalEntry.findUnique({
      where: { id: result.entryId },
    });
    expect(entry).toMatchObject({
      fiscalPeriodId: periodId,
      createdById: userId,
    });
    expect(entry?.date.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });

  it('reverses voucher operational balances together with the journal', async () => {
    const voucher = await accounting.createVoucher(
      {
        type: VoucherType.RECEIPT,
        amount: 50,
        description: 'GF-0020 receipt reversal integration',
        treasuryId,
        counterpartyType: 'CUSTOMER',
        counterpartyId: customerId,
      },
      userId,
      `gf0020-voucher-${randomUUID()}`,
    );
    const journalEntryId = voucher.journalEntry?.id;
    expect(journalEntryId).toBeTruthy();

    expect(
      (
        await prisma.treasury.findUnique({ where: { id: treasuryId } })
      )?.balance.toNumber(),
    ).toBe(50);
    expect(
      (
        await prisma.customer.findUnique({ where: { id: customerId } })
      )?.balance.toNumber(),
    ).toBe(-50);

    await accounting.reverseJournalEntry(journalEntryId!, userId);

    expect(
      (
        await prisma.treasury.findUnique({ where: { id: treasuryId } })
      )?.balance.toNumber(),
    ).toBe(0);
    expect(
      (
        await prisma.customer.findUnique({ where: { id: customerId } })
      )?.balance.toNumber(),
    ).toBe(0);
    expect(
      (
        await prisma.account.findUnique({
          where: { id: CHART_OF_ACCOUNTS.CASH },
        })
      )?.balance.toNumber(),
    ).toBe(0);
    expect(
      (
        await prisma.account.findUnique({
          where: { id: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE },
        })
      )?.balance.toNumber(),
    ).toBe(0);
    expect(
      (await prisma.journalEntry.findUnique({ where: { id: journalEntryId } }))
        ?.isReversed,
    ).toBe(true);
  });

  it('rejects posting after the fiscal period is closed', async () => {
    await accounting.closeFiscalPeriod(periodId, userId);
    await expect(
      accounting.createJournalEntry(
        {
          description: 'closed period journal',
          fiscalPeriodId: periodId,
          date: '2026-08-26T00:00:00.000Z',
          lines: [{ debitAccountId, creditAccountId, amount: 10 }],
        },
        userId,
      ),
    ).rejects.toThrow('فترة مالية مغلقة');
  });
});
