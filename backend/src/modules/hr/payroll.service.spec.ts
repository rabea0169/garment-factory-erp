/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PayrollStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { computeRequestHash } from '../../core/common/idempotency.util';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { HrService } from './hr.service';

describe('HrService — GF-0015 payroll', () => {
  let service: HrService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let financial: { postJournalEntryInTx: jest.Mock };
  const periodStart = new Date('2026-08-01T00:00:00.000Z');
  const periodEnd = new Date('2026-08-31T00:00:00.000Z');

  const payrollRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    workerId: 'worker-1',
    periodStart,
    periodEnd,
    grossAmount: new Prisma.Decimal('660.00'),
    advanceDeduct: new Prisma.Decimal('250.00'),
    absenceDeduct: new Prisma.Decimal('0.00'),
    netAmount: new Prisma.Decimal('410.00'),
    status: PayrollStatus.DRAFT,
    isPaid: false,
    paidAt: null,
    notes: null,
    createdById: 'actor-1',
    approvedById: null,
    approvedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = createPrismaMock();
    financial = { postJournalEntryInTx: jest.fn() };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.worker.findUnique.mockResolvedValue({ id: 'worker-1' });
    prisma.payroll.findFirst.mockResolvedValue(null);
    prisma.dailyProduction.aggregate.mockResolvedValue({
      _sum: { totalAmount: new Prisma.Decimal('660.00') },
    });
    prisma.workerAdvance.aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal('250.00') },
    });
    prisma.payroll.create.mockResolvedValue(payrollRow());
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });
    service = new HrService(
      prisma as unknown as PrismaService,
      financial as unknown as FinancialPostingService,
    );
  });

  it('يحسب gross/net من snapshots الخادم ولا يقبل مبلغًا من العميل', async () => {
    const result = await service.createPayroll(
      { workerId: 'worker-1', periodStart, periodEnd },
      'actor-1',
    );

    expect(result).toMatchObject({
      grossAmount: 660,
      advanceDeduct: 250,
      absenceDeduct: 0,
      netAmount: 410,
      status: PayrollStatus.DRAFT,
      createdById: 'actor-1',
    });
    expect(prisma.payroll.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        grossAmount: new Prisma.Decimal('660.00'),
        advanceDeduct: new Prisma.Decimal('250.00'),
        absenceDeduct: new Prisma.Decimal('0.00'),
        netAmount: new Prisma.Decimal('410.00'),
        createdById: 'actor-1',
      }) as Record<string, unknown>,
    });
  });

  it('لا يسمح بأن تتجاوز خصومات السلف gross', async () => {
    prisma.workerAdvance.aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal('900.00') },
    });
    prisma.payroll.create.mockResolvedValue(
      payrollRow({
        advanceDeduct: new Prisma.Decimal('660.00'),
        netAmount: new Prisma.Decimal('0.00'),
      }),
    );

    await service.createPayroll(
      { workerId: 'worker-1', periodStart, periodEnd },
      'actor-1',
    );

    expect(prisma.payroll.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        advanceDeduct: new Prisma.Decimal('660.00'),
        netAmount: new Prisma.Decimal('0.00'),
      }) as Record<string, unknown>,
    });
  });

  it('يرفض فترة تبدأ بعد نهايتها قبل أي استعلام أو كتابة', async () => {
    await expect(
      service.createPayroll(
        {
          workerId: 'worker-1',
          periodStart: periodEnd,
          periodEnd: periodStart,
        },
        'actor-1',
      ),
    ).rejects.toThrow('بداية فترة الراتب لا يمكن أن تتجاوز نهايتها');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('يرفض كشفًا مكررًا للعامل والفترة', async () => {
    prisma.payroll.findFirst.mockResolvedValue({ id: 'existing-payroll' });

    await expect(
      service.createPayroll(
        { workerId: 'worker-1', periodStart, periodEnd },
        'actor-1',
      ),
    ).rejects.toThrow(ConflictException);
    expect(prisma.payroll.create).not.toHaveBeenCalled();
  });

  it('يعيد replay للاستجابة دون أثر ثانٍ عند تكرار Idempotency-Key', async () => {
    const stored = { id: 'pay-1', netAmount: 410, status: PayrollStatus.DRAFT };
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'pay-key',
      scope: 'hr-payroll-create',
      requestHash: computeRequestHash({
        workerId: 'worker-1',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        notes: null,
        actorId: 'actor-1',
      }),
      response: stored,
    });

    const result = await service.createPayroll(
      { workerId: 'worker-1', periodStart, periodEnd },
      'actor-1',
      'pay-key',
    );

    expect(result).toEqual({ ...stored, replayed: true });
    expect(prisma.payroll.create).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it('يعتمد draft مرة واحدة ويحافظ على عدم الدفع داخل GF-0015', async () => {
    prisma.payroll.findUnique
      .mockResolvedValueOnce(payrollRow())
      .mockResolvedValueOnce(
        payrollRow({
          status: PayrollStatus.APPROVED,
          approvedById: 'manager-1',
          approvedAt: new Date('2026-08-31T12:00:00.000Z'),
        }),
      );
    prisma.payroll.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.approvePayroll('pay-1', 'manager-1');

    expect(result).toMatchObject({
      status: PayrollStatus.APPROVED,
      approvedById: 'manager-1',
      isPaid: false,
    });
    expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: PayrollStatus.DRAFT },
      data: expect.objectContaining({
        status: PayrollStatus.APPROVED,
        approvedById: 'manager-1',
      }) as Record<string, unknown>,
    });
  });

  it('يدفع كشفًا معتمدًا مرة واحدة ويرحل المبلغ من الخزينة', async () => {
    const paymentDate = new Date('2026-08-31T12:00:00.000Z');
    prisma.payroll.findUnique
      .mockResolvedValueOnce(
        payrollRow({
          status: PayrollStatus.APPROVED,
          approvedById: 'manager-1',
        }),
      )
      .mockResolvedValueOnce(
        payrollRow({
          // COMM-F04: after payment, status transitions to PAID.
          status: PayrollStatus.PAID,
          isPaid: true,
          paidAt: paymentDate,
          approvedById: 'manager-1',
        }),
      );
    prisma.treasury.findUnique.mockResolvedValue({
      id: 'treasury-1',
      isActive: true,
    });
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'pay-idem-1' });
    prisma.payroll.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.payPayroll(
      'pay-1',
      { treasuryId: 'treasury-1', paymentDate },
      'manager-1',
      'pay-key',
    );

    expect(result).toMatchObject({
      isPaid: true,
      status: PayrollStatus.PAID,
    });
    expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: PayrollStatus.APPROVED, isPaid: false },
      data: {
        status: PayrollStatus.PAID,
        isPaid: true,
        paidAt: paymentDate,
      },
    });
    expect(financial.postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        reference: 'PAYROLL:pay-1',
        lines: [
          expect.objectContaining({
            debitAccountId: CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
            creditAccountId: CHART_OF_ACCOUNTS.CASH,
            amount: 410,
          }),
        ],
        treasuryUpdates: [{ treasuryId: 'treasury-1', delta: -410 }],
      }),
      'manager-1',
    );
  });

  it('يرفض دفع كشف غير معتمد أو مدفوعًا مسبقًا', async () => {
    prisma.payroll.findUnique.mockResolvedValue(
      payrollRow({ status: PayrollStatus.DRAFT }),
    );
    await expect(
      service.payPayroll('pay-1', { treasuryId: 'treasury-1' }, 'manager-1'),
    ).rejects.toThrow(ConflictException);
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('يرفض اعتماد كشف معتمد أو كشف غير موجود', async () => {
    prisma.payroll.findUnique.mockResolvedValueOnce(
      payrollRow({ status: PayrollStatus.APPROVED }),
    );
    await expect(service.approvePayroll('pay-1', 'manager-1')).rejects.toThrow(
      ConflictException,
    );

    prisma.payroll.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.approvePayroll('missing', 'manager-1'),
    ).rejects.toThrow(NotFoundException);
  });

  // COMM-F03: approvePayroll يُرحّل قيد اعتماد الأجور (Dr Salaries Expense /
  // Cr Salaries Payable) لمبلغ gross عند الانتقال DRAFT → APPROVED. القيد ذري
  // داخل نفس tx ويستخدم postingKey ثابت لمنع الترحيل المزدوج.
  it('يرحّل قيد اعتماد (Dr SALARIES_EXPENSE / Cr SALARIES_PAYABLE) لمبلغ gross', async () => {
    prisma.payroll.findUnique
      .mockResolvedValueOnce(payrollRow())
      .mockResolvedValueOnce(
        payrollRow({
          status: PayrollStatus.APPROVED,
          approvedById: 'manager-1',
          approvedAt: new Date('2026-08-31T12:00:00.000Z'),
        }),
      );
    prisma.worker.findUnique.mockResolvedValue({
      id: 'worker-1',
      name: 'أحمد محمود',
    });
    prisma.payroll.updateMany.mockResolvedValue({ count: 1 });

    await service.approvePayroll('pay-1', 'manager-1');

    expect(financial.postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        postingKey: 'payroll-approval:pay-1',
        reference: 'PAYROLL:pay-1',
        isAuto: true,
        lines: [
          expect.objectContaining({
            debitAccountId: CHART_OF_ACCOUNTS.SALARIES_EXPENSE,
            creditAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
            amount: 660,
          }),
        ],
        metadata: expect.objectContaining({
          source: 'payroll.approval',
          payrollId: 'pay-1',
          workerId: 'worker-1',
        }),
      }),
      'manager-1',
    );
  });

  it('يتخطى ترحيل القيد عندما يكون gross === 0', async () => {
    const zeroRow = payrollRow({
      grossAmount: new Prisma.Decimal('0.00'),
      advanceDeduct: new Prisma.Decimal('0.00'),
      absenceDeduct: new Prisma.Decimal('0.00'),
      netAmount: new Prisma.Decimal('0.00'),
    });
    prisma.payroll.findUnique
      .mockResolvedValueOnce(zeroRow)
      .mockResolvedValueOnce(
        payrollRow({
          status: PayrollStatus.APPROVED,
          grossAmount: new Prisma.Decimal('0.00'),
          advanceDeduct: new Prisma.Decimal('0.00'),
          absenceDeduct: new Prisma.Decimal('0.00'),
          netAmount: new Prisma.Decimal('0.00'),
          approvedById: 'manager-1',
        }),
      );
    prisma.payroll.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.approvePayroll('pay-1', 'manager-1');

    expect(result).toMatchObject({
      status: PayrollStatus.APPROVED,
      grossAmount: 0,
    });
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('يستخدم postingKey ثابت payroll-approval:<payrollId>', async () => {
    prisma.payroll.findUnique
      .mockResolvedValueOnce(payrollRow({ id: 'pay-77' }))
      .mockResolvedValueOnce(
        payrollRow({
          id: 'pay-77',
          status: PayrollStatus.APPROVED,
          approvedById: 'manager-1',
        }),
      );
    prisma.payroll.updateMany.mockResolvedValue({ count: 1 });

    await service.approvePayroll('pay-77', 'manager-1');

    expect(financial.postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        postingKey: 'payroll-approval:pay-77',
        reference: 'PAYROLL:pay-77',
      }),
      'manager-1',
    );
  });

  it('يرجع الـ transaction كله عند فشل ترحيل القيد', async () => {
    prisma.payroll.findUnique
      .mockResolvedValueOnce(payrollRow())
      .mockResolvedValueOnce(
        payrollRow({
          status: PayrollStatus.APPROVED,
          approvedById: 'manager-1',
        }),
      );
    prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
    financial.postJournalEntryInTx.mockRejectedValueOnce(
      new ConflictException('posting key مستخدم مع محتوى مالي مختلف'),
    );

    await expect(service.approvePayroll('pay-1', 'manager-1')).rejects.toThrow(
      ConflictException,
    );
  });
});
