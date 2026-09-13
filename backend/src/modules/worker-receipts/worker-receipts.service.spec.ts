import 'reflect-metadata';
import { WorkerReceiptsService } from './worker-receipts.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';

/**
 * SELIM-ERP W1 — اختبارات خدمة سندات قبض العمال.
 *
 * تركّز على القواعد المالية (نفس قواعد Selim ERP):
 * - العامل يجب أن يكون موجودًا ونشطًا.
 * - حرس رصيد الخزينة الشرطي: لا سحب فوق الرصيد.
 * - القيد: مدين النقدية / دائن سلف العمال داخل نفس المعاملة.
 * - الحذف: عكس القيد + إعادة رصيد الخزينة داخل معاملة واحدة.
 */
describe('WorkerReceiptsService — سندات قبض العمال (SELIM W1)', () => {
  let service: WorkerReceiptsService;
  let prisma: {
    $transaction: jest.Mock;
    worker: { findUnique: jest.Mock };
    treasury: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    workerReceipt: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };
  let sequence: { nextNumber: jest.Mock };
  let financial: {
    postJournalEntryInTx: jest.Mock;
    reverseJournalEntryInTx: jest.Mock;
  };
  const tx: Record<string, unknown> = {};

  const baseDto = {
    workerId: 'worker-1',
    amount: 250,
    notes: 'تسوية سلفة',
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn().mockImplementation(async (arg) => {
        if (typeof arg === 'function') return arg(tx);
        return Promise.all(arg);
      }),
      worker: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'worker-1',
          name: 'عامل القص',
          isActive: true,
        }),
      },
      treasury: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'tr-1', isActive: true, balance: 1000 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'tr-1' }),
      },
      workerReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'wrc-1', code: 'WRC-0001' }),
        delete: jest.fn().mockResolvedValue({ id: 'wrc-1' }),
      },
    };
    Object.assign(tx, prisma);
    sequence = { nextNumber: jest.fn().mockResolvedValue('WRC-0001') };
    financial = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({
        entryId: 'je-1',
        entryCode: 'JE-1',
        linesCount: 1,
      }),
      reverseJournalEntryInTx: jest.fn().mockResolvedValue({
        entryId: 'je-2',
        reversedEntryId: 'je-1',
      }),
    };
    service = new WorkerReceiptsService(
      prisma as never,
      sequence as unknown as SequenceService,
      financial as unknown as FinancialPostingService,
    );
  });

  it('يرفض السند لعامل غير موجود', async () => {
    prisma.worker.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto as never, 'user-1')).rejects.toThrow(
      'العامل غير موجود',
    );
  });

  it('يرفض السند لعامل غير نشط', async () => {
    prisma.worker.findUnique.mockResolvedValue({
      id: 'worker-1',
      name: 'عامل',
      isActive: false,
    });
    await expect(service.create(baseDto as never, 'user-1')).rejects.toThrow(
      'غير نشط',
    );
  });

  it('يرفض السند عند عدم كفاية رصيد الخزينة برسالة المتاح', async () => {
    prisma.treasury.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.create({ ...baseDto, treasuryId: 'tr-1' } as never, 'user-1'),
    ).rejects.toThrow('رصيد الخزينة لا يكفي — المتاح: 1000');
  });

  it('يخصم الخزينة بحرس شرطي (balance >= amount) داخل المعاملة', async () => {
    await service.create({ ...baseDto, treasuryId: 'tr-1' } as never, 'user-1');
    expect(prisma.treasury.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'tr-1',
        isActive: true,
        balance: { gte: 250 },
      },
      data: { balance: { decrement: 250 } },
    });
  });

  it('يقيّد مدين النقدية / دائن سلف العمال ويربط القيد بالسند', async () => {
    await service.create(baseDto as never, 'user-1');
    expect(financial.postJournalEntryInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            debitAccountId: CHART_OF_ACCOUNTS.CASH,
            creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
            amount: 250,
          }),
        ],
      }),
      'user-1',
    );
    const createCall = prisma.workerReceipt.create.mock.calls[0][0];
    expect(createCall.data.code).toBe('WRC-0001');
    expect(createCall.data.journalEntryId).toBe('je-1');
    expect(Number(createCall.data.amount)).toBe(250);
  });

  it('يبني مجاميع كل عامل في القائمة من نفس المرشحات', async () => {
    prisma.workerReceipt.count.mockResolvedValue(2);
    prisma.workerReceipt.groupBy.mockResolvedValue([
      { workerId: 'worker-1', _count: 2, _sum: { amount: 500 } },
    ]);
    const result = await service.findAll({
      workerId: 'worker-1',
      from: '2026-09-01',
      to: '2026-09-30',
    } as never);
    expect(result.workerTotals).toEqual([
      { workerId: 'worker-1', count: 2, total: 500 },
    ]);
    const where = prisma.workerReceipt.groupBy.mock.calls[0][0].where;
    expect(where.workerId).toBe('worker-1');
    expect(where.date).toEqual({
      gte: new Date('2026-09-01'),
      lte: new Date('2026-09-30'),
    });
  });

  it('الحذف يعكس القيد ويعيد رصيد الخزينة في نفس المعاملة', async () => {
    prisma.workerReceipt.findUnique.mockResolvedValue({
      id: 'wrc-1',
      code: 'WRC-0001',
      amount: 250,
      treasuryId: 'tr-1',
      journalEntryId: 'je-1',
    });
    const result = await service.remove('wrc-1', 'user-2');
    expect(financial.reverseJournalEntryInTx).toHaveBeenCalledWith(
      tx,
      'je-1',
      'user-2',
      'عكس سند قبض عامل WRC-0001',
    );
    expect(prisma.treasury.update).toHaveBeenCalledWith({
      where: { id: 'tr-1' },
      data: { balance: { increment: 250 } },
    });
    expect(prisma.workerReceipt.delete).toHaveBeenCalledWith({
      where: { id: 'wrc-1' },
    });
    expect(result.deleted).toBe(true);
  });

  it('الحذف لسند بلا قيد يمضي بلا عكس', async () => {
    prisma.workerReceipt.findUnique.mockResolvedValue({
      id: 'wrc-1',
      code: 'WRC-0001',
      amount: 250,
      treasuryId: null,
      journalEntryId: null,
    });
    await service.remove('wrc-1', 'user-2');
    expect(financial.reverseJournalEntryInTx).not.toHaveBeenCalled();
    expect(prisma.treasury.update).not.toHaveBeenCalled();
  });

  it('يرفض تفاصيل/حذف سند غير موجود', async () => {
    await expect(service.findOne('missing')).rejects.toThrow(
      'سند القبض غير موجود',
    );
    await expect(service.remove('missing', 'user-1')).rejects.toThrow(
      'سند القبض غير موجود',
    );
  });
});
