import 'reflect-metadata';
import { WorkerReceiptsService } from './worker-receipts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import type { PrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * SELIM-ERP W1 — اختبارات خدمة سندات قبض العمال.
 *
 * تركّز على القواعد المالية (نفس قواعد Selim ERP):
 * - العامل يجب أن يكون موجودًا ونشطًا.
 * - حرس رصيد الخزينة الشرطي: لا سحب فوق الرصيد.
 * - القيد: مدين النقدية / دائن سلف العمال داخل نفس المعاملة.
 * - الحذف: عكس القيد + إعادة رصيد الخزينة داخل معاملة واحدة.
 */

/** إدخال وسيط لقراءة بيانات إنشاء السند (بلا any مسرب — نمط sales spec). */
interface WorkerReceiptCreateCall {
  data: { code: string; journalEntryId: string; amount: number };
}

/** مرشحات مجاميع السندات لكل عامل (workerId + نطاق التاريخ). */
interface WorkerReceiptGroupByCall {
  where: {
    workerId: string;
    date: { gte: Date; lte: Date };
  };
}

/**
 * SELIM-W1: امتداد محلي للـ mock الموحد — خصم الخزينة الشرطي يحتاج
 * treasury.updateMany (نمط SalesPrismaMock: لا نغيّر شكل نماذج قائمة
 * في الـ helper المشترك حفاظًا على توافق بقية المواصفات).
 */
type WorkerReceiptsPrismaMock = PrismaMock & {
  treasury: PrismaMock['treasury'] & { updateMany: jest.Mock };
};

function createWorkerReceiptsPrismaMock(): WorkerReceiptsPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
    treasury: { ...base.treasury, updateMany: jest.fn() },
  };
}

describe('WorkerReceiptsService — سندات قبض العمال (SELIM W1)', () => {
  let service: WorkerReceiptsService;
  let prisma: WorkerReceiptsPrismaMock;
  let nextNumber: jest.Mock;
  let postJournalEntryInTx: jest.Mock;
  let reverseJournalEntryInTx: jest.Mock;
  // tx يشترك مع prisma في نفس الـ mocks (المعاملة تمر على نفس الوكيل).
  const tx = {} as unknown as WorkerReceiptsPrismaMock;

  const baseDto = {
    workerId: 'worker-1',
    amount: 250,
    notes: 'تسوية سلفة',
  };

  beforeEach(() => {
    prisma = createWorkerReceiptsPrismaMock();
    prisma.$transaction.mockImplementation(
      (
        arg:
          ((client: WorkerReceiptsPrismaMock) => Promise<unknown>) | unknown[],
      ): Promise<unknown> =>
        typeof arg === 'function' ? arg(tx) : Promise.all(arg),
    );
    prisma.worker.findUnique.mockResolvedValue({
      id: 'worker-1',
      name: 'عامل القص',
      isActive: true,
    });
    prisma.treasury.findUnique.mockResolvedValue({
      id: 'tr-1',
      isActive: true,
      balance: 1000,
    });
    prisma.treasury.updateMany.mockResolvedValue({ count: 1 });
    prisma.treasury.update.mockResolvedValue({ id: 'tr-1' });
    prisma.workerReceipt.findUnique.mockResolvedValue(null);
    prisma.workerReceipt.findMany.mockResolvedValue([]);
    prisma.workerReceipt.count.mockResolvedValue(0);
    prisma.workerReceipt.groupBy.mockResolvedValue([]);
    prisma.workerReceipt.create.mockResolvedValue({
      id: 'wrc-1',
      code: 'WRC-0001',
    });
    prisma.workerReceipt.delete.mockResolvedValue({ id: 'wrc-1' });
    Object.assign(tx, prisma);
    nextNumber = jest.fn().mockResolvedValue('WRC-0001');
    const sequence = { nextNumber } as unknown as SequenceService;
    postJournalEntryInTx = jest.fn().mockResolvedValue({
      entryId: 'je-1',
      entryCode: 'JE-1',
      linesCount: 1,
    });
    reverseJournalEntryInTx = jest.fn().mockResolvedValue({
      entryId: 'je-2',
      reversedEntryId: 'je-1',
    });
    const financial = {
      postJournalEntryInTx,
      reverseJournalEntryInTx,
    } as unknown as FinancialPostingService;
    service = new WorkerReceiptsService(
      prisma as unknown as PrismaService,
      sequence,
      financial,
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
      service.create({ ...baseDto, treasuryId: 'tr-1' }, 'user-1'),
    ).rejects.toThrow('رصيد الخزينة لا يكفي — المتاح: 1000');
  });

  it('يخصم الخزينة بحرس شرطي (balance >= amount) داخل المعاملة', async () => {
    await service.create({ ...baseDto, treasuryId: 'tr-1' }, 'user-1');
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
    await service.create(baseDto, 'user-1');
    expect(postJournalEntryInTx).toHaveBeenCalledWith(
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
    const createCall = (
      prisma.workerReceipt.create.mock.calls as unknown as Array<
        [WorkerReceiptCreateCall]
      >
    )[0][0];
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
    });
    expect(result.workerTotals).toEqual([
      { workerId: 'worker-1', count: 2, total: 500 },
    ]);
    const where = (
      prisma.workerReceipt.groupBy.mock.calls as unknown as Array<
        [WorkerReceiptGroupByCall]
      >
    )[0][0].where;
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
    expect(reverseJournalEntryInTx).toHaveBeenCalledWith(
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
    expect(reverseJournalEntryInTx).not.toHaveBeenCalled();
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
