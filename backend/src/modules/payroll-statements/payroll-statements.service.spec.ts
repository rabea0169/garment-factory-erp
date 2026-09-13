import 'reflect-metadata';
import { PayrollStatus, PayrollStatementStatus, Prisma } from '@prisma/client';
import { PayrollStatementsService } from './payroll-statements.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import type { PrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * SELIM-ERP W1 — اختبارات خدمة كشوف الرواتب المجمدة.
 *
 * تركّز على قواعد التجميد والترحيل (نفس قواعد Selim ERP):
 * - التوليد يرفض عند خلو الفترة من كشوف معتمدة غير مدفوعة.
 * - اللقطة JSON تحمل الصفوف والمجاميع ويُربط كل كشف بالكشف المجمع.
 * - الترحيل: قيد مصروف رواتب/مستحقات/سلف + تعليم الكشوف مدفوعة.
 * - الحذف للمسودة فقط ويفك الربط.
 */

/** إدخال وسيط لقراءة بيانات إنشاء الكشف المجمع (بلا any مسرب — sales). */
interface PayrollStatementCreateCall {
  data: {
    code: string;
    status: PayrollStatementStatus;
    workerCount: number;
    lines: unknown;
    totals: unknown;
  };
}

/** مرشحات تجميع الكشوف (معتمدة/غير مدفوعة/غير مجمّعة/متقاطعة). */
interface PayrollFindManyCall {
  where: {
    status: PayrollStatus;
    isPaid: boolean;
    payrollStatementId: null;
    AND: Array<{
      periodStart?: { lte: Date };
      periodEnd?: { gte: Date };
    }>;
  };
}

/** مدخلات القيد المُرحَّل: بنود مدين/دائن بمبالغ رقمية. */
interface JournalPostingInput {
  lines: Array<{
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
  }>;
}

/** إدخال وسيط لقراءة بيانات ترحيل الكشف (update). */
interface PayrollStatementUpdateCall {
  data: {
    status: PayrollStatementStatus;
    journalEntryId: string;
    approvedById: string;
    approvedAt: Date;
  };
}

