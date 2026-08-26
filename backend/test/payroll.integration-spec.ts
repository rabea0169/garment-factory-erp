import {
  AccountType,
  PayrollStatus,
  Prisma,
  UserRole,
  WorkerSpecialty,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { HrService } from '../src/modules/hr/hr.service';
import { CHART_OF_ACCOUNTS } from '../src/core/financial/chart-of-accounts';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinancialPostingService } from '../src/core/financial/financial-posting.service';

const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe('GF-0015 payroll integration', () => {
  let prisma: PrismaService;
  let hrService: HrService;
  let actorId: string;
  let workerId: string;
  let treasuryId: string;
  const periodStart = new Date('2026-08-01T00:00:00.000Z');
  const periodEnd = new Date('2026-08-31T00:00:00.000Z');

  beforeAll(async () => {
    const databaseUrl = process.env.GF_INTEGRATION_DATABASE_URL;
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    hrService = new HrService(prisma, new FinancialPostingService(prisma));
  });

  beforeEach(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "journal_lines",
        "journal_entries",
        "accounts",
        "treasuries",
        "payrolls",
        "activity_logs",
        "idempotency_keys",
        "daily_production",
        "worker_advances",
        "attendance",
        "workers",
        "users"
      CASCADE
    `);
    const actor = await prisma.user.create({
      data: {
        name: 'GF-0015 Payroll Integration User',
        email: `gf0015-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.HR_MANAGER,
      },
    });
    actorId = actor.id;
    await prisma.account.createMany({
      data: [
        {
          id: CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
          code: `5100-GF15-${randomUUID().slice(0, 8)}`,
          name: 'GF-0015 Payroll Expense',
          type: AccountType.EXPENSE,
          balance: 0,
        },
        {
          id: CHART_OF_ACCOUNTS.CASH,
          code: `1100-GF15-${randomUUID().slice(0, 8)}`,
          name: 'GF-0015 Cash',
          type: AccountType.ASSET,
          balance: 1000,
        },
        // WAVE2-C2 (COMM-F03): approvePayroll posts Dr SALARIES_EXPENSE / Cr
        // SALARIES_PAYABLE. Seed both so the GL posting can resolve the
        // accounts after the beforeEach TRUNCATE wiped the migration-seeded rows.
        {
          id: CHART_OF_ACCOUNTS.SALARIES_EXPENSE,
          code: `5200-GF15-${randomUUID().slice(0, 8)}`,
          name: 'GF-0015 Salaries Expense',
          type: AccountType.EXPENSE,
          balance: 0,
        },
        {
          id: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
          code: `2400-GF15-${randomUUID().slice(0, 8)}`,
          name: 'GF-0015 Salaries Payable',
          type: AccountType.LIABILITY,
          balance: 0,
        },
        // WAVE2-C (COMM-F04): payPayroll posts Dr SALARIES_PAYABLE / Cr CASH
        // + advance clearing Dr SALARIES_PAYABLE / Cr WORKER_ADVANCES.
        {
          id: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
          code: `1330-GF15-${randomUUID().slice(0, 8)}`,
          name: 'GF-0015 Worker Advances',
          type: AccountType.ASSET,
          balance: 0,
        },
      ],
    });
    const treasury = await prisma.treasury.create({
      data: { name: 'GF-0015 Payroll Treasury', type: 'CASH', balance: 1000 },
    });
    treasuryId = treasury.id;
    const worker = await prisma.worker.create({
      data: {
        code: `WR-GF15-${randomUUID().slice(0, 8)}`,
        name: 'GF-0015 Worker',
        specialty: WorkerSpecialty.SEWING,
        pieceRate: new Prisma.Decimal('5.50'),
      },
    });
    workerId = worker.id;
    await prisma.dailyProduction.createMany({
      data: [
        {
          workerId,
          date: new Date('2026-08-05T00:00:00.000Z'),
          piecesCount: 100,
          pieceRate: new Prisma.Decimal('5.50'),
          totalAmount: new Prisma.Decimal('550.00'),
        },
        {
          workerId,
          date: new Date('2026-08-10T00:00:00.000Z'),
          piecesCount: 20,
          pieceRate: new Prisma.Decimal('5.50'),
          totalAmount: new Prisma.Decimal('110.00'),
        },
      ],
    });
    await prisma.workerAdvance.create({
      data: {
        workerId,
        amount: new Prisma.Decimal('250.00'),
        date: new Date('2026-08-15T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('calculates server-side draft payroll from production and advances', async () => {
    const result = await hrService.createPayroll(
      { workerId, periodStart, periodEnd },
      actorId,
      `gf0015-create-${randomUUID()}`,
    );

    expect(result).toMatchObject({
      workerId,
      grossAmount: 660,
      advanceDeduct: 250,
      absenceDeduct: 0,
      netAmount: 410,
      status: PayrollStatus.DRAFT,
      createdById: actorId,
    });
    expect(await prisma.payroll.count()).toBe(1);
    expect(
      await prisma.activityLog.count({
        where: { action: 'PAYROLL_CREATED', userId: actorId },
      }),
    ).toBe(1);
  });

  it('caps advances at gross and rejects a duplicate worker period', async () => {
    await prisma.workerAdvance.create({
      data: {
        workerId,
        amount: new Prisma.Decimal('900.00'),
        date: new Date('2026-08-20T00:00:00.000Z'),
      },
    });
    await hrService.createPayroll(
      { workerId, periodStart, periodEnd },
      actorId,
    );

    const stored = await prisma.payroll.findFirst({ where: { workerId } });
    expect(stored?.advanceDeduct.toNumber()).toBe(660);
    expect(stored?.netAmount.toNumber()).toBe(0);
    await expect(
      hrService.createPayroll({ workerId, periodStart, periodEnd }, actorId),
    ).rejects.toThrow('يوجد كشف راتب للعامل في هذه الفترة بالفعل');
  });

  it('replays create and approval idempotency without a second effect', async () => {
    const createKey = `gf0015-replay-${randomUUID()}`;
    const first = await hrService.createPayroll(
      { workerId, periodStart, periodEnd },
      actorId,
      createKey,
    );
    const replay = await hrService.createPayroll(
      { workerId, periodStart, periodEnd },
      actorId,
      createKey,
    );
    expect(replay).toMatchObject({ id: first.id, replayed: true });
    expect(await prisma.payroll.count()).toBe(1);

    const approveKey = `gf0015-approve-${randomUUID()}`;
    const approved = await hrService.approvePayroll(
      first.id,
      actorId,
      approveKey,
    );
    const approvedReplay = await hrService.approvePayroll(
      first.id,
      actorId,
      approveKey,
    );
    expect(approved).toMatchObject({ status: PayrollStatus.APPROVED });
    expect(approvedReplay).toMatchObject({ id: first.id, replayed: true });
    expect(
      await prisma.activityLog.count({ where: { action: 'PAYROLL_APPROVED' } }),
    ).toBe(1);
  });

  it('pays an approved payroll once with cash posting and idempotent replay', async () => {
    const payroll = await hrService.createPayroll(
      { workerId, periodStart, periodEnd },
      actorId,
      `gf0015-pay-create-${randomUUID()}`,
    );
    await hrService.approvePayroll(
      payroll.id,
      actorId,
      `gf0015-pay-approve-${randomUUID()}`,
    );
    const paymentKey = `gf0015-pay-${randomUUID()}`;

    const paid = await hrService.payPayroll(
      payroll.id,
      { treasuryId, paymentDate: periodEnd, notes: 'صرف راتب أغسطس' },
      actorId,
      paymentKey,
    );
    const replay = await hrService.payPayroll(
      payroll.id,
      { treasuryId, paymentDate: periodEnd, notes: 'صرف راتب أغسطس' },
      actorId,
      paymentKey,
    );

    expect(paid).toMatchObject({
      id: payroll.id,
      // WAVE2-C2 (COMM-F04): payPayroll now transitions APPROVED -> PAID
      // (was using APPROVED for both approval and payment, which was semantically
      // wrong — could not distinguish accrued-but-unpaid from paid).
      status: PayrollStatus.PAID,
      isPaid: true,
    });
    expect(replay).toMatchObject({
      id: payroll.id,
      isPaid: true,
      replayed: true,
    });
    expect(
      await prisma.journalEntry.count({
        where: { reference: `PAYROLL:${payroll.id}` },
      }),
    ).toBe(1);
    const treasury = await prisma.treasury.findUnique({
      where: { id: treasuryId },
    });
    expect(treasury?.balance.toNumber()).toBe(590);
    const cash = await prisma.account.findUnique({
      where: { id: CHART_OF_ACCOUNTS.CASH },
    });
    expect(cash?.balance.toNumber()).toBe(590);
  });

  it('does not allow concurrent requests to create two payrolls for one worker period', async () => {
    const results = await Promise.allSettled([
      hrService.createPayroll({ workerId, periodStart, periodEnd }, actorId),
      hrService.createPayroll({ workerId, periodStart, periodEnd }, actorId),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(await prisma.payroll.count()).toBe(1);
  });
});
