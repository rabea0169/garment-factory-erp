import 'reflect-metadata';
import { TreasuryTransactionType } from '@prisma/client';
import { TreasuryTransactionsService } from './treasury-transactions.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { CreateTreasuryTransactionDto } from './dto/create-treasury-transaction.dto';

/**
 * SELIM-ERP W1 — اختبارات خدمة حركات الخزينة.
 *
 * تركّز على قواعد المجال (نفس قواعد Selim ERP):
 * - الترقيم TRT-0001 داخل معاملة الإنشاء.
 * - الأرصدة تتغير بالاتجاه الصحيح داخل المعاملة (إيداع +/سحب −/تحويل
 *   مصدر− وهدف+) مع حراسة الرصيد الكافي للسحب والتحويل.
 * - القيود بالحسابات الصحيحة حسب الفئة (رأس مال/مبيعات/مشتريات/أخرى).
 * - التحويل: بلا قيد GL + يرفض العملات المختلفة والخزينة نفسها.
 * - الحذف: للحركات اليدوية فقط (بلا referenceId) ويعكس القيد والأرصدة.
 */
describe('TreasuryTransactionsService — قواعد حركات الخزينة (SELIM W1)', () => {
  let service: TreasuryTransactionsService;
  const prisma = {
    $transaction: jest.fn(),
    treasury: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    treasuryTransaction: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      groupBy: jest.fn(),
    },
  };
  const sequence = { nextNumber: jest.fn() };
  const financial = {
    postJournalEntryInTx: jest.fn(),
    reverseJournalEntryInTx: jest.fn(),
  };
  const tx = {} as unknown as Record<string, unknown>;

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

  /** إدخال وسيط لقراءة بيانات إنشاء الحركة من الـ mock (بلا any مسرب). */
  const createDataOf = (): Record<string, unknown> =>
    (
      prisma.treasuryTransaction.create.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0]?.data;

  const mainTreasury = {
    id: 'tr-1',
    name: 'الخزينة الرئيسية',
    type: 'CASH',
    balance: '5000',
    isActive: true,
    deletedAt: null,
    currencyId: null,
  };

  const baseDto: CreateTreasuryTransactionDto = {
    treasuryId: 'tr-1',
    type: 'DEPOSIT',
    amount: 1000,
    description: 'إيداع افتتاحي',
    category: 'رأس مال',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (client: unknown) => unknown)(tx);
      }
      return [[], 0];
    });
    prisma.treasury.findUnique.mockResolvedValue(mainTreasury);
    prisma.treasury.findMany.mockResolvedValue([mainTreasury]);
    prisma.treasury.update.mockResolvedValue({ id: 'tr-1' });
    prisma.treasury.updateMany.mockResolvedValue({ count: 1 });
    prisma.treasuryTransaction.findUnique.mockResolvedValue(null);
    prisma.treasuryTransaction.findMany.mockResolvedValue([]);
    prisma.treasuryTransaction.count.mockResolvedValue(0);
    prisma.treasuryTransaction.create.mockImplementation(
      (args: { data: Record<string, unknown> }) => ({
        id: 'trt-1',
        ...args.data,
      }),
    );
    prisma.treasuryTransaction.delete.mockResolvedValue({ id: 'trt-1' });
    prisma.treasuryTransaction.groupBy.mockResolvedValue([]);
    sequence.nextNumber.mockResolvedValue('TRT-0001');
    financial.postJournalEntryInTx.mockResolvedValue({
      entryId: 'je-1',
      entryCode: 'JE-0001',
    });
    financial.reverseJournalEntryInTx.mockResolvedValue({
      reversalEntryId: 'je-2',
    });
    Object.assign(tx, prisma);
    service = new TreasuryTransactionsService(
      prisma as never,
      sequence as unknown as SequenceService,
      financial as unknown as FinancialPostingService,
    );
  });

  it('الإيداع: رصيد + وقيد Dr CASH / Cr OWNERS_EQUITY لفئة رأس مال + ترقيم داخل المعاملة', async () => {
    await service.create(baseDto, 'user-1');
    expect(sequence.nextNumber).toHaveBeenCalledWith(
      'TREASURY_TRANSACTION',
      tx,
    );
    expect(prisma.treasury.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tr-1' },
        data: { balance: { increment: 1000 } },
      }),
    );
    const input = journalInputOf();
    expect(input?.lines[0]?.debitAccountId).toBe(CHART_OF_ACCOUNTS.CASH);
    expect(input?.lines[0]?.creditAccountId).toBe(
      CHART_OF_ACCOUNTS.OWNERS_EQUITY,
    );
    expect(input?.lines[0]?.amount).toBe(1000);
    // السجل يحمل journalEntryId القيد.
    expect(createDataOf()?.journalEntryId).toBe('je-1');
  });

  it('الإيداع بفئة مبيعات يقيد Cr ACCOUNTS_RECEIVABLE (تحصيل ذمم)', async () => {
    await service.create(
      { ...baseDto, category: 'مبيعات', description: 'تحصيل فاتورة 12' },
      'user-1',
    );
    const input = journalInputOf();
    expect(input?.lines[0]?.creditAccountId).toBe(
      CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
    );
  });

  it('السحب بفئة مشتريات يقيد Dr INVENTORY / Cr CASH', async () => {
    await service.create(
      {
        ...baseDto,
        type: 'WITHDRAWAL',
        category: 'مشتريات',
        description: 'شراء خامات',
      },
      'user-1',
    );
    const input = journalInputOf();
    expect(input?.lines[0]?.debitAccountId).toBe(CHART_OF_ACCOUNTS.INVENTORY);
    expect(input?.lines[0]?.creditAccountId).toBe(CHART_OF_ACCOUNTS.CASH);
    // السحب بتحديث شرطي ذري: balance >= amount.
    expect(prisma.treasury.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tr-1', balance: { gte: 1000 } },
        data: { balance: { decrement: 1000 } },
      }),
    );
  });

  it('السحب بفئة أخرى يقيد Dr GENERAL_EXPENSE / Cr CASH', async () => {
    await service.create(
      {
        ...baseDto,
        type: 'WITHDRAWAL',
        category: 'أخرى',
        description: 'نثريات',
      },
      'user-1',
    );
    const input = journalInputOf();
    expect(input?.lines[0]?.debitAccountId).toBe(
      CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
    );
  });

  it('السحب فوق الرصيد → 400 «رصيد الخزينة غير كاف» بلا قيد', async () => {
    prisma.treasury.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.create(
        {
          ...baseDto,
          type: 'WITHDRAWAL',
          amount: 99999,
          description: 'سحب كبير',
        },
        'user-1',
      ),
    ).rejects.toThrow('رصيد الخزينة غير كاف');
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    expect(prisma.treasuryTransaction.create).not.toHaveBeenCalled();
  });

  it('التحويل: يخصم المصدر ويضيف الهدف — بلا قيد GL', async () => {
    prisma.treasury.findUnique.mockImplementation(
      (args: { where: { id: string } }) =>
        args.where.id === 'tr-1'
          ? mainTreasury
          : {
              id: 'tr-2',
              name: 'خزينة الفرع',
              type: 'CASH',
              balance: '500',
              isActive: true,
              deletedAt: null,
              currencyId: null,
            },
    );
    await service.create(
      {
        ...baseDto,
        type: 'TRANSFER',
        toTreasuryId: 'tr-2',
        description: 'تحويل للفرع',
      },
      'user-1',
    );
    // المصدر خصم شرطي والهدف إضافة.
    expect(prisma.treasury.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tr-1', balance: { gte: 1000 } },
        data: { balance: { decrement: 1000 } },
      }),
    );
    expect(prisma.treasury.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tr-2' },
        data: { balance: { increment: 1000 } },
      }),
    );
    // التحويل الداخلي بلا قيد GL — حركة بين حسابات نقدية.
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    expect(createDataOf()?.journalEntryId).toBeNull();
  });

  it('التحويل بين خزائن بعملات مختلفة → رفض', async () => {
    prisma.treasury.findUnique.mockImplementation(
      (args: { where: { id: string } }) =>
        args.where.id === 'tr-1'
          ? mainTreasury
          : {
              id: 'tr-2',
              name: 'خزينة الدولار',
              type: 'BANK',
              balance: '100',
              isActive: true,
              deletedAt: null,
              currencyId: 'usd-currency-id',
            },
    );
    await expect(
      service.create(
        {
          ...baseDto,
          type: 'TRANSFER',
          toTreasuryId: 'tr-2',
          description: 'تحويل عملات',
        },
        'user-1',
      ),
    ).rejects.toThrow('لا يمكن التحويل بين خزائن بعملات مختلفة');
  });

  it('التحويل لنفس الخزينة أو بلا مستهدف → رفض', async () => {
    await expect(
      service.create(
        {
          ...baseDto,
          type: 'TRANSFER',
          toTreasuryId: 'tr-1',
          description: 'نفس الخزينة',
        },
        'user-1',
      ),
    ).rejects.toThrow('لا يمكن التحويل إلى نفس الخزينة');

    await expect(
      service.create(
        {
          ...baseDto,
          type: 'TRANSFER',
          description: 'بلا مستهدف',
        },
        'user-1',
      ),
    ).rejects.toThrow('التحويل يتطلب خزينة مستهدفة');
  });

  it('خزينة غير موجودة أو غير نشطة → رفض', async () => {
    prisma.treasury.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto, 'user-1')).rejects.toThrow(
      'الخزينة غير موجودة',
    );

    prisma.treasury.findUnique.mockResolvedValue({
      ...mainTreasury,
      isActive: false,
    });
    await expect(service.create(baseDto, 'user-1')).rejects.toThrow(
      'الخزينة غير نشطة',
    );
  });

  it('الحذف لحركة مرتبطة بمستند (referenceId) → رفض', async () => {
    prisma.treasuryTransaction.findUnique.mockResolvedValue({
      id: 'trt-1',
      referenceId: 'exp-9',
    });
    await expect(service.remove('trt-1', 'user-1')).rejects.toThrow(
      'مرتبطة بمستند',
    );
  });

  it('الحذف لحركة يدوية: يعكس القيد ويعيد الأرصدة باتجاه معاكس', async () => {
    prisma.treasuryTransaction.findUnique.mockResolvedValue({
      id: 'trt-1',
      code: 'TRT-0001',
      type: TreasuryTransactionType.WITHDRAWAL,
      treasuryId: 'tr-1',
      toTreasuryId: null,
      amount: '1000',
      journalEntryId: 'je-1',
      referenceId: null,
    });
    const result = await service.remove('trt-1', 'user-1');
    expect(financial.reverseJournalEntryInTx).toHaveBeenCalledWith(
      tx,
      'je-1',
      'user-1',
      expect.stringContaining('عكس القيد'),
    );
    // السحب الأصلي نقص الرصيد — الحذف يعيده.
    expect(prisma.treasury.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tr-1' },
        data: { balance: { increment: 1000 } },
      }),
    );
    expect(prisma.treasuryTransaction.delete).toHaveBeenCalledWith({
      where: { id: 'trt-1' },
    });
    expect(result).toEqual({ deleted: true });
  });

  it('الملخص: رصيد كل خزينة + مجاميع الأنواع (أصفار عند غياب الحركات)', async () => {
    const summary = await service.getSummary();
    expect(summary.treasuries[0]?.balance).toBe(5000);
    expect(summary.totalActiveBalance).toBe(5000);
    expect(summary.byType.DEPOSIT).toEqual({ count: 0, totalAmount: 0 });
    expect(summary.byType.TRANSFER).toEqual({ count: 0, totalAmount: 0 });
  });

  it('فلترة القائمة بالخزينة تشمل الحركات الواردة (تحويل مستهدف)', async () => {
    await service.findAll({ treasuryId: 'tr-2' });
    expect(prisma.treasuryTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ treasuryId: 'tr-2' }, { toTreasuryId: 'tr-2' }],
        },
      }),
    );
  });
});
