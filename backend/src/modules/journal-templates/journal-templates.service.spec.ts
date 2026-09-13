import 'reflect-metadata';
import { JournalTemplatesService } from './journal-templates.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';

/**
 * SELIM-ERP W1 — اختبارات خدمة قوالب القيود المتكررة.
 *
 * تركّز على قواعد المجال (نفس قواعد Selim ERP):
 * - التوازن: Σالمدين = Σالدائن، وإلا رفض برسالة التوازن العربية.
 * - كل سطر مدين أو دائن — لا الاثنين ولا صفر.
 * - بندين على الأقل، والحسابات ورقة قائمة فعلًا.
 * - الترحيل: بنود مقترنة صحيحة تمر لـ postJournalEntry بمرجع
 *   JRT:{اسم القالب} ثم يُحدَّث lastUsedAt.
 */
describe('JournalTemplatesService — قواعد قوالب القيود (SELIM W1)', () => {
  let service: JournalTemplatesService;
  let prisma: {
    $transaction: jest.Mock;
    journalTemplate: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    account: { findMany: jest.Mock; findUnique: jest.Mock };
  };
  let financial: { postJournalEntry: jest.Mock };

  const cash = '10000000-0000-0000-0000-000000000011';
  const rentExpense = '50000000-0000-0000-0000-000000000011';
  const accountsPayable = '20000000-0000-0000-0000-000000000021';

  const balancedLines = [
    { accountId: rentExpense, debit: 600, credit: 0, description: 'إيجار' },
    { accountId: rentExpense, debit: 400, credit: 0 },
    { accountId: accountsPayable, debit: 0, credit: 1000 },
  ];

  beforeEach(() => {
    prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (arg: ((client: unknown) => unknown) | unknown[]) =>
            typeof arg === 'function' ? Promise.resolve(arg({})) : [[], 0],
        ),
      journalTemplate: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) =>
            Promise.resolve(args.data),
          ),
        update: jest
          .fn()
          .mockImplementation(
            (args: { where: { id: string }; data: Record<string, unknown> }) =>
              Promise.resolve({
                id: args.where.id,
                name: 'قيد إيجار المعرض الشهري',
                ...args.data,
              }),
          ),
        delete: jest.fn().mockResolvedValue({ id: 'jrt-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      account: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: rentExpense }, { id: accountsPayable }]),
        findUnique: jest.fn(),
      },
    };
    financial = {
      postJournalEntry: jest.fn().mockResolvedValue({
        entryId: 'je-1',
        entryCode: 'JE-0001',
        totalDebit: 1000,
        totalCredit: 1000,
        linesCount: 2,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      }),
    };
    service = new JournalTemplatesService(
      prisma as never,
      financial as unknown as FinancialPostingService,
    );
  });

  it('يرفض قالبًا غير متوازن — مجموع المدين لا يساوي الدائن', async () => {
    await expect(
      service.create({
        name: 'قالب غير متوازن',
        lines: [
          { accountId: rentExpense, debit: 1000, credit: 0 },
          { accountId: accountsPayable, debit: 0, credit: 900 },
        ],
      }),
    ).rejects.toThrow('القالب غير متوازن — مجموع المدين يجب أن يساوي الدائن');
  });

  it('يرفض سطرًا مدينًا ودائنًا معًا (الاتجاه الواحد لكل سطر)', async () => {
    await expect(
      service.create({
        name: 'سطر باتجاهين',
        lines: [
          { accountId: rentExpense, debit: 500, credit: 500 },
          { accountId: accountsPayable, debit: 0, credit: 500 },
        ],
      }),
    ).rejects.toThrow('كل سطر يجب أن يكون مدينًا أو دائنًا وليس الاثنين');
  });

  it('يرفض سطرًا بلا مدين ولا دائن (صفر في الاتجاهين)', async () => {
    await expect(
      service.create({
        name: 'سطر صفري',
        lines: [
          { accountId: rentExpense, debit: 0, credit: 0 },
          { accountId: accountsPayable, debit: 0, credit: 500 },
        ],
      }),
    ).rejects.toThrow('كل سطر يجب أن يكون مدينًا أو دائنًا وليس الاثنين');
  });

  it('يرفض قالبًا بأقل من بندين', async () => {
    await expect(
      service.create({
        name: 'بند واحد',
        lines: [{ accountId: rentExpense, debit: 100, credit: 0 }],
      }),
    ).rejects.toThrow('القالب يجب أن يحتوي على بندين على الأقل');
  });

  it('يرفض حسابًا غير موجود أو تجميعيًا في البنود', async () => {
    // حساب واحد فقط موجود من اثنين → الفحص بالعدد يكشف الناقص.
    prisma.account.findMany.mockResolvedValue([{ id: accountsPayable }]);
    await expect(
      service.create({
        name: 'قالب بحساب مفقود',
        lines: [
          { accountId: rentExpense, debit: 100, credit: 0 },
          { accountId: accountsPayable, debit: 0, credit: 100 },
        ],
      }),
    ).rejects.toThrow('حساب في بنود القالب غير موجود أو حساب تجميعي');
  });

  it('يرفض تعديلًا ببنود غير متوازنة حتى لو كان الأصل سليمًا', async () => {
    prisma.journalTemplate.findUnique.mockResolvedValue({ id: 'jrt-1' });
    await expect(
      service.update('jrt-1', {
        lines: [
          { accountId: rentExpense, debit: 100, credit: 0 },
          { accountId: accountsPayable, debit: 0, credit: 200 },
        ],
      }),
    ).rejects.toThrow('القالب غير متوازن');
  });

  it('الترحيل يقترن البنود ويمررها لـ postJournalEntry بمرجع القالب', async () => {
    prisma.journalTemplate.findUnique.mockResolvedValue({
      id: 'jrt-1',
      name: 'قيد إيجار المعرض الشهري',
      lines: balancedLines,
    });
    const result = await service.post(
      'jrt-1',
      { notes: 'إيجار سبتمبر' },
      'user-1',
    );

    // مدينان (600 + 400) يقترنان بالسطر الدائن الوحيد (1000).
    expect(financial.postJournalEntry).toHaveBeenCalledTimes(1);
    const postingCalls = financial.postJournalEntry.mock
      .calls as unknown as Array<
      [
        {
          description: string;
          reference: string;
          isAuto: boolean;
          lines: {
            debitAccountId: string;
            creditAccountId: string;
            amount: number;
          }[];
        },
        string,
      ]
    >;
    const [input, userId] = postingCalls[0] ?? [];
    expect(input.reference).toBe('JRT:قيد إيجار المعرض الشهري');
    expect(input.description).toBe('إيجار سبتمبر');
    expect(input.isAuto).toBe(true);
    expect(userId).toBe('user-1');
    expect(input.lines).toEqual([
      {
        debitAccountId: rentExpense,
        creditAccountId: accountsPayable,
        amount: 600,
        description: 'إيجار',
      },
      {
        debitAccountId: rentExpense,
        creditAccountId: accountsPayable,
        amount: 400,
        description: undefined,
      },
    ]);
    // lastUsedAt يُحدَّث بعد الترحيل.
    const updateCalls = prisma.journalTemplate.update.mock
      .calls as unknown as Array<
      [{ where: { id: string }; data: Record<string, unknown> }]
    >;
    const updateCall = updateCalls[0]?.[0];
    expect(updateCall?.where).toEqual({ id: 'jrt-1' });
    const anyDate = expect.any(Date) as unknown;
    expect(updateCall?.data).toMatchObject(
      expect.objectContaining({ lastUsedAt: anyDate }),
    );
    expect(result.entry.entryId).toBe('je-1');
    expect(result.template.name).toBe('قيد إيجار المعرض الشهري');
  });

  it('الترحيل بلا ملاحظات يستخدم وصف القالب الافتراضي', async () => {
    prisma.journalTemplate.findUnique.mockResolvedValue({
      id: 'jrt-2',
      name: 'رواتب الشهر',
      lines: [
        { accountId: rentExpense, debit: 100, credit: 0 },
        { accountId: cash, debit: 0, credit: 100 },
      ],
    });
    await service.post('jrt-2', {}, 'user-1');
    const postingCalls = financial.postJournalEntry.mock
      .calls as unknown as Array<[{ description: string }]>;
    const input = postingCalls[0]?.[0];
    expect(input?.description).toBe('قيد من القالب «رواتب الشهر»');
  });

  it('الترحيل يرفض قالبًا تقادم (حساب محذوف بعد الإنشاء)', async () => {
    prisma.journalTemplate.findUnique.mockResolvedValue({
      id: 'jrt-3',
      name: 'قالب قديم',
      lines: [
        { accountId: rentExpense, debit: 100, credit: 0 },
        { accountId: cash, debit: 0, credit: 100 },
      ],
    });
    prisma.account.findMany.mockResolvedValue([{ id: cash }]);
    await expect(service.post('jrt-3', {}, 'user-1')).rejects.toThrow(
      'حساب في بنود القالب غير موجود أو حساب تجميعي',
    );
    expect(financial.postJournalEntry).not.toHaveBeenCalled();
  });

  it('المعاينة تعرض أسماء الحسابات وأرصدتها الحالية', async () => {
    prisma.journalTemplate.findUnique.mockResolvedValue({
      id: 'jrt-1',
      name: 'قيد إيجار المعرض الشهري',
      description: null,
      isRecurring: true,
      recurrencePattern: 'monthly',
      lastUsedAt: null,
      lines: [
        { accountId: rentExpense, debit: 1000, credit: 0 },
        { accountId: accountsPayable, debit: 0, credit: 1000 },
      ],
    });
    prisma.account.findMany.mockResolvedValue([
      {
        id: rentExpense,
        code: '5000',
        name: 'المصروفات العمومية',
        type: 'EXPENSE',
        balance: '12500.50',
      },
      {
        id: accountsPayable,
        code: '2200',
        name: 'الموردون',
        type: 'LIABILITY',
        balance: '8000',
      },
    ]);
    const preview = await service.preview('jrt-1');
    expect(preview.lines).toHaveLength(2);
    expect(preview.lines[0]).toMatchObject({
      accountCode: '5000',
      accountName: 'المصروفات العمومية',
      accountBalance: 12500.5,
      debit: 1000,
      credit: 0,
    });
    expect(preview.totalDebit).toBe(1000);
    expect(preview.totalCredit).toBe(1000);
  });

  it('تعارض اسم القالب (P2002) يُترجم لرسالة عربية', async () => {
    prisma.journalTemplate.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      service.create({
        name: 'اسم موجود',
        lines: [
          { accountId: rentExpense, debit: 100, credit: 0 },
          { accountId: accountsPayable, debit: 0, credit: 100 },
        ],
      }),
    ).rejects.toThrow('اسم القالب مستخدم بالفعل');
  });

  it('الحذف يحذف القالب فعليًا (Restrict بلا أبناء) ويرفض المفقود', async () => {
    prisma.journalTemplate.findUnique.mockResolvedValue({ id: 'jrt-9' });
    const result = await service.remove('jrt-9');
    expect(result).toEqual({ deleted: true, id: 'jrt-9' });
    expect(prisma.journalTemplate.delete).toHaveBeenCalledWith({
      where: { id: 'jrt-9' },
    });

    prisma.journalTemplate.findUnique.mockResolvedValue(null);
    await expect(service.remove('jrt-404')).rejects.toThrow(
      'قالب القيد غير موجود',
    );
  });
});
