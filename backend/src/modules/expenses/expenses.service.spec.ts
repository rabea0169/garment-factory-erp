import 'reflect-metadata';
import { ExpensesService } from './expenses.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';

/**
 * SELIM-ERP W1 — اختبارات خدمة المصاريف وبنودها.
 *
 * تركّز على قواعد المجال (نفس قواعد Selim ERP):
 * - المصروف مع خزينة: خصم رصيد بحراسة كافية + قيد Dr GENERAL_EXPENSE /
 *   Cr CASH داخل معاملة واحدة + journalEntryId محفوظ.
 * - المصروف بلا خزينة: سجل بسيط بلا قيد مطلقًا.
 * - رصيد الخزينة غير الكافي → 400 «رصيد الخزينة غير كاف».
 * - لقطة اسم البند (categoryName) من مصدر الحقيقة.
 * - البنود: زرع افتراضي عند أول استخدام + اسم فريد + حذف Restrict.
 * - التعديل للمصروفات غير المقيدة فقط؛ الحذف يعكس ويعيد الرصيد.
 */
describe('ExpensesService — قواعد المصاريف (SELIM W1)', () => {
  let service: ExpensesService;
  const prisma = {
    $transaction: jest.fn(),
    expense: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    expenseCategory: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createMany: jest.fn(),
    },
    treasury: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const financial = {
    postJournalEntryInTx: jest.fn(),
    reverseJournalEntryInTx: jest.fn(),
  };
  const tx = {} as unknown as Record<string, unknown>;

  /** إدخال وسيط لقراءة بيانات إنشاء المصروف من الـ mock (بلا any مسرب). */
  const createDataOf = (): Record<string, unknown> =>
    (
      prisma.expense.create.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0]?.data;

  /** إدخال وسيط لقراءة بيانات القيد المُرحَّل (بلا any مسرب). */
  const journalInputOf = (
    call = 0,
  ): {
    lines: Array<{
      debitAccountId: string;
      creditAccountId: string;
      amount: number;
    }>;
    postingKey?: string;
  } =>
    (
      financial.postJournalEntryInTx.mock.calls as unknown as Array<
        [
          unknown,
          {
            lines: Array<{
              debitAccountId: string;
              creditAccountId: string;
              amount: number;
            }>;
            postingKey?: string;
          },
        ]
      >
    )[call]?.[1];

  const category = { id: 'cat-1', name: 'مرافق', notes: null };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (client: unknown) => unknown)(tx);
      }
      return [[], 0, { _count: 0, _sum: { amount: null } }];
    });
    prisma.expense.findUnique.mockResolvedValue(null);
    prisma.expense.findMany.mockResolvedValue([]);
    prisma.expense.count.mockResolvedValue(0);
    prisma.expense.create.mockResolvedValue({ id: 'exp-1' });
    prisma.expense.update.mockImplementation(
      (args: { data: Record<string, unknown> }) => ({
        id: 'exp-1',
        ...args.data,
      }),
    );
    prisma.expense.delete.mockResolvedValue({ id: 'exp-1' });
    prisma.expense.aggregate.mockResolvedValue({
      _count: 0,
      _sum: { amount: null },
    });
    prisma.expense.groupBy.mockResolvedValue([]);
    prisma.expenseCategory.findUnique.mockResolvedValue(category);
    prisma.expenseCategory.findFirst.mockResolvedValue(null);
    prisma.expenseCategory.findMany.mockResolvedValue([]);
    prisma.expenseCategory.count.mockResolvedValue(0);
    prisma.expenseCategory.create.mockResolvedValue({ id: 'cat-2' });
    prisma.expenseCategory.update.mockResolvedValue({ id: 'cat-1' });
    prisma.expenseCategory.delete.mockResolvedValue({ id: 'cat-1' });
    prisma.expenseCategory.createMany.mockResolvedValue({ count: 7 });
    prisma.treasury.findUnique.mockResolvedValue({
      id: 'tr-1',
      name: 'الخزينة الرئيسية',
      balance: '5000',
      isActive: true,
      deletedAt: null,
    });
    prisma.treasury.update.mockResolvedValue({ id: 'tr-1' });
    prisma.treasury.updateMany.mockResolvedValue({ count: 1 });
    financial.postJournalEntryInTx.mockResolvedValue({
      entryId: 'je-1',
      entryCode: 'JE-0001',
    });
    financial.reverseJournalEntryInTx.mockResolvedValue({
      reversalEntryId: 'je-2',
    });
    Object.assign(tx, prisma);
    service = new ExpensesService(
      prisma as never,
      financial as unknown as FinancialPostingService,
    );
  });

  it('المصروف مع خزينة: قيد Dr GENERAL_EXPENSE / Cr CASH + خصم رصيد شرطي + ربط القيد', async () => {
    await service.create(
      { categoryId: 'cat-1', amount: 1500, treasuryId: 'tr-1' },
      'user-1',
    );
    // الخصم شرطي ذري: balance >= amount.
    expect(prisma.treasury.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tr-1', balance: { gte: 1500 } },
        data: { balance: { decrement: 1500 } },
      }),
    );
    const input = journalInputOf();
    expect(input?.lines[0]?.debitAccountId).toBe(
      CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
    );
    expect(input?.lines[0]?.creditAccountId).toBe(CHART_OF_ACCOUNTS.CASH);
    expect(input?.lines[0]?.amount).toBe(1500);
    // القيد مربوط بالمصروف (journalEntryId) بعد الإنشاء.
    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exp-1' },
        data: { journalEntryId: 'je-1' },
      }),
    );
  });

  it('المصروف بلا خزينة: سجل بلا قيد مالي (نفس سلوك Selim)', async () => {
    await service.create({ categoryId: 'cat-1', amount: 200 }, 'user-1');
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    expect(prisma.treasury.updateMany).not.toHaveBeenCalled();
    expect(createDataOf()?.categoryName).toBe('مرافق');
    expect(createDataOf()?.treasuryId).toBeNull();
  });

  it('رصيد الخزينة غير الكافي → رفض بلا قيد', async () => {
    prisma.treasury.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.create(
        { categoryId: 'cat-1', amount: 9999, treasuryId: 'tr-1' },
        'user-1',
      ),
    ).rejects.toThrow('رصيد الخزينة غير كاف');
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('لقطة اسم البند من مصدر الحقيقة + رفض بند غير موجود', async () => {
    await service.create({ categoryId: 'cat-1', amount: 50 }, 'user-1');
    expect(createDataOf()?.categoryName).toBe('مرافق');

    prisma.expenseCategory.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ categoryId: 'cat-x', amount: 50 }, 'user-1'),
    ).rejects.toThrow('بند المصروف غير موجود');
  });

  it('خزينة غير موجودة أو غير نشطة → رفض', async () => {
    prisma.treasury.findUnique.mockResolvedValue(null);
    await expect(
      service.create(
        { categoryId: 'cat-1', amount: 10, treasuryId: 'tr-x' },
        'user-1',
      ),
    ).rejects.toThrow('الخزينة غير موجودة');

    prisma.treasury.findUnique.mockResolvedValue({
      id: 'tr-1',
      isActive: false,
      deletedAt: new Date(),
      balance: '5000',
      name: 'مغلقة',
    });
    await expect(
      service.create(
        { categoryId: 'cat-1', amount: 10, treasuryId: 'tr-1' },
        'user-1',
      ),
    ).rejects.toThrow('الخزينة غير نشطة');
  });

  it('زرع بنود Selim الافتراضية عند أول استخدام (جدول فارغ)', async () => {
    await service.listCategories();
    const seeded = (
      prisma.expenseCategory.createMany.mock.calls as unknown as Array<
        [{ data: Array<{ name: string }>; skipDuplicates?: boolean }]
      >
    )[0]?.[0];
    expect(seeded?.data.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['رواتب', 'إيجار', 'أخرى']),
    );
    expect(seeded?.skipDuplicates).toBe(true);
    // الجدول غير فارغ → لا زرع.
    prisma.expenseCategory.count.mockResolvedValue(5);
    await service.listCategories();
    expect(prisma.expenseCategory.createMany).toHaveBeenCalledTimes(1);
  });

  it('اسم البند فريد — الازدواج يُرفض', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1' });
    await expect(service.createCategory({ name: 'مرافق' })).rejects.toThrow(
      'اسم بند المصروف موجود بالفعل',
    );
  });

  it('حذف بند مستخدم في مصروفات ممنوع (Restrict)', async () => {
    prisma.expenseCategory.findUnique.mockResolvedValue({
      id: 'cat-1',
      name: 'مرافق',
      _count: { expenses: 3 },
    });
    await expect(service.removeCategory('cat-1')).rejects.toThrow(
      'لا يمكن حذف بند',
    );
    expect(prisma.expenseCategory.delete).not.toHaveBeenCalled();
  });

  it('تعديل مصروف مقيد ماليًا ممنوع — غير المقيد يُعدَّل', async () => {
    prisma.expense.findUnique.mockResolvedValue({
      id: 'exp-1',
      journalEntryId: 'je-1',
    });
    await expect(service.update('exp-1', { amount: 300 })).rejects.toThrow(
      'لا يمكن تعديل مصروف مقيد ماليًا',
    );

    prisma.expense.findUnique.mockResolvedValue({
      id: 'exp-1',
      journalEntryId: null,
      categoryId: 'cat-1',
    });
    await service.update('exp-1', { amount: 300 });
    const updateData = (
      prisma.expense.update.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0]?.data;
    expect(updateData).toHaveProperty('amount');
  });

  it('الحذف يعكس القيد ويعيد رصيد الخزينة داخل معاملة واحدة', async () => {
    prisma.expense.findUnique.mockResolvedValue({
      id: 'exp-1',
      categoryName: 'مرافق',
      amount: '1500',
      treasuryId: 'tr-1',
      journalEntryId: 'je-1',
    });
    const result = await service.remove('exp-1', 'user-1');
    expect(financial.reverseJournalEntryInTx).toHaveBeenCalledWith(
      tx,
      'je-1',
      'user-1',
      expect.stringContaining('عكس القيد'),
    );
    expect(prisma.treasury.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tr-1' },
        data: { balance: { increment: 1500 } },
      }),
    );
    expect(prisma.expense.delete).toHaveBeenCalledWith({
      where: { id: 'exp-1' },
    });
    expect(result).toEqual({ deleted: true });
  });

  it('الملخص يجمع المجاميع حسب البند', async () => {
    prisma.expense.aggregate.mockResolvedValue({
      _count: 4,
      _sum: { amount: '4000' },
    });
    prisma.expense.groupBy.mockResolvedValue([
      {
        categoryId: 'cat-1',
        categoryName: 'مرافق',
        _count: 3,
        _sum: { amount: '3000' },
      },
    ]);
    const summary = await service.getSummary({});
    expect(summary.totalCount).toBe(4);
    expect(summary.totalAmount).toBe(4000);
    expect(summary.byCategory[0]?.categoryName).toBe('مرافق');
    expect(summary.byCategory[0]?.totalAmount).toBe(3000);
  });
});
