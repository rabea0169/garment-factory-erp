import {
  AccountType,
  FiscalPeriodStatus,
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
  let approverId: string;
  let workerId: string;
  let secondWorkerId: string;
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
        "users",
        "fiscal_periods"
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
    // COMM-F02 (wave 5): SoD — the payroll creator may NOT approve it
    // themselves. Every approvePayroll call below uses this second, distinct
    // actor so the scenarios comply with the separation-of-duties rule while
    // still exercising create/approve/pay idempotency end to end.
    const approver = await prisma.user.create({
      data: {
        name: 'GF-0015 Payroll Approver (SoD second actor)',
        email: `gf0015-approver-${randomUUID()}@example.test`,
        password: 'integration-only-hash',
        role: UserRole.ACCOUNTANT,
      },
    });
    approverId = approver.id;
    // ACC-3 (GF-IMP-W2): كل ترحيل آلي بلا fiscalPeriodId (اعتماد/دفع الرواتب)
    // يُحل الآن إلى الفترة المفتوحة الشاملة لتاريخ القيد — نزرع فترة مفتوحة
    // تغطي تواريخ السيناريو (أغسطس) وتاريخ اليوم (قيود بلا تاريخ صريح تُرحّل
    // بتاريخ الآن). بلا فترة مفتوحة يُرفض الترحيل بـ 400 (سلوك مقصود).
    await prisma.fiscalPeriod.create({
      data: {
        name: `GF-0015-open-${randomUUID().slice(0, 8)}`,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T00:00:00.000Z'),
        status: FiscalPeriodStatus.OPEN,
        createdById: actorId,
      },
    });
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
    // HR-3: عامل ثانٍ للتحقق أن فحص التداخل مقيد بالعامل نفسه.
    const secondWorker = await prisma.worker.create({
      data: {
        code: `WR-GF15-B-${randomUUID().slice(0, 8)}`,
        name: 'GF-0015 Second Worker',
        specialty: WorkerSpecialty.SEWING,
        pieceRate: new Prisma.Decimal('5.50'),
      },
    });
    secondWorkerId = secondWorker.id;
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
    ).rejects.toThrow(
      // HR-3 (GF-IMP-W2): نفس الفترة تُرفض الآن برسالة رفض التداخل النطاقي.
      'تتداخل فترة كشف الراتب مع كشف قائم لنفس العامل — لا يُسمح بتداخل فترات الرواتب',
    );
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
      approverId,
      approveKey,
    );
    const approvedReplay = await hrService.approvePayroll(
      first.id,
      approverId,
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
      approverId,
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
    ).toBe(2); // WAVE2-C2 (COMM-F03): one approval entry + one payment entry
    const treasury = await prisma.treasury.findUnique({
      where: { id: treasuryId },
    });
    expect(treasury?.balance.toNumber()).toBe(590);
    const cash = await prisma.account.findUnique({
      where: { id: CHART_OF_ACCOUNTS.CASH },
    });
    expect(cash?.balance.toNumber()).toBe(590);
    // HR-1 (P0 — GF-IMP-W1): قيد الدفع الحقيقي — Dr SALARIES_PAYABLE
    // بالإجمالي (بندّين: صافٍ 410 نقدية + 250 استرداد سلف) يصفّي الالتزام
    // بدل تسجيل المصروف مرة ثانية.
    const paymentEntry = await prisma.journalEntry.findUnique({
      where: { postingKey: `hr-payroll-pay:${payroll.id}` },
      include: { lines: true },
    });
    expect(paymentEntry?.lines).toHaveLength(2);
    expect(paymentEntry?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
          creditAccountId: CHART_OF_ACCOUNTS.CASH,
          amount: new Prisma.Decimal('410.00'),
        }),
        expect.objectContaining({
          debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
          creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
          amount: new Prisma.Decimal('250.00'),
        }),
      ]),
    );
    // بوابة توازن الميزان المصغّرة: رصيد رواتب مستحقة صفر، المصروف مرة
    // واحدة بالإجمالي، وسلف العمال انخفضت بقيمة الخصومات.
    const salariesPayable = await prisma.account.findUnique({
      where: { id: CHART_OF_ACCOUNTS.SALARIES_PAYABLE },
    });
    expect(salariesPayable?.balance.toNumber()).toBe(0);
    const salariesExpense = await prisma.account.findUnique({
      where: { id: CHART_OF_ACCOUNTS.SALARIES_EXPENSE },
    });
    expect(salariesExpense?.balance.toNumber()).toBe(660);
    const workerAdvances = await prisma.account.findUnique({
      where: { id: CHART_OF_ACCOUNTS.WORKER_ADVANCES },
    });
    // السلفة هنا سُجّلت صفًا مباشرًا بلا قيد GL — خصومات الدفع تُقيّد
    // دائنًا على WORKER_ADVANCES فينخفض الرصيد بقيمة الخصومات (250-).
    expect(workerAdvances?.balance.toNumber()).toBe(-250);
    const generalExpense = await prisma.account.findUnique({
      where: { id: CHART_OF_ACCOUNTS.GENERAL_EXPENSE },
    });
    expect(generalExpense?.balance.toNumber()).toBe(0);
    // HR-2 (GF-IMP-W2): الخصم 250 وُزّع فعليًا FIFO على سلفة الفترة داخل
    // معاملة الدفع — سجل السلفة يوثّق التسوية الكاملة (settledAmount=250)
    // فلا يعيد كشف لاحق خصمها.
    const settledAdvance = await prisma.workerAdvance.findFirst({
      where: { workerId },
      orderBy: { date: 'asc' },
    });
    expect(settledAdvance?.settledAmount.toNumber()).toBe(250);
    expect(settledAdvance?.amount.toNumber()).toBe(250);
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

  // HR-3 (P1 — GF-IMP-W2): منع تداخل فترات الرواتب على قاعدة حقيقية.
  it('rejects a partially overlapping payroll period for the same worker (HR-3)', async () => {
    await hrService.createPayroll(
      { workerId, periodStart, periodEnd },
      actorId,
      `gf0015-hr3-${randomUUID()}`,
    );

    // فترة متداخلة جزئيًا: 15 أغسطس - 15 سبتمبر تتقاطع مع 1-31 أغسطس.
    await expect(
      hrService.createPayroll(
        {
          workerId,
          periodStart: new Date('2026-08-15T00:00:00.000Z'),
          periodEnd: new Date('2026-09-15T00:00:00.000Z'),
        },
        actorId,
      ),
    ).rejects.toThrow('تتداخل فترة كشف الراتب');
    // فترة سابقة منتهية لا تتقاطع → تنجح.
    await expect(
      hrService.createPayroll(
        {
          workerId,
          periodStart: new Date('2026-07-01T00:00:00.000Z'),
          periodEnd: new Date('2026-07-31T00:00:00.000Z'),
        },
        actorId,
      ),
    ).resolves.toMatchObject({ status: PayrollStatus.DRAFT });
    expect(await prisma.payroll.count()).toBe(2);
  });

  it('allows the same period for a different worker (HR-3 scope is per worker)', async () => {
    const first = await hrService.createPayroll(
      { workerId, periodStart, periodEnd },
      actorId,
    );
    const second = await hrService.createPayroll(
      { workerId: secondWorkerId, periodStart, periodEnd },
      actorId,
    );

    expect(first).toMatchObject({ status: PayrollStatus.DRAFT });
    expect(second).toMatchObject({ status: PayrollStatus.DRAFT });
    expect(await prisma.payroll.count()).toBe(2);
  });

  // HR-2 (P1 — GF-IMP-W2): ذاكرة تسوية السلف عبر الدفع الفعلي — الخصم
  // يُوزّع FIFO على سلف الفترة داخل معاملة الدفع، والسلفة المسية بالكامل
  // لا تُعاد خصمًا في كشف لاحق (يغطيها فحص HR-3 + حساب المتبقي غير المسى).
  it('settles advances FIFO on payment and never re-deducts a fully settled advance (HR-2)', async () => {
    // سلفة 200 بتاريخ داخل الفترة + سلفة 300 بتاريخ لاحق داخل الفترة.
    await prisma.workerAdvance.create({
      data: {
        workerId,
        amount: new Prisma.Decimal('200.00'),
        date: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    await prisma.workerAdvance.create({
      data: {
        workerId,
        amount: new Prisma.Decimal('300.00'),
        date: new Date('2026-08-20T00:00:00.000Z'),
      },
    });

    // الإنتاج في الفترة 660 — المتبقي غير المسى من السلف 750 (250+200+300)
    // فيُحدّ الخصم عند gross (HR-2: الحد الأقصى الإجمالي كما كان).
    const payroll = await hrService.createPayroll(
      { workerId, periodStart, periodEnd },
      actorId,
      `gf0015-hr2-create-${randomUUID()}`,
    );
    expect(payroll).toMatchObject({
      grossAmount: 660,
      advanceDeduct: 660, // 750 (متبقي السلف) مُحدّ عند gross
      netAmount: 0,
    });

    await hrService.approvePayroll(
      payroll.id,
      approverId,
      `gf0015-hr2-approve-${randomUUID()}`,
    );
    await hrService.payPayroll(
      payroll.id,
      { treasuryId, paymentDate: periodEnd },
      actorId,
      `gf0015-hr2-pay-${randomUUID()}`,
    );

    // التوزيع FIFO بالترتيب الزمني: سلفة 10/8 (200) كاملة، ثم سلفة
    // beforeEach 15/8 (250) كاملة، ثم 210 فقط من سلفة 20/8 (300) —
    // المجموع 660 (قيمة الخصم) ولا سلفة تتجاوز amount.
    const rows = await prisma.workerAdvance.findMany({
      where: { workerId },
      orderBy: { date: 'asc' },
    });
    expect(
      rows.map((row) => [row.amount.toNumber(), row.settledAmount.toNumber()]),
    ).toEqual([
      [200, 200],
      [250, 250],
      [300, 210],
    ]);

    // صافٍ = صفر: لا نقدية تخرج من الخزينة (قيد خصومات فقط) — HR-1.
    const treasuryAfter = await prisma.treasury.findUnique({
      where: { id: treasuryId },
    });
    expect(treasuryAfter?.balance.toNumber()).toBe(1000);

    // كشف لاحق لنفس الفترة مرفوض بفحص HR-3 — لا مسار لإعادة الخصم أصلًا،
    // وحتى مع بيانات قديمة: السلفان المسيتان بالكامل (200/250) لن تدخلا
    // حساب الخصم — المتبقي غير المسى الوحيد هو 90 من سلفة الـ300.
    const remainingUnsettled = rows.reduce(
      (sum, row) => sum + row.amount.minus(row.settledAmount).toNumber(),
      0,
    );
    expect(remainingUnsettled).toBe(90);
  });
});
