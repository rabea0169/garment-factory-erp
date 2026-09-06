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

/**
 * W1-A — بوابة توازن الميزان (P0 integrity gate).
 *
 * سيناريو دورة رواتب كاملة على قاعدة حقيقية: عامل + سلفة مُرحّلة GL +
 * إنتاج يومي + كشف راتب (create → approve → pay)، ثم تحقق مباشر على
 * journal_entries / journal_lines:
 *   (1) مجموع المدين = مجموع الدائن على مستوى القاعدة كلها.
 *   (2) رصيد SALARIES_PAYABLE يعود صفرًا بعد الدفع (تصفية الالتزام).
 *   (3) SALARIES_EXPENSE مدين بالإجمالي مرة واحدة فقط (لا ازدواج مصروف
 *       بعد إصلاح HR-1 الذي كان يقيّد المصروف مرة ثانية عند الدفع).
 *   (4) WORKER_ADVANCES انخفض بقيمة الخصومات (استرداد السلف من كشف
 *       الراتب المعتمد).
 *
 * يتبع نفس نمط إعداد test/payroll.integration-spec.ts: تُعلَّم الـ suite
 * skipped عند غياب GF_INTEGRATION_DATABASE_URL، وقبل كل حالة تُفرَّغ
 * الجداول ويُعاد زرع الأساس. لا تُشغَّل ضمن مواصفات الوحدات إطلاقًا.
 */
const integrationDescribe = process.env.GF_INTEGRATION_DATABASE_URL
  ? describe
  : describe.skip;

