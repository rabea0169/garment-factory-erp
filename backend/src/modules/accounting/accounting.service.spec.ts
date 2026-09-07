import { AccountType, Prisma, VoucherType } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * ACC-8 (GF-IMP-W3): سطح القراءة المحاسبي يحتاج journalEntry.findMany
 * وjournalLine.findMany/aggregate/groupBy — امتداد محلي للـ mock الموحد
 * بنمط payroll.service.spec (لا نعدّل الـ helper المشترك الذي يملكه كل الوكلاء).
 */
type AccountingPrismaMock = ReturnType<typeof createPrismaMock> & {
  journalEntry: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
  };
  journalLine: {
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
    groupBy: jest.Mock;
  };
};

function createAccountingPrismaMock(): AccountingPrismaMock {
  return {
    ...createPrismaMock(),
    journalEntry: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    journalLine: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('AccountingService — الحسابات والسندات (GF-0003 + audit v2 A1/A2/A3)', () => {
  let service: AccountingService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let financial: {
    postJournalEntryInTx: jest.Mock;
    postJournalEntry?: jest.Mock;
    reverseJournalEntry?: jest.Mock;
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    financial = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({
        entryId: 'je-001',
        entryCode: 'JE-20260827-ABCD1234',
        totalDebit: 500,
        totalCredit: 500,
        linesCount: 1,
        createdAt: new Date('2026-08-27T00:00:00Z'),
      }),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    // RES-F02: default to "no replay" so the create path is followed.
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    service = new AccountingService(
      prisma as unknown as PrismaService,
      financial as unknown as FinancialPostingService,
    );
  });

  it('يجلب شجرة الحسابات مرتبة بالكود تصاعديًا', async () => {
    const accounts = [
      { id: 'a-1', code: '1000', name: 'الصندوق' },
      { id: 'a-2', code: '1100', name: 'البنك' },
    ];
    prisma.account.findMany.mockResolvedValue(accounts);
    prisma.account.count.mockResolvedValue(accounts.length);

    const result = await service.getChartOfAccounts();

    expect(result.data).toEqual(accounts);
    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { code: 'asc' } }),
    );
  });

  it('ينشئ حسابًا بنوعه من الـ enum وبلا isGroup افتراضيًا', async () => {
    prisma.account.create.mockResolvedValue({ id: 'a-3' });

    await service.createAccount({
      code: '1200',
      name: 'ذمم العملاء',
      type: AccountType.ASSET,
    });

    expect(prisma.account.create).toHaveBeenCalledWith({
      data: {
        code: '1200',
        name: 'ذمم العملاء',
        type: AccountType.ASSET,
        parentId: undefined,
        isGroup: false,
      },
    });
  });

  it('يجلب الخزائن النشطة بترقيم صفحات محدود', async () => {
    const treasuries = [
      { id: 't-1', name: 'الصندوق الرئيسي', type: 'CASH', balance: 100 },
    ];
    prisma.treasury.findMany.mockResolvedValue(treasuries);
    prisma.treasury.count.mockResolvedValue(1);

    const result = await service.getTreasuries({ page: 1, limit: 20 });

    expect(result.data).toEqual(treasuries);
    expect(prisma.treasury.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, deletedAt: null },
        skip: 0,
        take: 20,
      }),
    );
    expect(prisma.treasury.count).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null },
    });
  });

  it('يجلب السندات مع اسم منشئها + رابط القيد + الخزينة', async () => {
    const vouchers = [
      {
        id: 'v-1',
        createdBy: { name: 'المحاسب' },
        journalEntry: { code: 'JE-001', id: 'je-1' },
        treasury: { id: 't-1', name: 'الصندوق الرئيسي' },
      },
    ];
    prisma.voucher.findMany.mockResolvedValue(vouchers);
    prisma.voucher.count.mockResolvedValue(vouchers.length);

    const result = await service.getVouchers();

    expect(result.data).toEqual(vouchers);
    expect(prisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          createdBy: { select: { name: true } },
          journalEntry: { select: { code: true, id: true } },
          treasury: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
      }),
    );
  });

  it('A3: ينشئ سند قبض → قيد مدين CASH / دائن AR + تحديث Treasury.balance ذريًّا', async () => {
    prisma.voucher.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'v-9', ...data }),
    );

    const result = await service.createVoucher(
      {
        type: VoucherType.RECEIPT,
        amount: 500,
        description: 'قبض من عميل آجل',
        treasuryId: 'treasury-001',
        counterpartyType: 'CUSTOMER',
        counterpartyId: 'cust-001',
      },
      'user-from-session',
    );

    // A1/A2: قيد مزدوج ذري + تحديث الخزينة + ربط السند بالقيد.
    const expectedCall: Record<string, unknown> = {
      description: expect.stringContaining('سند قبض'),
      isAuto: true,
      lines: expect.arrayContaining([
        expect.objectContaining({
          debitAccountId: CHART_OF_ACCOUNTS.CASH,
          creditAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
          amount: 500,
        }),
      ]),
      treasuryUpdates: [{ treasuryId: 'treasury-001', delta: 500 }],
      customerUpdates: [{ customerId: 'cust-001', delta: -500 }],
      userId: 'user-from-session',
    };
    expect(financial.postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining(expectedCall),
      'user-from-session',
    );

    // A3: السند مُنشأ بـ journalEntryId مرتبط بالقيد.
    const expectedVoucherData: Record<string, unknown> = {
      type: VoucherType.RECEIPT,
      amount: 500,
      createdById: 'user-from-session',
      journalEntryId: 'je-001',
      treasuryId: 'treasury-001',
      counterpartyType: 'CUSTOMER',
      counterpartyId: 'cust-001',
    };
    const expectedCreateCall: Record<string, unknown> = {
      data: expect.objectContaining(expectedVoucherData),
      include: {
        journalEntry: { select: { code: true, id: true } },
        treasury: { select: { id: true, name: true } },
      },
    };
    expect(prisma.voucher.create).toHaveBeenCalledWith(expectedCreateCall);
    expect(result.journalEntryId).toBe('je-001');
  });

  it('A3: ينشئ سند صرف → قيد مدين AP / دائن CASH + خصم Treasury', async () => {
    prisma.voucher.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'v-10', ...data }),
    );

    await service.createVoucher(
      {
        type: VoucherType.PAYMENT,
        amount: 300,
        description: 'صرف لمورد آجل',
        treasuryId: 'treasury-002',
        counterpartyType: 'SUPPLIER',
        counterpartyId: 'sup-001',
      },
      'user-from-session',
    );

    const expectedPaymentCall: Record<string, unknown> = {
      lines: expect.arrayContaining([
        expect.objectContaining({
          debitAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
          creditAccountId: CHART_OF_ACCOUNTS.CASH,
          amount: 300,
        }),
      ]),
      treasuryUpdates: [{ treasuryId: 'treasury-002', delta: -300 }],
      supplierUpdates: [{ supplierId: 'sup-001', delta: -300 }],
      userId: 'user-from-session',
    };
    expect(financial.postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining(expectedPaymentCall),
      'user-from-session',
    );
  });

  // ACC-1 (P0 — GF-IMP-W1): مصفوفة توجيه الحساب المقابل لكل (نوع سند × طرف).
  // الاتجاه ثابت: RECEIPT → Dr CASH / Cr مقابل، PAYMENT → Dr مقابل / Cr CASH.
  // السند بلا طرف مقابل → GENERAL_EXPENSE (مصروف السندات النثرية).
  describe('ACC-1 — توجيه الحساب المقابل في السندات', () => {
    const cases: Array<{
      label: string;
      type: VoucherType;
      counterpartyType?: 'CUSTOMER' | 'SUPPLIER' | 'WORKER';
      counterpartyId?: string;
      expectedDebit: string;
      expectedCredit: string;
    }> = [
      {
        label: 'RECEIPT×SUPPLIER → دائن ACCOUNTS_PAYABLE',
        type: VoucherType.RECEIPT,
        counterpartyType: 'SUPPLIER',
        counterpartyId: 'sup-001',
        expectedDebit: CHART_OF_ACCOUNTS.CASH,
        expectedCredit: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
      },
      {
        label: 'RECEIPT×CUSTOMER → دائن ACCOUNTS_RECEIVABLE',
        type: VoucherType.RECEIPT,
        counterpartyType: 'CUSTOMER',
        counterpartyId: 'cust-001',
        expectedDebit: CHART_OF_ACCOUNTS.CASH,
        expectedCredit: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
      },
      {
        label: 'RECEIPT×WORKER → دائن WORKER_ADVANCES (لا ACCOUNTS_RECEIVABLE)',
        type: VoucherType.RECEIPT,
        counterpartyType: 'WORKER',
        counterpartyId: 'worker-001',
        expectedDebit: CHART_OF_ACCOUNTS.CASH,
        expectedCredit: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
      },
      {
        label: 'RECEIPT بلا طرف مقابل → دائن GENERAL_EXPENSE',
        type: VoucherType.RECEIPT,
        expectedDebit: CHART_OF_ACCOUNTS.CASH,
        expectedCredit: CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
      },
      {
        label: 'PAYMENT×SUPPLIER → مدين ACCOUNTS_PAYABLE',
        type: VoucherType.PAYMENT,
        counterpartyType: 'SUPPLIER',
        counterpartyId: 'sup-001',
        expectedDebit: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
        expectedCredit: CHART_OF_ACCOUNTS.CASH,
      },
      {
        label: 'PAYMENT×WORKER → مدين WORKER_ADVANCES (لا ACCOUNTS_RECEIVABLE)',
        type: VoucherType.PAYMENT,
        counterpartyType: 'WORKER',
        counterpartyId: 'worker-001',
        expectedDebit: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
        expectedCredit: CHART_OF_ACCOUNTS.CASH,
      },
      {
        label: 'PAYMENT بلا طرف مقابل → مدين GENERAL_EXPENSE',
        type: VoucherType.PAYMENT,
        expectedDebit: CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
        expectedCredit: CHART_OF_ACCOUNTS.CASH,
      },
    ];

    beforeEach(() => {
      prisma.voucher.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'v-acc1', ...data }),
      );
      // P1 (audit-BE2) — مسار WORKER في السندات: العامل موجود دائمًا في
      // هذه المجموعة، والسلف غير المسوّاة تغطي سند القبض (150).
      prisma.worker.findUnique.mockResolvedValue({
        id: 'worker-001',
        name: 'عامل اختبار',
      });
      prisma.workerAdvance.findMany.mockResolvedValue([
        {
          id: 'adv-1',
          amount: new Prisma.Decimal('200'),
          settledAmount: new Prisma.Decimal('0'),
          date: new Date('2026-08-01T00:00:00Z'),
        },
      ]);
      prisma.workerAdvance.create.mockResolvedValue({ id: 'adv-new' });
      prisma.workerAdvance.update.mockResolvedValue({ id: 'adv-1' });
    });

    it.each(cases)(
      '%s',
      async ({
        type,
        counterpartyType,
        counterpartyId,
        expectedDebit,
        expectedCredit,
      }) => {
        await service.createVoucher(
          {
            type,
            amount: 150,
            description: `سند مصفوفة ACC-1 ${type}`,
            treasuryId: 'treasury-acc1',
            ...(counterpartyType ? { counterpartyType } : {}),
            ...(counterpartyId ? { counterpartyId } : {}),
          },
          'user-acc1',
        );

        expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
        const call = financial.postJournalEntryInTx.mock.calls[0] as [
          unknown,
          {
            lines: {
              debitAccountId: string;
              creditAccountId: string;
              amount: number;
            }[];
          },
          unknown,
        ];
        expect(call[1].lines).toHaveLength(1);
        expect(call[1].lines[0]).toMatchObject({
          debitAccountId: expectedDebit,
          creditAccountId: expectedCredit,
          amount: 150,
        });
      },
    );
    it('P1 (audit-BE2): سند صرف لعامل يُنشئ صف WorkerAdvance يُخصم من رواتبه', async () => {
      await service.createVoucher(
        {
          type: VoucherType.PAYMENT,
          amount: 150,
          description: 'سلفة عامل نقدية',
          treasuryId: 'treasury-acc1',
          counterpartyType: 'WORKER',
          counterpartyId: 'worker-001',
        },
        'user-acc1',
      );

      // السلفة تُنشأ داخل نفس معاملة السند — قبل الإصلاح كان القيد GL يمر
      // بلا أي صف سلف فلا تُخصم من كشوف رواتب العامل أبدًا.
      expect(prisma.workerAdvance.create).toHaveBeenCalledTimes(1);
      expect(prisma.workerAdvance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workerId: 'worker-001',
            amount: new Prisma.Decimal('150'),
          }) as Record<string, unknown>,
        }),
      );
      expect(prisma.workerAdvance.update).not.toHaveBeenCalled();
    });

    it('P1 (audit-BE2): سند قبض من عامل يسوّي السلف FIFO بمقدار المبلغ', async () => {
      await service.createVoucher(
        {
          type: VoucherType.RECEIPT,
          amount: 150,
          description: 'رد سلفة عامل',
          treasuryId: 'treasury-acc1',
          counterpartyType: 'WORKER',
          counterpartyId: 'worker-001',
        },
        'user-acc1',
      );

      expect(prisma.workerAdvance.create).not.toHaveBeenCalled();
      expect(prisma.workerAdvance.update).toHaveBeenCalledTimes(1);
      expect(prisma.workerAdvance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'adv-1' },
          data: { settledAmount: { increment: new Prisma.Decimal('150') } },
        }),
      );
    });

    it('P1 (audit-BE2): سند قبض من عامل يرفض مبلغًا يتجاوز السلف غير المسوّاة', async () => {
      await expect(
        service.createVoucher(
          {
            type: VoucherType.RECEIPT,
            amount: 500,
            description: 'رد سلفة يتجاوز المستحق',
            treasuryId: 'treasury-acc1',
            counterpartyType: 'WORKER',
            counterpartyId: 'worker-001',
          },
          'user-acc1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('P1 (audit-BE2): سند بنوع طرف بلا معرف يُرفض (كان يُقيّد على حساب التحكم بلا كيان)', async () => {
      await expect(
        service.createVoucher(
          {
            type: VoucherType.PAYMENT,
            amount: 100,
            description: 'سند بلا طرف محدد',
            treasuryId: 'treasury-acc1',
            counterpartyType: 'CUSTOMER',
          },
          'user-acc1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });
  });

  it('D10: كود السند بنمط VCH-YYYYMMDD-XXXXXXXX (لا Date.now)', async () => {
    prisma.voucher.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'v-11', ...data }),
    );

    const result = await service.createVoucher(
      {
        type: VoucherType.PAYMENT,
        amount: 100,
        description: 'سند نثري',
        treasuryId: 'treasury-001',
      },
      'user-x',
    );

    expect(result.code).toMatch(/^VCH-\d{8}-[0-9A-F]{8}$/);
  });

  describe('A9 — Reversal of journal entries', () => {
    it('delegates to FinancialPostingService.reverseJournalEntry with userId + description', async () => {
      financial = {
        ...financial,
        reverseJournalEntry: jest.fn().mockResolvedValue({
          entryId: 'je-rev-1',
          entryCode: 'JE-20260828-ABCD1234',
          reversedEntryId: 'je-orig-1',
          reversedEntryCode: 'JE-20260827-XXXX0000',
        }),
      };
      // re-instantiate service with new financial mock
      const fresh = new AccountingService(
        prisma as unknown as PrismaService,
        financial as unknown as FinancialPostingService,
      );

      await fresh.reverseJournalEntry(
        'je-orig-1',
        'user-reverser',
        'إلغاء قيد بيع بالخطأ',
      );

      expect(financial.reverseJournalEntry).toHaveBeenCalledWith(
        'je-orig-1',
        'user-reverser',
        'إلغاء قيد بيع بالخطأ',
        undefined,
      );
    });

    it('passes undefined description when not provided', async () => {
      financial = {
        ...financial,
        reverseJournalEntry: jest.fn().mockResolvedValue({
          entryId: 'je-rev-2',
        }),
      };
      const fresh = new AccountingService(
        prisma as unknown as PrismaService,
        financial as unknown as FinancialPostingService,
      );

      await fresh.reverseJournalEntry('je-orig-2', 'user-reverser');

      expect(financial.reverseJournalEntry).toHaveBeenCalledWith(
        'je-orig-2',
        'user-reverser',
        undefined,
        undefined,
      );
    });
  });

  it('ينشئ فترة مالية جديدة إذا لم تتداخل مع فترة قائمة', async () => {
    prisma.fiscalPeriod.findFirst.mockResolvedValue(null);
    prisma.fiscalPeriod.create.mockResolvedValue({
      id: 'period-1',
      name: '2026-08',
    });

    const result = await service.createFiscalPeriod(
      {
        name: '2026-08',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      },
      'user-1',
    );

    expect(result).toEqual({ id: 'period-1', name: '2026-08' });
    expect(prisma.fiscalPeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdById: 'user-1',
      }) as Record<string, unknown>,
    });
  });

  it('يمرر القيد متعدد البنود والفترة إلى محرك الترحيل', async () => {
    const postJournalEntry = jest.fn().mockResolvedValue({ entryId: 'je-1' });
    const fresh = new AccountingService(
      prisma as unknown as PrismaService,
      {
        ...financial,
        postJournalEntry,
      } as unknown as FinancialPostingService,
    );

    await fresh.createJournalEntry(
      {
        description: 'قيد اختبار',
        fiscalPeriodId: 'period-1',
        date: '2026-08-26T00:00:00.000Z',
        lines: [
          {
            debitAccountId: 'debit-1',
            creditAccountId: 'credit-1',
            amount: 100,
          },
        ],
      },
      'user-1',
    );

    expect(postJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        fiscalPeriodId: 'period-1',
        date: new Date('2026-08-26T00:00:00.000Z'),
      }),
      'user-1',
    );
  });

  // ACC-4 (P2 — GF-IMP-W3): فحص تداخل الفترات يجب أن يجري داخل $transaction
  // نفسها — الفحص خارجها (TOCTOU) كان يسمح لفترتين متداخلتين متزامنتين
  // باجتياز الفحص قبل أن يلتزم أي منهما.
  describe('ACC-4 — فحص التداخل داخل المعاملة (TOCTOU)', () => {
    it('يرفض 409 عند التداخل ولا ينشئ الفترة — والفحص يجري داخل $transaction', async () => {
      prisma.fiscalPeriod.findFirst.mockResolvedValue({
        id: 'period-existing',
      });
      prisma.fiscalPeriod.create.mockResolvedValue({ id: 'never' });

      await expect(
        service.createFiscalPeriod(
          { name: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30' },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.fiscalPeriod.create).not.toHaveBeenCalled();
      // الدليل على أن الفحص داخل المعاملة: $transaction استُدعي قبل الفحص.
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      const checkOrder =
        prisma.fiscalPeriod.findFirst.mock.invocationCallOrder[0];
      expect(checkOrder).toBeGreaterThan(txOrder);
    });

    it('فترة بلا تداخل تُنشأ بعد الفحص داخل المعاملة', async () => {
      prisma.fiscalPeriod.findFirst.mockResolvedValue(null);
      prisma.fiscalPeriod.create.mockResolvedValue({ id: 'period-ok' });

      const result = await service.createFiscalPeriod(
        { name: '2026-10', startDate: '2026-10-01', endDate: '2026-10-31' },
        'user-2',
      );

      expect(result).toEqual({ id: 'period-ok' });
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      const checkOrder =
        prisma.fiscalPeriod.findFirst.mock.invocationCallOrder[0];
      expect(checkOrder).toBeGreaterThan(txOrder);
    });
  });

  // ACC-6 (P2 — GF-IMP-W3): قائمة السندات بفلاتر اختيارية (نوع/خزينة/
  // طرف مقابل/نطاق تاريخ) — الفهارس القائمة تكفي الاستعلام المرشّح.
  describe('ACC-6 — فلاتر قائمة السندات', () => {
    it('يبني where من type وtreasuryId وcounterpartyId وfrom/to ويطبقه على findMany وcount', async () => {
      prisma.voucher.findMany.mockResolvedValue([]);
      prisma.voucher.count.mockResolvedValue(0);

      await service.getVouchers({
        page: 1,
        limit: 20,
        type: VoucherType.PAYMENT,
        treasuryId: 'treasury-7',
        counterpartyId: 'cust-9',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.000Z',
      });

      const expectedWhere = {
        type: VoucherType.PAYMENT,
        treasuryId: 'treasury-7',
        counterpartyId: 'cust-9',
        date: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-31T23:59:59.000Z'),
        },
      };
      expect(prisma.voucher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere, skip: 0, take: 20 }),
      );
      expect(prisma.voucher.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('بلا فلاتر: where فارغ والحفاظ على include القائم', async () => {
      prisma.voucher.findMany.mockResolvedValue([]);
      prisma.voucher.count.mockResolvedValue(0);

      await service.getVouchers();

      expect(prisma.voucher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          include: {
            createdBy: { select: { name: true } },
            journalEntry: { select: { code: true, id: true } },
            treasury: { select: { id: true, name: true } },
          },
        }),
      );
      expect(prisma.voucher.count).toHaveBeenCalledWith({ where: {} });
    });

    it('فلتر جزئي (type فقط) لا يجرّ باقي الشروط إلى where', async () => {
      prisma.voucher.findMany.mockResolvedValue([]);
      prisma.voucher.count.mockResolvedValue(0);

      await service.getVouchers({
        page: 2,
        limit: 10,
        type: VoucherType.RECEIPT,
      });

      expect(prisma.voucher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: VoucherType.RECEIPT },
          skip: 10,
          take: 10,
        }),
      );
    });
  });
});

