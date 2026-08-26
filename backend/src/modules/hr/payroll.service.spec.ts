/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, */
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
    prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });

    // COMM-F03/F04: mock the FinancialPostingService that HrService now
    // depends on. Default resolved value mirrors the real
    // JournalEntryResult shape so callers don't crash.
    financial = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({
        entryId: 'je-1',
        entryCode: 'JE-TEST-001',
        totalDebit: 660,
        totalCredit: 660,
        linesCount: 1,
        createdAt: new Date(),
      }),
    };
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

  // COMM-F03: approvePayroll must post a GL accrual entry
  // (Dr SALARIES_EXPENSE / Cr SALARIES_PAYABLE) for the gross amount. Without
  // this, the largest expense line in a garment factory never hits the GL —
  // the P&L overstates net income by the entire payroll and the balance
  // sheet misses the salaries payable obligation.
  describe('COMM-F03 — GL posting on approvePayroll', () => {
    beforeEach(() => {
      financial.postJournalEntryInTx.mockClear();
      prisma.payroll.findUnique
        .mockResolvedValueOnce(payrollRow())
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.APPROVED,
            approvedById: 'manager-1',
            approvedAt: new Date('2026-08-31T12:00:00.000Z'),
            // COMM-F03: include worker relation for the GL description.
            worker: { name: 'أحمد محمود' },
          }),
        );
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
    });

    it('posts Dr SALARIES_EXPENSE / Cr SALARIES_PAYABLE for the gross amount (net + deductions)', async () => {
      await service.approvePayroll('pay-1', 'manager-1');

      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);

      const [txArg, inputArg, userIdArg] =
        financial.postJournalEntryInTx.mock.calls[0];
      // Same tx client — atomic with the status transition.
      expect(txArg).toBe(prisma);
      expect(userIdArg).toBe('manager-1');

      // Idempotency: posting key is `payroll-approval-${payrollId}` so a
      // retry of the same approval replays the existing entry.
      expect(inputArg.postingKey).toBe('payroll-approval-pay-1');
      expect(inputArg.reference).toBe('PAYROLL-pay-1');
      expect(inputArg.isAuto).toBe(true);

      // Single line: Dr SALARIES_EXPENSE / Cr SALARIES_PAYABLE — amount = gross (660).
      expect(inputArg.lines).toHaveLength(1);
      const line = inputArg.lines[0];
      expect(line.debitAccountId).toBe(CHART_OF_ACCOUNTS.SALARIES_EXPENSE);
      expect(line.creditAccountId).toBe(CHART_OF_ACCOUNTS.SALARIES_PAYABLE);
      // gross = net(410) + advanceDeduct(250) + absenceDeduct(0) = 660.
      expect(line.amount).toBe(660);

      // Description references the worker name + the period.
      expect(inputArg.description).toContain('أحمد محمود');
      expect(inputArg.description).toContain('2026-08');

      expect(inputArg.metadata).toMatchObject({
        source: 'hr.payroll.approve',
        payrollId: 'pay-1',
        workerId: 'worker-1',
        grossAmount: 660,
      });
    });

    it('skips the GL posting when gross amount is zero (no payroll value to accrue)', async () => {
      // Reset the findUnique queue from beforeEach — we want the zero-gross
      // mocks to be the actual values consumed by approvePayroll's two
      // findUnique calls (initial + post-update).
      prisma.payroll.findUnique.mockReset();
      prisma.payroll.findUnique
        .mockResolvedValueOnce(
          payrollRow({
            grossAmount: new Prisma.Decimal('0.00'),
            advanceDeduct: new Prisma.Decimal('0.00'),
            netAmount: new Prisma.Decimal('0.00'),
          }),
        )
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.APPROVED,
            grossAmount: new Prisma.Decimal('0.00'),
            netAmount: new Prisma.Decimal('0.00'),
            advanceDeduct: new Prisma.Decimal('0.00'),
          }),
        );

      await service.approvePayroll('pay-1', 'manager-1');

      // Zero-gross payrolls have no GL impact — guard prevents a zero-amount
      // line which FinancialPostingService rejects (E4: amount > 0).
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });
  });

  // COMM-F04: payPayroll must mark an APPROVED payroll as PAID and post a
  // cash settlement GL entry. Without this, the payroll workflow is stuck
  // at APPROVED forever — no way to mark a salary as actually paid, no PAID
  // filter, no annual reconciliation of paid vs. outstanding liabilities.
  describe('COMM-F04 — payPayroll (state transition + GL posting)', () => {
    beforeEach(() => {
      financial.postJournalEntryInTx.mockClear();
      prisma.payroll.findUnique
        .mockResolvedValueOnce({
          ...payrollRow({
            status: PayrollStatus.APPROVED,
            approvedById: 'manager-1',
          }),
          worker: { name: 'أحمد محمود' } as never,
        })
        // 2nd call: after the updateMany, fetch the final PAID state.
        .mockResolvedValueOnce({
          ...payrollRow({
            status: 'PAID',
            isPaid: true,
            paidAt: new Date('2026-09-01T10:00:00.000Z'),
            approvedById: 'manager-1',
          }),
          worker: { name: 'أحمد محمود' } as never,
        });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
    });

    it('transitions APPROVED → PAID atomically with status guard', async () => {
      const result = (await service.payPayroll('pay-1', 'cashier-1')) as any;

      expect(result.status).toBe('PAID');
      expect(result.isPaid).toBe(true);
      expect(result.paidAt).toBeInstanceOf(Date);

      // updateMany must include the status guard so a concurrent pay or a
      // state change between the read and the write doesn't silently
      // overwrite a non-APPROVED payroll.
      expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-1', status: PayrollStatus.APPROVED },
        data: expect.objectContaining({
          status: 'PAID',
          isPaid: true,
          paidAt: expect.any(Date),
        }),
      });
    });

    it('posts Dr SALARIES_PAYABLE / Cr CASH for the net amount', async () => {
      await service.payPayroll('pay-1', 'cashier-1');

      // First GL call: main salary payment (Dr SALARIES_PAYABLE / Cr CASH).
      const firstCall = financial.postJournalEntryInTx.mock.calls[0];
      const [, mainInput, userIdArg] = firstCall;
      expect(userIdArg).toBe('cashier-1');
      expect(mainInput.postingKey).toBe('payroll-payment-pay-1');
      expect(mainInput.reference).toBe('PAYROLL-PAY-pay-1');
      expect(mainInput.lines).toHaveLength(1);
      expect(mainInput.lines[0].debitAccountId).toBe(
        CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
      );
      expect(mainInput.lines[0].creditAccountId).toBe(CHART_OF_ACCOUNTS.CASH);
      // net = 410 (gross 660 − advance 250 − absence 0).
      expect(mainInput.lines[0].amount).toBe(410);
    });

    it('posts advance clearing entry (Dr SALARIES_PAYABLE / Cr WORKER_ADVANCES) when advanceDeduct > 0', async () => {
      await service.payPayroll('pay-1', 'cashier-1');

      // Second GL call: advance clearing (Dr SALARIES_PAYABLE / Cr WORKER_ADVANCES).
      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(2);
      const secondCall = financial.postJournalEntryInTx.mock.calls[1];
      const [, advInput] = secondCall;
      expect(advInput.postingKey).toBe('payroll-advance-clearing-pay-1');
      expect(advInput.reference).toBe('PAYROLL-ADV-pay-1');
      expect(advInput.lines).toHaveLength(1);
      expect(advInput.lines[0].debitAccountId).toBe(
        CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
      );
      expect(advInput.lines[0].creditAccountId).toBe(
        CHART_OF_ACCOUNTS.WORKER_ADVANCES,
      );
      // advanceDeduct = 250.
      expect(advInput.lines[0].amount).toBe(250);
    });

    it('skips advance clearing when advanceDeduct is zero', async () => {
      // Reset the findUnique queue from beforeEach — we want the zero-advance
      // mocks to be the actual values consumed by payPayroll's two findUnique
      // calls (initial APPROVED fetch + post-update PAID fetch).
      prisma.payroll.findUnique.mockReset();
      prisma.payroll.findUnique
        .mockResolvedValueOnce({
          ...payrollRow({
            status: PayrollStatus.APPROVED,
            grossAmount: new Prisma.Decimal('500.00'),
            advanceDeduct: new Prisma.Decimal('0.00'),
            netAmount: new Prisma.Decimal('500.00'),
          }),
          worker: { name: 'عامل بدون سلف' } as never,
        })
        .mockResolvedValueOnce({
          ...payrollRow({
            status: 'PAID',
            isPaid: true,
            paidAt: new Date(),
            grossAmount: new Prisma.Decimal('500.00'),
            advanceDeduct: new Prisma.Decimal('0.00'),
            netAmount: new Prisma.Decimal('500.00'),
          }),
          worker: { name: 'عامل بدون سلف' } as never,
        });

      await service.payPayroll('pay-1', 'cashier-1');

      // Only the main payment entry — no clearing entry since advanceDeduct = 0.
      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const [, mainInput] = financial.postJournalEntryInTx.mock.calls[0];
      expect(mainInput.lines[0].amount).toBe(500);
    });

    it('rejects paying a DRAFT payroll (must be approved first)', async () => {
      prisma.payroll.findUnique.mockReset();
      prisma.payroll.findUnique.mockResolvedValueOnce(
        payrollRow({ status: PayrollStatus.DRAFT }),
      );

      await expect(service.payPayroll('pay-1', 'cashier-1')).rejects.toThrow(
        ConflictException,
      );
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
      expect(prisma.payroll.updateMany).not.toHaveBeenCalled();
    });

    it('rejects paying a payroll that is already PAID', async () => {
      prisma.payroll.findUnique.mockReset();
      prisma.payroll.findUnique.mockResolvedValueOnce({
        ...payrollRow({
          status: 'PAID',
          isPaid: true,
          paidAt: new Date(),
        }),
        worker: { name: 'أحمد محمود' } as never,
      });

      await expect(service.payPayroll('pay-1', 'cashier-1')).rejects.toThrow(
        ConflictException,
      );
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('rejects paying a non-existent payroll', async () => {
      prisma.payroll.findUnique.mockReset();
      prisma.payroll.findUnique.mockResolvedValueOnce(null);

      await expect(service.payPayroll('ghost', 'cashier-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rolls back when the status guard loses the race (count=0)', async () => {
      prisma.payroll.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.payPayroll('pay-1', 'cashier-1')).rejects.toThrow(
        ConflictException,
      );
      // No GL posting should happen once the state transition failed.
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('replays the prior response when the same Idempotency-Key is reused', async () => {
      const stored = {
        id: 'pay-1',
        status: 'PAID',
        isPaid: true,
        paidAt: '2026-09-01T10:00:00.000Z',
      };
      prisma.payroll.findUnique.mockReset();
      prisma.idempotencyKey.findUnique.mockResolvedValueOnce({
        key: 'pay-key',
        scope: 'hr-payroll-pay',
        requestHash: computeRequestHash({
          payrollId: 'pay-1',
          actorId: 'cashier-1',
        }),
        response: stored,
      });

      const result = (await service.payPayroll(
        'pay-1',
        'cashier-1',
        'pay-key',
      )) as any;

      expect(result).toEqual({ ...stored, replayed: true });
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
      expect(prisma.payroll.updateMany).not.toHaveBeenCalled();
    });
  });
});