integrationDescribe(
  'W1-A accounting integrity gate — payroll full cycle',
  () => {
    let prisma: PrismaService;
    let hrService: HrService;
    let actorId: string;
    let approverId: string;
    let workerId: string;
    let treasuryId: string;
    let payrollId: string;
    const periodStart = new Date('2026-08-01T00:00:00.000Z');
    const periodEnd = new Date('2026-08-31T00:00:00.000Z');

    // القيم المرجعية للسيناريو: إجمالي 660 (550+110 إنتاج)، سلفة 250،
    // خصومات 250، صافي 410. مجموع القيود: 250 (سلفة) + 660 (اعتماد)
    // + 660 (دفع = 410 نقدية + 250 استرداد سلف) = 1570 لكل طرف.
    const GROSS = 660;
    const ADVANCE = 250;
    const NET = 410;
    const TOTAL_POSTED = 1570;

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
          name: 'W1-A Integrity Creator',
          email: `w1a-${randomUUID()}@example.test`,
          password: 'integration-only-hash',
          role: UserRole.HR_MANAGER,
        },
      });
      actorId = actor.id;
      // COMM-F02 (SoD): منشئ الكشف لا يعتمده بنفسه — معتمد ثانٍ مستقل.
      const approver = await prisma.user.create({
        data: {
          name: 'W1-A Integrity Approver (SoD second actor)',
          email: `w1a-approver-${randomUUID()}@example.test`,
          password: 'integration-only-hash',
          role: UserRole.ACCOUNTANT,
        },
      });
      approverId = approver.id;
      await prisma.account.createMany({
        data: [
          {
            id: CHART_OF_ACCOUNTS.CASH,
            code: `1100-W1A-${randomUUID().slice(0, 8)}`,
            name: 'W1-A Cash',
            type: AccountType.ASSET,
            balance: 1000,
          },
          {
            id: CHART_OF_ACCOUNTS.SALARIES_EXPENSE,
            code: `5200-W1A-${randomUUID().slice(0, 8)}`,
            name: 'W1-A Salaries Expense',
            type: AccountType.EXPENSE,
            balance: 0,
          },
          {
            id: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
            code: `2400-W1A-${randomUUID().slice(0, 8)}`,
            name: 'W1-A Salaries Payable',
            type: AccountType.LIABILITY,
            balance: 0,
          },
          {
            id: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
            code: `1330-W1A-${randomUUID().slice(0, 8)}`,
            name: 'W1-A Worker Advances',
            type: AccountType.ASSET,
            balance: 0,
          },
          {
            id: CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
            code: `5000-W1A-${randomUUID().slice(0, 8)}`,
            name: 'W1-A General Expense',
            type: AccountType.EXPENSE,
            balance: 0,
          },
        ],
      });
      const treasury = await prisma.treasury.create({
        data: {
          name: 'W1-A Integrity Treasury',
          type: 'CASH',
          balance: 1000,
        },
      });
      treasuryId = treasury.id;
      const worker = await prisma.worker.create({
        data: {
          code: `WR-W1A-${randomUUID().slice(0, 8)}`,
          name: 'W1-A Integrity Worker',
          specialty: WorkerSpecialty.SEWING,
          pieceRate: new Prisma.Decimal('5.50'),
        },
      });
      workerId = worker.id;

      // السلفة عبر الخدمة كي تُرحّل فعليًا Dr WORKER_ADVANCES / Cr CASH
      // (COMM-F05) — ثم نأرّخها داخل الفترة كي تُخصم من كشف الراتب.
      const advance = await hrService.recordAdvance(
        { workerId, amount: ADVANCE, treasuryId, notes: 'سلفة أغسطس' },
        actorId,
        `w1a-advance-${randomUUID()}`,
      );
      await prisma.workerAdvance.update({
        where: { id: advance.id },
        data: { date: new Date('2026-08-15T00:00:00.000Z') },
      });

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

      // دورة الرواتب الكاملة: create → approve → pay.
      const payroll = await hrService.createPayroll(
        { workerId, periodStart, periodEnd },
        actorId,
        `w1a-create-${randomUUID()}`,
      );
      payrollId = payroll.id;
      expect(payroll).toMatchObject({
        grossAmount: GROSS,
        advanceDeduct: ADVANCE,
        absenceDeduct: 0,
        netAmount: NET,
        status: PayrollStatus.DRAFT,
      });

      const approved = await hrService.approvePayroll(
        payrollId,
        approverId,
        `w1a-approve-${randomUUID()}`,
      );
      expect(approved.status).toBe(PayrollStatus.APPROVED);

      const paid = await hrService.payPayroll(
        payrollId,
        { treasuryId, paymentDate: periodEnd, notes: 'صرف راتب أغسطس' },
        actorId,
        `w1a-pay-${randomUUID()}`,
      );
      expect(paid.status).toBe(PayrollStatus.PAID);
      expect(paid.isPaid).toBe(true);
    });

    afterAll(async () => {
      if (prisma) await prisma.$disconnect();
    });

    // (1) بوابة التوازن الكبرى: مجموع المدين = مجموع الدائن على مستوى
    // القاعدة كلها (كل بنود كل القيود، لا قيد واحد فقط).
    it('keeps total debit equal to total credit across the whole ledger', async () => {
      const [debitGroups, creditGroups] = await Promise.all([
        prisma.journalLine.groupBy({
          by: ['debitAccountId'],
          _sum: { amount: true },
        }),
        prisma.journalLine.groupBy({
          by: ['creditAccountId'],
          _sum: { amount: true },
        }),
      ]);
      const totalDebit = debitGroups.reduce(
        (sum, group) => sum + Number(group._sum.amount ?? 0),
        0,
      );
      const totalCredit = creditGroups.reduce(
        (sum, group) => sum + Number(group._sum.amount ?? 0),
        0,
      );
      // 3 قيود: سلفة 250 + اعتماد 660 + دفع 660 (410 نقدية + 250 استرداد).
      expect(totalDebit).toBe(TOTAL_POSTED);
      expect(totalCredit).toBe(TOTAL_POSTED);
      expect(totalDebit).toBe(totalCredit);
      expect(await prisma.journalEntry.count()).toBe(3);
    });

    // (2) رصيد رواتب مستحقة يعود صفرًا: الاعتماد قيّدها دائنًا بالإجمالي
    // والدفع مدينًا بالإجمالي (HR-1) — الالتزام مُصفّى بالكامل.
    it('clears SALARIES_PAYABLE back to zero after approval and payment', async () => {
      const salariesPayable = await prisma.account.findUnique({
        where: { id: CHART_OF_ACCOUNTS.SALARIES_PAYABLE },
      });
      expect(salariesPayable?.balance.toNumber()).toBe(0);
      // تفصيل البنود: دائن 660 من الاعتماد مقابل مدين 410 + 250 من الدفع.
      const [creditSide, debitSide] = await Promise.all([
        prisma.journalLine.aggregate({
          where: { creditAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE },
          _sum: { amount: true },
        }),
        prisma.journalLine.aggregate({
          where: { debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE },
          _sum: { amount: true },
        }),
      ]);
      expect(Number(creditSide._sum.amount ?? 0)).toBe(GROSS);
      expect(Number(debitSide._sum.amount ?? 0)).toBe(GROSS);
    });

    // (3) مصروف الرواتب مدين بالإجمالي مرة واحدة فقط — قيد الدفع لم يعد
    // يقيّد أي مصروف (كان HR-1 يسجّل GENERAL_EXPENSE ثانية بالصافي).
    it('debits SALARIES_EXPENSE exactly once with the gross amount', async () => {
      const expenseLines = await prisma.journalLine.findMany({
        where: { debitAccountId: CHART_OF_ACCOUNTS.SALARIES_EXPENSE },
      });
      expect(expenseLines).toHaveLength(1);
      expect(Number(expenseLines[0].amount)).toBe(GROSS);
      const salariesExpense = await prisma.account.findUnique({
        where: { id: CHART_OF_ACCOUNTS.SALARIES_EXPENSE },
      });
      expect(salariesExpense?.balance.toNumber()).toBe(GROSS);
      // لا بنود إطلاقًا على GENERAL_EXPENSE — لا ازدواج مصروف بعد الآن.
      const generalExpenseLines = await prisma.journalLine.findMany({
        where: {
          OR: [
            { debitAccountId: CHART_OF_ACCOUNTS.GENERAL_EXPENSE },
            { creditAccountId: CHART_OF_ACCOUNTS.GENERAL_EXPENSE },
          ],
        },
      });
      expect(generalExpenseLines).toHaveLength(0);
      const generalExpense = await prisma.account.findUnique({
        where: { id: CHART_OF_ACCOUNTS.GENERAL_EXPENSE },
      });
      expect(generalExpense?.balance.toNumber()).toBe(0);
    });

    // (4) سلف العمال انخفضت بقيمة الخصومات: السلفة رحّلت مدينًا 250 على
    // WORKER_ADVANCES، والدفع قيّد دائنًا 250 (استرداد) فرجع الرصيد صفرًا.
    it('decreases WORKER_ADVANCES by the deducted advance amount', async () => {
      const [debitLines, creditLines] = await Promise.all([
        prisma.journalLine.findMany({
          where: { debitAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES },
        }),
        prisma.journalLine.findMany({
          where: { creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES },
        }),
      ]);
      expect(debitLines).toHaveLength(1);
      expect(Number(debitLines[0].amount)).toBe(ADVANCE);
      expect(creditLines).toHaveLength(1);
      expect(Number(creditLines[0].amount)).toBe(ADVANCE);
      const workerAdvances = await prisma.account.findUnique({
        where: { id: CHART_OF_ACCOUNTS.WORKER_ADVANCES },
      });
      expect(workerAdvances?.balance.toNumber()).toBe(0);
    });

    // ملحق البوابة: الخزينة والنقدية تحملان نفس الأثر (سلفة + صافي فقط)
    // — لا خصم بالإجمالي من الصندوق.
    it('deducts only the net amount and the advance from treasury and cash', async () => {
      const treasury = await prisma.treasury.findUnique({
        where: { id: treasuryId },
      });
      expect(treasury?.balance.toNumber()).toBe(1000 - ADVANCE - NET);
      const cash = await prisma.account.findUnique({
        where: { id: CHART_OF_ACCOUNTS.CASH },
      });
      expect(cash?.balance.toNumber()).toBe(1000 - ADVANCE - NET);
    });
  },
);
