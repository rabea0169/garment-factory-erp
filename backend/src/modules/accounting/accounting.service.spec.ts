import { AccountType, VoucherType } from '@prisma/client';
import { AccountingService } from './accounting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

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
});
