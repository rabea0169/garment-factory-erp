import {
  AccountType,
  FiscalPeriodStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { FinancialPostingService } from '../src/core/financial/financial-posting.service';
import { PrismaService } from '../src/prisma/prisma.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe('GF-0018 accounting fiscal period integration', () => {
  let prisma: PrismaService;
  let accounting: AccountingService;
  let financial: FinancialPostingService;
  let userId: string;
  let periodId: string;
  let debitAccountId: string;
  let creditAccountId: string;

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
    financial = new FinancialPostingService(prisma);
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
    const startDate = new Date('2026-01-01T00:00:00.000Z');
    const endDate = new Date('2026-12-31T00:00:00.000Z');
    // ACC-3 (GF-IMP-W2): فترة مفتوحة شاملة لكل سنة 2026 — تغطي تواريخ
    // السيناريو (أغسطس) وتاريخ اليوم (القيود التي تُرحّل بتاريخ الآن
    // مثل قيود العكس) كي يجد محرك الترحيل فترة يربط بها القيود الآلية.
    const period = await prisma.fiscalPeriod.create({
      data: {
        name: `2026-open-${randomUUID().slice(0, 8)}`,
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

  // ACC-3 (P1 — GF-IMP-W2): الترحيل الآلي بلا fiscalPeriodId يُحل إلى
  // الفترة المفتوحة الشاملة لتاريخ القيد — إقفال الفترة فعّال الآن عبر
  // كل المسارات الآلية لا اليدوية فقط.
  it('binds an automatic posting without fiscalPeriodId to the open covering period (ACC-3)', async () => {
    const result = await financial.postJournalEntry(
      {
        description: 'GF-0018 auto posting without period',
        date: new Date('2026-08-26T00:00:00.000Z'),
        lines: [
          {
            debitAccountId,
            creditAccountId,
            amount: 55,
          },
        ],
        userId,
      },
      userId,
    );

    const entry = await prisma.journalEntry.findUnique({
      where: { id: result.entryId },
    });
    expect(entry?.fiscalPeriodId).toBe(periodId);
  });

  it('rejects an automatic posting whose date falls outside every open period (ACC-3)', async () => {
    await expect(
      financial.postJournalEntry(
        {
          description: 'GF-0018 auto posting outside all periods',
          date: new Date('2027-05-01T00:00:00.000Z'),
          lines: [
            {
              debitAccountId,
              creditAccountId,
              amount: 20,
            },
          ],
          userId,
        },
        userId,
      ),
    ).rejects.toThrow('لا يمكن الترحيل خارج فترة مالية مفتوحة');
    // لم يُنشأ أي قيد — beforeEach يبدأ كل حالة من قاعدة فارغة.
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  // ACC-2 (P1 — GF-IMP-W2): العكس الموثوق — قيد مُرحّل عبر المحرك يحمل
  // لقطة تأثيراته الجانبية في metadata فيُعكس بأمان كامل الأرصدة.
  it('reverses an engine-posted entry and restores account balances (ACC-2)', async () => {
    const posted = await accounting.createJournalEntry(
      {
        description: 'GF-0018 reversal source entry',
        fiscalPeriodId: periodId,
        date: '2026-08-26T00:00:00.000Z',
        lines: [{ debitAccountId, creditAccountId, amount: 125.5 }],
      },
      userId,
    );

    const [debitBefore, creditBefore] = await Promise.all([
      prisma.account.findUnique({ where: { id: debitAccountId } }),
      prisma.account.findUnique({ where: { id: creditAccountId } }),
    ]);
    expect(debitBefore?.balance.toNumber()).toBe(125.5);
    expect(creditBefore?.balance.toNumber()).toBe(-125.5);

    const reversal = await accounting.reverseJournalEntry(
      posted.entryId,
      userId,
      'عكس قيد GF-0018',
    );

    expect(reversal.reversedEntryId).toBe(posted.entryId);
    const [debitAfter, creditAfter, original] = await Promise.all([
      prisma.account.findUnique({ where: { id: debitAccountId } }),
      prisma.account.findUnique({ where: { id: creditAccountId } }),
      prisma.journalEntry.findUnique({
        where: { id: posted.entryId },
      }),
    ]);
    // أرصدة الحسابات تعود كما كانت قبل القيد الأصلي.
    expect(debitAfter?.balance.toNumber()).toBe(0);
    expect(creditAfter?.balance.toNumber()).toBe(0);
    expect(original?.isReversed).toBe(true);
    const reversalEntry = await prisma.journalEntry.findUnique({
      where: { id: reversal.entryId },
    });
    expect(reversalEntry?.reversalOfId).toBe(posted.entryId);
    expect(await prisma.journalEntry.count()).toBe(2);
  });

  // ACC-2: قيد بلا أثر جانبي موثق (نمط تراثي كُتب مباشرة في القاعدة بلا
  // لقطة metadata) يُحظر عكسه بدل ترك الأرصدة تتقادم بعد عكس GL فقط.
  it('refuses to reverse an entry without documented side effects (ACC-2)', async () => {
    const legacy = await prisma.journalEntry.create({
      data: {
        code: `JE-LEGACY-${randomUUID().slice(0, 8)}`,
        description: 'legacy entry without side-effect metadata',
        date: new Date('2026-08-26T00:00:00.000Z'),
        lines: {
          create: [
            {
              debitAccountId,
              creditAccountId,
              amount: new Prisma.Decimal('40.00'),
            },
          ],
        },
      },
    });

    await expect(
      accounting.reverseJournalEntry(legacy.id, userId, 'عكس تراثي'),
    ).rejects.toThrow(ConflictException);
    await expect(
      accounting.reverseJournalEntry(legacy.id, userId, 'عكس تراثي'),
    ).rejects.toThrow('بلا أثر جانبي موثق');
    // لم يُعلّم كمعكوس ولم يُنشأ قيد عكسي.
    const untouched = await prisma.journalEntry.findUnique({
      where: { id: legacy.id },
    });
    expect(untouched?.isReversed).toBe(false);
  });
});