// ACC-8 (P2 — GF-IMP-W3): سطح القراءة المحاسبي — قائمة القيود ببنودها،
// كشف حساب برصيد جارٍ، وميزان مراجعة متوازن — كلها قراءة من journal_lines.
describe('AccountingService — ACC-8 سطح القراءة المحاسبي', () => {
  let service: AccountingService;
  let prisma: AccountingPrismaMock;
  let financial: { postJournalEntryInTx: jest.Mock };

  beforeEach(() => {
    prisma = createAccountingPrismaMock();
    financial = { postJournalEntryInTx: jest.fn() };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    service = new AccountingService(
      prisma as unknown as PrismaService,
      financial as unknown as FinancialPostingService,
    );
  });

  describe('ACC-8 — قائمة القيود (GET /accounting/journal-entries)', () => {
    it('ترجع القيود ببنودها وترتيب أحدث أولًا مع الترقيم', async () => {
      const entries = [
        {
          id: 'je-1',
          code: 'JE-1',
          description: 'قيد بيع',
          lines: [
            {
              id: 'jl-1',
              amount: 100,
              debitAccountId: 'acc-cash',
              creditAccountId: 'acc-rev',
            },
          ],
        },
      ];
      prisma.journalEntry.findMany.mockResolvedValue(entries);
      prisma.journalEntry.count.mockResolvedValue(1);

      const result = await service.getJournalEntries({ page: 1, limit: 20 });

      expect(result.data).toEqual(entries);
      expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          include: {
            lines: true,
            createdBy: { select: { name: true } },
          },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: 0,
          take: 20,
        }),
      );
      expect(prisma.journalEntry.count).toHaveBeenCalledWith({ where: {} });
    });

    it('تطبق فلاتر from/to وisReversed وreference يحتوي نصًا', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([]);
      prisma.journalEntry.count.mockResolvedValue(0);

      await service.getJournalEntries({
        page: 1,
        limit: 20,
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.000Z',
        isReversed: false,
        reference: 'SO-1',
      });

      const expectedWhere = {
        date: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-31T23:59:59.000Z'),
        },
        isReversed: false,
        reference: { contains: 'SO-1' },
      };
      expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.journalEntry.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('فلتر isReversed=true وحده يعمل دون شروط تاريخ', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([]);
      prisma.journalEntry.count.mockResolvedValue(0);

      await service.getJournalEntries({ page: 1, limit: 20, isReversed: true });

      expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isReversed: true } }),
      );
    });
  });

  describe('ACC-8 — كشف الحساب (GET /accounting/accounts/:id/statement)', () => {
    const entryA = {
      id: 'je-a',
      code: 'JE-A',
      date: new Date('2026-08-10T00:00:00.000Z'),
      createdAt: new Date('2026-08-10T00:00:01.000Z'),
    };
    const entryB = {
      id: 'je-b',
      code: 'JE-B',
      date: new Date('2026-08-20T00:00:00.000Z'),
      createdAt: new Date('2026-08-20T00:00:01.000Z'),
    };

    function line(
      id: string,
      journalEntry: object,
      debitAccountId: string | null,
      creditAccountId: string | null,
      amount: number,
    ) {
      return {
        id,
        journalEntry,
        debitAccountId,
        creditAccountId,
        amount,
        description: 'بند',
      };
    }

    it('يرفض 404 لحساب غير موجود', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(
        service.getAccountStatement('ghost-account', { page: 1, limit: 20 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.journalLine.findMany).not.toHaveBeenCalled();
    });

    it('يحسب مدين/دائن/رصيدًا جاريًا تراكميًا مرتبًا بتاريخ القيد', async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: 'acc-cash',
        code: '1100',
        name: 'الصندوق',
      });
      prisma.journalLine.findMany.mockResolvedValue([
        line('jl-1', entryA, 'acc-cash', 'acc-rev', 100),
        line('jl-2', entryA, 'acc-ap', 'acc-cash', 40),
        line('jl-3', entryB, 'acc-cash', 'acc-rev', 60),
      ]);

      const result = await service.getAccountStatement('acc-cash', {
        page: 1,
        limit: 20,
      });

      // الرصيد الجاري: 100 → 60 → 120
      expect(result.data.map((r) => r.runningBalance)).toEqual([100, 60, 120]);
      expect(result.data.map((r) => r.debit)).toEqual([100, 0, 60]);
      expect(result.data.map((r) => r.credit)).toEqual([0, 40, 0]);
      expect(result.data[0]).toMatchObject({
        entryCode: 'JE-A',
        amount: 100,
      });
      expect(result.meta.total).toBe(3);
      // بلا فلتر from: الرصيد الافتتاحي صفر (الكشف من نقطة الصفر).
      expect(result.openingBalance).toBe(0);
      expect(prisma.journalLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { debitAccountId: 'acc-cash' },
              { creditAccountId: 'acc-cash' },
            ],
          },
          orderBy: [
            { journalEntry: { date: 'asc' } },
            { journalEntry: { createdAt: 'asc' } },
            { id: 'asc' },
          ],
        }),
      );
    });

    it('يعيد الرصيد الافتتاحي من حركتين قبل from ويطبق فلتر التاريخ على البنود', async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: 'acc-cash',
        code: '1100',
        name: 'الصندوق',
      });
      // رصيد ما قبل from: مدين 150 - دائن 50 = 100
      prisma.journalLine.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 150 } })
        .mockResolvedValueOnce({ _sum: { amount: 50 } });
      prisma.journalLine.findMany.mockResolvedValue([
        line('jl-3', entryB, 'acc-cash', 'acc-rev', 60),
      ]);

      const result = await service.getAccountStatement('acc-cash', {
        page: 1,
        limit: 20,
        from: '2026-08-15T00:00:00.000Z',
      });

      expect(result.openingBalance).toBe(100);
      // الرصيد الجاري يبدأ من الافتتاحي: 100 + 60 = 160
      expect(result.data[0].runningBalance).toBe(160);
      expect(prisma.journalLine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { debitAccountId: 'acc-cash' },
              { creditAccountId: 'acc-cash' },
            ],
            journalEntry: {
              date: { gte: new Date('2026-08-15T00:00:00.000Z') },
            },
          },
        }),
      );
    });

    it('يرقّم الصفحات على مجموعة البنود المرشحة ويحسب الرصيد على كاملها', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'acc-cash' });
      prisma.journalLine.findMany.mockResolvedValue([
        line('jl-1', entryA, 'acc-cash', 'acc-rev', 100),
        line('jl-2', entryA, 'acc-ap', 'acc-cash', 40),
        line('jl-3', entryB, 'acc-cash', 'acc-rev', 60),
      ]);

      // الصفحة 2 بحجم 2: أول بندين يُتخطيان (رصيد 60) والثالث رصيده 120
      const result = await service.getAccountStatement('acc-cash', {
        page: 2,
        limit: 2,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('jl-3');
      expect(result.data[0].runningBalance).toBe(120);
      expect(result.meta).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    });
  });

  describe('ACC-8 — ميزان المراجعة (GET /accounting/trial-balance)', () => {
    it('يجمع المدين والدائن لكل حساب نشط ويصحح balanced=true عند التوازن', async () => {
      prisma.journalLine.groupBy
        // تجميع المدين: cash 500، revenue 300 (مجموع 800)
        .mockResolvedValueOnce([
          { debitAccountId: 'acc-cash', _sum: { amount: 500 } },
          { debitAccountId: 'acc-rev', _sum: { amount: 300 } },
        ])
        // تجميع الدائن: revenue 800 (مجموع 800)
        .mockResolvedValueOnce([
          { creditAccountId: 'acc-rev', _sum: { amount: 800 } },
        ]);
      prisma.account.findMany.mockResolvedValue([
        { id: 'acc-cash', code: '1100', name: 'الصندوق', type: 'ASSET' },
        { id: 'acc-rev', code: '4100', name: 'المبيعات', type: 'REVENUE' },
      ]);

      const result = await service.getTrialBalance();

      expect(result.data).toEqual([
        {
          code: '1100',
          name: 'الصندوق',
          totalDebit: 500,
          totalCredit: 0,
          balance: 500,
        },
        {
          code: '4100',
          name: 'المبيعات',
          totalDebit: 300,
          totalCredit: 800,
          balance: -500,
        },
      ]);
      expect(result.balanced).toBe(true);
      expect(result.totalDebit).toBe(800);
      expect(result.totalCredit).toBe(800);
      expect(prisma.journalLine.groupBy).toHaveBeenCalledWith({
        by: ['debitAccountId'],
        _sum: { amount: true },
      });
      expect(prisma.journalLine.groupBy).toHaveBeenCalledWith({
        by: ['creditAccountId'],
        _sum: { amount: true },
      });
    });

    it('يصحح balanced=false عند اختلال التوازن (دفتر متلاعب به)', async () => {
      prisma.journalLine.groupBy
        .mockResolvedValueOnce([
          { debitAccountId: 'acc-cash', _sum: { amount: 500 } },
        ])
        .mockResolvedValueOnce([
          { creditAccountId: 'acc-rev', _sum: { amount: 499 } },
        ]);
      prisma.account.findMany.mockResolvedValue([
        { id: 'acc-cash', code: '1100', name: 'الصندوق', type: 'ASSET' },
        { id: 'acc-rev', code: '4100', name: 'المبيعات', type: 'REVENUE' },
      ]);

      const result = await service.getTrialBalance();

      expect(result.balanced).toBe(false);
      expect(result.totalDebit).toBe(500);
      expect(result.totalCredit).toBe(499);
    });

    it('لا يشمل الحسابات المجموعة/غير النشطة — أوراق فقط', async () => {
      prisma.journalLine.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      prisma.account.findMany.mockResolvedValue([]);

      await service.getTrialBalance();

      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, isGroup: false },
        }),
      );
    });
  });
});