describe('PayrollStatementsService — كشوف الرواتب المجمدة (SELIM W1)', () => {
  let service: PayrollStatementsService;
  let prisma: PrismaMock;
  let nextNumber: jest.Mock;
  let postJournalEntryInTx: jest.Mock;
  let reverseJournalEntryInTx: jest.Mock;
  // tx يشترك مع prisma في نفس الـ mocks (المعاملة تمر على نفس الوكيل).
  const tx = {} as unknown as PrismaMock;

  /** كشف فردي معتمد غير مدفوع لعامل واحد (400 إجمالي / 50 خصم / 350 صافي). */
  const approvedPayroll = (id: string) => ({
    id,
    workerId: 'worker-1',
    periodStart: new Date('2026-09-01'),
    periodEnd: new Date('2026-09-30'),
    grossAmount: new Prisma.Decimal(400),
    advanceDeduct: new Prisma.Decimal(30),
    absenceDeduct: new Prisma.Decimal(20),
    netAmount: new Prisma.Decimal(350),
    status: PayrollStatus.APPROVED,
    isPaid: false,
    payrollStatementId: null,
    worker: { id: 'worker-1', name: 'عامل الخياطة', code: 'W-001' },
  });

  const statementRow = (status: PayrollStatementStatus) => ({
    id: 'psm-1',
    code: 'PSM-0001',
    periodFrom: new Date('2026-09-01'),
    periodTo: new Date('2026-09-30'),
    status,
    totals: {
      gross: 400,
      advanceDeductions: 30,
      absenceDeductions: 20,
      deductions: 50,
      net: 350,
      count: 1,
    },
    lines: [],
  });

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.$transaction.mockImplementation(
      (
        arg: ((client: PrismaMock) => Promise<unknown>) | unknown[],
      ): Promise<unknown> =>
        typeof arg === 'function' ? arg(tx) : Promise.all(arg),
    );
    prisma.payroll.findMany.mockResolvedValue([approvedPayroll('pr-1')]);
    prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
    prisma.payrollStatement.findUnique.mockResolvedValue(null);
    prisma.payrollStatement.findMany.mockResolvedValue([]);
    prisma.payrollStatement.count.mockResolvedValue(0);
    prisma.payrollStatement.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'psm-1',
        ...data,
      }),
    );
    prisma.payrollStatement.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: 'psm-1',
        ...data,
      }),
    );
    prisma.payrollStatement.delete.mockResolvedValue({ id: 'psm-1' });
    Object.assign(tx, prisma);
    nextNumber = jest.fn().mockResolvedValue('PSM-0001');
    const sequence = { nextNumber } as unknown as SequenceService;
    postJournalEntryInTx = jest
      .fn()
      .mockResolvedValue({ entryId: 'je-1', entryCode: 'JE-1' });
    reverseJournalEntryInTx = jest.fn().mockResolvedValue({ entryId: 'je-2' });
    const financial = {
      postJournalEntryInTx,
      reverseJournalEntryInTx,
    } as unknown as FinancialPostingService;
    service = new PayrollStatementsService(
      prisma as unknown as PrismaService,
      sequence,
      financial,
    );
  });

  it('يرفض التوليد عند خلو الفترة من كشوف معتمدة غير مدفوعة', async () => {
    prisma.payroll.findMany.mockResolvedValue([]);
    await expect(
      service.generate({ periodFrom: '2026-09-01', periodTo: '2026-09-30' }),
    ).rejects.toThrow('لا توجد كشوف رواتب معتمدة غير مدفوعة في الفترة');
  });

  it('يرفض التوليد عندما تسبق نهاية الفترة بدايتها', async () => {
    await expect(
      service.generate({ periodFrom: '2026-09-30', periodTo: '2026-09-01' }),
    ).rejects.toThrow('بداية الفترة يجب أن تسبق نهايتها');
  });

  it('يلقّط الصفوف والمجاميع ويربط الكشوف بالكشف المجمع داخل المعاملة', async () => {
    await service.generate({
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
    });
    expect(nextNumber).toHaveBeenCalledWith('PAYROLL_STATEMENT', tx);
    const createCall = (
      prisma.payrollStatement.create.mock.calls as unknown as Array<
        [PayrollStatementCreateCall]
      >
    )[0][0];
    expect(createCall.data.code).toBe('PSM-0001');
    expect(createCall.data.status).toBe(PayrollStatementStatus.DRAFT);
    expect(createCall.data.workerCount).toBe(1);
    // اللقطة: صف واحد بإجمالي 400 وخصومات 50 وصافي 350.
    const lines = createCall.data.lines as {
      gross: number;
      deductions: number;
      net: number;
      workerName: string;
    }[];
    expect(lines[0].gross).toBe(400);
    expect(lines[0].deductions).toBe(50);
    expect(lines[0].net).toBe(350);
    expect(lines[0].workerName).toBe('عامل الخياطة');
    const totals = createCall.data.totals as Record<string, number>;
    expect(totals.gross).toBe(400);
    expect(totals.net).toBe(350);
    expect(totals.deductions).toBe(50);
    // الربط داخل نفس المعاملة.
    expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pr-1'] } },
      data: { payrollStatementId: 'psm-1' },
    });
  });

  it('يجمع فقط الكشوف المعتمدة غير المدفوعة غير المجمّعة المتقاطعة مع الفترة', async () => {
    await service.generate({
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
    });
    const where = (
      prisma.payroll.findMany.mock.calls as unknown as Array<
        [PayrollFindManyCall]
      >
    )[0][0].where;
    expect(where.status).toBe(PayrollStatus.APPROVED);
    expect(where.isPaid).toBe(false);
    expect(where.payrollStatementId).toBeNull();
    expect(where.AND).toEqual([
      { periodStart: { lte: new Date('2026-09-30') } },
      { periodEnd: { gte: new Date('2026-09-01') } },
    ]);
  });

  it('يرفض الترحيل لكشف غير موجود أو مرحّل بالفعل', async () => {
    prisma.payrollStatement.findUnique.mockResolvedValue(null);
    await expect(service.post('missing', 'user-1')).rejects.toThrow(
      'الكشف المجمع غير موجود',
    );
    prisma.payrollStatement.findUnique.mockResolvedValue(
      statementRow(PayrollStatementStatus.POSTED),
    );
    await expect(service.post('psm-1', 'user-1')).rejects.toThrow(
      'مرحّل بالفعل',
    );
  });

  it('يرحّل بقيد (مصروف/مستحقات + مصروف/سلف) ويعلم الكشوف مدفوعة', async () => {
    prisma.payrollStatement.findUnique.mockResolvedValue(
      statementRow(PayrollStatementStatus.DRAFT),
    );
    await service.post('psm-1', 'user-2');
    const postInput = (
      postJournalEntryInTx.mock.calls as unknown as Array<
        [unknown, JournalPostingInput]
      >
    )[0][1];
    // بنية Selim: Dr SALARIES_EXPENSE (الإجمالي) / Cr SALARIES_PAYABLE
    // (الصافي) + Cr WORKER_ADVANCES (الخصومات).
    const lines = postInput.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].debitAccountId).toBe(CHART_OF_ACCOUNTS.SALARIES_EXPENSE);
    expect(lines[0].creditAccountId).toBe(CHART_OF_ACCOUNTS.SALARIES_PAYABLE);
    expect(lines[0].amount).toBe(350);
    expect(lines[1].debitAccountId).toBe(CHART_OF_ACCOUNTS.SALARIES_EXPENSE);
    expect(lines[1].creditAccountId).toBe(CHART_OF_ACCOUNTS.WORKER_ADVANCES);
    expect(lines[1].amount).toBe(50);
    // الترحيل = الدفع: الكشوف المرتبطة تصبح مدفوعة PAID.
    expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
      where: { payrollStatementId: 'psm-1', isPaid: false },
      data: expect.objectContaining({
        isPaid: true,
        status: PayrollStatus.PAID,
      }) as Record<string, unknown>,
    });
    const updateCall = (
      prisma.payrollStatement.update.mock.calls as unknown as Array<
        [PayrollStatementUpdateCall]
      >
    )[0][0];
    expect(updateCall.data.status).toBe(PayrollStatementStatus.POSTED);
    expect(updateCall.data.journalEntryId).toBe('je-1');
    expect(updateCall.data.approvedById).toBe('user-2');
    expect(updateCall.data.approvedAt).toBeInstanceOf(Date);
  });

  it('يرفض الترحيل عند تغير عدد الكشوف المرتبطة بالتزامن', async () => {
    prisma.payrollStatement.findUnique.mockResolvedValue(
      statementRow(PayrollStatementStatus.DRAFT),
    );
    prisma.payroll.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.post('psm-1', 'user-2')).rejects.toThrow(
      'عدد الكشوف المرتبطة تغير بالتزامن',
    );
  });

  it('يرفض حذف كشف مرحّل (له أثر مالي ودفع)', async () => {
    prisma.payrollStatement.findUnique.mockResolvedValue(
      statementRow(PayrollStatementStatus.POSTED),
    );
    await expect(service.remove('psm-1')).rejects.toThrow(
      'لا يمكن حذف كشف مجمع مرحّل',
    );
  });

  it('حذف المسودة يفك ربط الكشوف فتعود متاحة للتجميع', async () => {
    prisma.payrollStatement.findUnique.mockResolvedValue(
      statementRow(PayrollStatementStatus.DRAFT),
    );
    const result = await service.remove('psm-1');
    expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
      where: { payrollStatementId: 'psm-1' },
      data: { payrollStatementId: null },
    });
    expect(prisma.payrollStatement.delete).toHaveBeenCalledWith({
      where: { id: 'psm-1' },
    });
    expect(result.deleted).toBe(true);
  });
});
