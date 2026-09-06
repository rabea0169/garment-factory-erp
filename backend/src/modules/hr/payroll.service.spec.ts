/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PayrollStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { computeRequestHash } from '../../core/common/idempotency.util';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { HrService } from './hr.service';

/**
 * HR-2 (GF-IMP-W2): مواصفات الرواتب تحتاج workerAdvance.findMany (صفوف
 * السلف لحساب المتبقي غير المسى) وworkerAdvance.update (توزيع FIFO عند
 * الدفع) — امتداد محلي للـ mock الموحد بنمط inventory.service.spec
 * (لا نعدّل الـ helper المشترك الذي يملكه كل الوكلاء).
 */
type HrPrismaMock = ReturnType<typeof createPrismaMock> & {
  workerAdvance: {
    create: jest.Mock;
    aggregate: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
};

function createHrPrismaMock(): HrPrismaMock {
  return {
    ...createPrismaMock(),
    workerAdvance: {
      create: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('HrService — GF-0015 payroll', () => {
  let service: HrService;
  let prisma: HrPrismaMock;
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
    prisma = createHrPrismaMock();
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
    // HR-2: صفوف السلف (لا مجموع أعمى) — المتبقي غير المسى هو أساس الخصم.
    prisma.workerAdvance.findMany.mockResolvedValue([
      {
        id: 'adv-1',
        amount: new Prisma.Decimal('250.00'),
        settledAmount: new Prisma.Decimal('0.00'),
      },
    ]);
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
    // HR-2: سلفتان بمتبقي 250 + 900 = 1150 > gross 660 → الخصم محدود بالgross.
    prisma.workerAdvance.findMany.mockResolvedValue([
      {
        id: 'adv-1',
        amount: new Prisma.Decimal('250.00'),
        settledAmount: new Prisma.Decimal('0.00'),
      },
      {
        id: 'adv-2',
        amount: new Prisma.Decimal('900.00'),
        settledAmount: new Prisma.Decimal('0.00'),
      },
    ]);
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

  // HR-2 (P1 — GF-IMP-W2): السلف لا تُخصم مرتين — الخصم يُحسب من المتبقي
  // غير المسى فقط (amount - settledAmount) والتوزيع الفعلي يجري FIFO عند
  // الدفع داخل معاملة الدفع نفسها.
  describe('HR-2 — ذاكرة تسوية السلف (settledAmount)', () => {
    it('سلفة 200 دُفعت خصمها كاملًا (settledAmount == amount) → كشف لاحق بنفس الفترة لا يعيد خصمها', async () => {
      prisma.workerAdvance.findMany.mockResolvedValue([
        {
          id: 'adv-1',
          amount: new Prisma.Decimal('200.00'),
          settledAmount: new Prisma.Decimal('200.00'), // مسوية بالكامل
        },
      ]);
      prisma.payroll.create.mockResolvedValue(
        payrollRow({
          grossAmount: new Prisma.Decimal('660.00'),
          advanceDeduct: new Prisma.Decimal('0.00'),
          netAmount: new Prisma.Decimal('660.00'),
        }),
      );

      const result = await service.createPayroll(
        { workerId: 'worker-1', periodStart, periodEnd },
        'actor-1',
      );

      expect(result).toMatchObject({ advanceDeduct: 0, netAmount: 660 });
      expect(prisma.payroll.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          advanceDeduct: new Prisma.Decimal('0.00'),
          netAmount: new Prisma.Decimal('660.00'),
        }) as Record<string, unknown>,
      });
    });

    it('سلفة 500 خُصم منها 200 سابقًا → الكشف التالي يخصم 300 فقط (المتبقي غير المسى)', async () => {
      prisma.workerAdvance.findMany.mockResolvedValue([
        {
          id: 'adv-1',
          amount: new Prisma.Decimal('500.00'),
          settledAmount: new Prisma.Decimal('200.00'),
        },
      ]);
      prisma.payroll.create.mockResolvedValue(
        payrollRow({
          advanceDeduct: new Prisma.Decimal('300.00'),
          netAmount: new Prisma.Decimal('360.00'),
        }),
      );

      const result = await service.createPayroll(
        { workerId: 'worker-1', periodStart, periodEnd },
        'actor-1',
      );

      expect(result).toMatchObject({ advanceDeduct: 300, netAmount: 360 });
      expect(prisma.payroll.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          advanceDeduct: new Prisma.Decimal('300.00'),
          netAmount: new Prisma.Decimal('360.00'),
        }) as Record<string, unknown>,
      });
    });

    it('يجلب صفوف السلف بالترتيب الزمني (تجهيز FIFO) و بنطاق الفترة الحصري', async () => {
      await service.createPayroll(
        { workerId: 'worker-1', periodStart, periodEnd },
        'actor-1',
      );

      expect(prisma.workerAdvance.findMany).toHaveBeenCalledWith({
        where: {
          workerId: 'worker-1',
          date: { gte: periodStart, lt: new Date('2026-09-01T00:00:00.000Z') },
        },
        select: { id: true, amount: true, settledAmount: true },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      });
    });

    it('التوزيع FIFO داخل معاملة الدفع يضبط settledAmount (سلفة 200 كاملة + 100 من التالية)', async () => {
      const paymentDate = new Date('2026-08-31T12:00:00.000Z');
      prisma.payroll.findUnique
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.APPROVED,
            approvedById: 'approver-1',
            grossAmount: new Prisma.Decimal('660.00'),
            advanceDeduct: new Prisma.Decimal('300.00'),
            netAmount: new Prisma.Decimal('360.00'),
          }),
        )
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.PAID,
            isPaid: true,
            paidAt: paymentDate,
            approvedById: 'approver-1',
            grossAmount: new Prisma.Decimal('660.00'),
            advanceDeduct: new Prisma.Decimal('300.00'),
            netAmount: new Prisma.Decimal('360.00'),
          }),
        );
      prisma.treasury.findUnique.mockResolvedValue({
        id: 'treasury-1',
        isActive: true,
      });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
      // سلف الفترة بالترتيب FIFO: الأولى 200 كاملة ثم 100 من الثانية (400).
      prisma.workerAdvance.findMany.mockResolvedValue([
        {
          id: 'adv-1',
          amount: new Prisma.Decimal('200.00'),
          settledAmount: new Prisma.Decimal('0.00'),
        },
        {
          id: 'adv-2',
          amount: new Prisma.Decimal('400.00'),
          settledAmount: new Prisma.Decimal('0.00'),
        },
      ]);

      await service.payPayroll(
        'pay-1',
        { treasuryId: 'treasury-1', paymentDate },
        'manager-1',
      );

      const updateCalls = prisma.workerAdvance.update.mock.calls as unknown as [
        [
          {
            where: { id: string };
            data: { settledAmount: { increment: Prisma.Decimal } };
          },
        ],
      ];
      expect(
        updateCalls.map(
          ([call]) =>
            `${call.where.id}:${call.data.settledAmount.increment.toString()}`,
        ),
      ).toEqual(['adv-1:200', 'adv-2:100']);
    });

    it('سلفة مسوية بالكامل تُتخطى في التوزيع FIFO ولا تُخصم مرة أخرى', async () => {
      prisma.payroll.findUnique
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.APPROVED,
            approvedById: 'approver-1',
            advanceDeduct: new Prisma.Decimal('300.00'),
            netAmount: new Prisma.Decimal('360.00'),
          }),
        )
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.PAID,
            isPaid: true,
            approvedById: 'approver-1',
            advanceDeduct: new Prisma.Decimal('300.00'),
            netAmount: new Prisma.Decimal('360.00'),
          }),
        );
      prisma.treasury.findUnique.mockResolvedValue({
        id: 'treasury-1',
        isActive: true,
      });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
      prisma.workerAdvance.findMany.mockResolvedValue([
        {
          id: 'adv-1',
          amount: new Prisma.Decimal('200.00'),
          settledAmount: new Prisma.Decimal('200.00'), // مسوية بالكامل — تُتخطى
        },
        {
          id: 'adv-2',
          amount: new Prisma.Decimal('300.00'),
          settledAmount: new Prisma.Decimal('0.00'),
        },
      ]);

      await service.payPayroll(
        'pay-1',
        { treasuryId: 'treasury-1' },
        'manager-1',
      );

      const updateCalls = prisma.workerAdvance.update.mock.calls as unknown as [
        [
          {
            where: { id: string };
            data: { settledAmount: { increment: Prisma.Decimal } };
          },
        ],
      ];
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][0].where.id).toBe('adv-2');
      expect(updateCalls[0][0].data.settledAmount.increment.toString()).toBe(
        '300',
      );
    });

    it('كشف بلا خصومات سلف لا يستدعي توزيع FIFO إطلاقًا', async () => {
      prisma.payroll.findUnique
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.APPROVED,
            approvedById: 'approver-1',
            advanceDeduct: new Prisma.Decimal('0.00'),
            netAmount: new Prisma.Decimal('660.00'),
          }),
        )
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.PAID,
            isPaid: true,
            approvedById: 'approver-1',
            advanceDeduct: new Prisma.Decimal('0.00'),
            netAmount: new Prisma.Decimal('660.00'),
          }),
        );
      prisma.treasury.findUnique.mockResolvedValue({
        id: 'treasury-1',
        isActive: true,
      });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });

      await service.payPayroll(
        'pay-1',
        { treasuryId: 'treasury-1' },
        'manager-1',
      );

      expect(prisma.workerAdvance.findMany).not.toHaveBeenCalled();
      expect(prisma.workerAdvance.update).not.toHaveBeenCalled();
    });
  });

  // HR-3 (P1 — GF-IMP-W2): منع تداخل فترات الرواتب — أي تقاطع نطاقات
  // لنفس العامل يُرفض (الفحص القديم كان مطابقة تامة فمرر المتداخل جزئيًا).
  describe('HR-3 — منع تداخل فترات الرواتب', () => {
    it('فترة متداخلة جزئيًا مع كشف قائم → 409 ولا يُنشأ كشف', async () => {
      prisma.payroll.findFirst.mockResolvedValue({ id: 'existing-payroll' });
      // فترة جديدة 15 أغسطس - 15 سبتمبر تتقاطع مع القائمة (1-31 أغسطس).
      const overlappingStart = new Date('2026-08-15T00:00:00.000Z');
      const overlappingEnd = new Date('2026-09-15T00:00:00.000Z');

      await expect(
        service.createPayroll(
          {
            workerId: 'worker-1',
            periodStart: overlappingStart,
            periodEnd: overlappingEnd,
          },
          'actor-1',
        ),
      ).rejects.toThrow(
        'تتداخل فترة كشف الراتب مع كشف قائم لنفس العامل — لا يُسمح بتداخل فترات الرواتب',
      );
      expect(prisma.payroll.create).not.toHaveBeenCalled();
      expect(prisma.workerAdvance.findMany).not.toHaveBeenCalled();
    });

    it('فترة سابقة منتهية (لا تقاطع) → تنجح', async () => {
      prisma.payroll.findFirst.mockResolvedValue(null);
      const julyStart = new Date('2026-07-01T00:00:00.000Z');
      const julyEnd = new Date('2026-07-31T00:00:00.000Z');

      const result = await service.createPayroll(
        { workerId: 'worker-1', periodStart: julyStart, periodEnd: julyEnd },
        'actor-1',
      );

      expect(result).toMatchObject({ status: PayrollStatus.DRAFT });
      expect(prisma.payroll.create).toHaveBeenCalledTimes(1);
      // فحص التقاطع النطاقي: يبدأ قبل/عند نهاية المدخل وينتهي بعد/عند بدايته.
      expect(prisma.payroll.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workerId: 'worker-1',
            periodStart: { lte: julyEnd },
            periodEnd: { gte: julyStart },
          },
          select: { id: true },
        }),
      );
    });

    it('فترة متطابقة لعامل آخر تنجح — الفحص مقيد بنفس العامل', async () => {
      prisma.payroll.findFirst.mockResolvedValue(null);

      const result = await service.createPayroll(
        { workerId: 'worker-1', periodStart, periodEnd },
        'actor-1',
      );

      expect(result).toMatchObject({ status: PayrollStatus.DRAFT });
      // نفس نطاق الفترة لعامل آخر لا يحجب — لأن where.workerId يحصر الفحص.
      const overlapCalls = prisma.payroll.findFirst.mock.calls as unknown as [
        [{ where: { workerId: string; periodStart: Date; periodEnd: Date } }],
      ];
      expect(overlapCalls[0][0].where.workerId).toBe('worker-1');
    });
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
          approvedById: 'approver-1',
          approvedAt: new Date('2026-08-31T12:00:00.000Z'),
        }),
      );
    prisma.payroll.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.approvePayroll('pay-1', 'manager-1');

    expect(result).toMatchObject({
      status: PayrollStatus.APPROVED,
      approvedById: 'approver-1',
      isPaid: false,
    });
    expect(prisma.payroll.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: PayrollStatus.DRAFT },
      data: expect.objectContaining({
        status: PayrollStatus.APPROVED,
        // المعتمد الفعلي هو الممثّل (actorId من الاستدعاء) — السطر
        // المرجعي أعلاه (approver-1) قيمة الصف بعد القراءة فقط.
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
          approvedById: 'approver-1',
        }),
      )
      .mockResolvedValueOnce(
        payrollRow({
          // COMM-F04: after payment, status transitions to PAID.
          status: PayrollStatus.PAID,
          isPaid: true,
          paidAt: paymentDate,
          approvedById: 'approver-1',
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
    // HR-1 (P0 — GF-IMP-W1): قيد الدفع يصفّي SALARIES_PAYABLE بالإجمالي
    // (صافٍ 410 + خصومات 250 = إجمالي 660) بدل تسجيل المصروف مرة ثانية:
    //   Dr SALARIES_PAYABLE / Cr CASH بالصافّي
    //   Dr SALARIES_PAYABLE / Cr WORKER_ADVANCES بالخصومات
    expect(financial.postJournalEntryInTx).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        reference: 'PAYROLL:pay-1',
        postingKey: 'hr-payroll-pay:pay-1',
        lines: [
          expect.objectContaining({
            debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
            creditAccountId: CHART_OF_ACCOUNTS.CASH,
            amount: 410,
          }),
          expect.objectContaining({
            debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
            creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
            amount: 250,
          }),
        ],
        treasuryUpdates: [{ treasuryId: 'treasury-1', delta: -410 }],
      }),
      'manager-1',
    );
  });

  // HR-1 (P0 — GF-IMP-W1): بوابة سلامة قيد الدفع — تصفية SALARIES_PAYABLE
  // بالإجمالي، عدم لمس GENERAL_EXPENSE، وتقييد WORKER_ADVANCES بالخصومات.
  describe('HR-1 — قيد دفع الرواتب (تصفية رواتب مستحقة)', () => {
    // HR-5 (GF-IMP-W3): المعتمد 'approver-1' ≠ الدافع 'manager-1' — فصل
    // الواجبات على الدفع (نفس نمط SoD القائم في الاعتماد).
    const setupApprovedPayroll = (overrides: Record<string, unknown> = {}) => {
      prisma.payroll.findUnique
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.APPROVED,
            approvedById: 'approver-1',
            ...overrides,
          }),
        )
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.PAID,
            isPaid: true,
            approvedById: 'approver-1',
            ...overrides,
          }),
        );
      prisma.treasury.findUnique.mockResolvedValue({
        id: 'treasury-1',
        isActive: true,
      });
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'pay-idem-1' });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
    };

    it('قيد الدفع يخلي SALARIES_PAYABLE: مجموع المدين عليها = الإجمالي', async () => {
      setupApprovedPayroll();

      await service.payPayroll(
        'pay-1',
        { treasuryId: 'treasury-1' },
        'manager-1',
      );

      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const call = financial.postJournalEntryInTx.mock.calls[0] as [
        unknown,
        { lines: { debitAccountId: string; amount: number }[] },
        unknown,
      ];
      const payableDebit = call[1].lines
        .filter(
          (line) => line.debitAccountId === CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
        )
        .reduce((sum, line) => sum + line.amount, 0);
      // الإجمالي 660 = صافٍ 410 + خصومات 250 — فيعود رصيد رواتب مستحقة صفرًا.
      expect(payableDebit).toBe(660);
    });

    it('قيد الدفع لا يلمس GENERAL_EXPENSE إطلاقًا (لا ازدواج مصروف)', async () => {
      setupApprovedPayroll();

      await service.payPayroll(
        'pay-1',
        { treasuryId: 'treasury-1' },
        'manager-1',
      );

      const call = financial.postJournalEntryInTx.mock.calls[0] as [
        unknown,
        {
          lines: {
            debitAccountId: string;
            creditAccountId: string;
          }[];
        },
        unknown,
      ];
      const accounts = call[1].lines.flatMap((line) => [
        line.debitAccountId,
        line.creditAccountId,
      ]);
      expect(accounts).not.toContain(CHART_OF_ACCOUNTS.GENERAL_EXPENSE);
      expect(accounts).not.toContain(CHART_OF_ACCOUNTS.SALARIES_EXPENSE);
    });

    it('قيد الدفع يقيّد WORKER_ADVANCES بقيمة الخصومات (استرداد السلف)', async () => {
      setupApprovedPayroll();

      await service.payPayroll(
        'pay-1',
        { treasuryId: 'treasury-1' },
        'manager-1',
      );

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
      const advanceLine = call[1].lines.find(
        (line) => line.creditAccountId === CHART_OF_ACCOUNTS.WORKER_ADVANCES,
      );
      expect(advanceLine).toBeDefined();
      expect(advanceLine?.amount).toBe(250);
    });

    it('صافٍ = صفر مع خصومات موجبة: قيد Dr SALARIES_PAYABLE / Cr WORKER_ADVANCES فقط بلا نقدية', async () => {
      setupApprovedPayroll({
        grossAmount: new Prisma.Decimal('660.00'),
        advanceDeduct: new Prisma.Decimal('660.00'),
        netAmount: new Prisma.Decimal('0.00'),
      });

      const result = await service.payPayroll(
        'pay-1',
        { treasuryId: 'treasury-1' },
        'manager-1',
      );

      expect(result).toMatchObject({
        status: PayrollStatus.PAID,
        isPaid: true,
      });
      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const call = financial.postJournalEntryInTx.mock.calls[0] as [
        unknown,
        {
          lines: {
            debitAccountId: string;
            creditAccountId: string;
            amount: number;
          }[];
          treasuryUpdates?: { delta: number }[];
        },
        unknown,
      ];
      expect(call[1].lines).toHaveLength(1);
      expect(call[1].lines[0]).toMatchObject({
        debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
        creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
        amount: 660,
      });
      // لا نقدية تخرج من الخزينة عند صافٍ = صفر.
      expect(call[1].treasuryUpdates).toBeUndefined();
    });

    it('إجمالي صفري (صافٍ = خصومات = 0): ينتقل إلى PAID دون أي قيد مالي', async () => {
      setupApprovedPayroll({
        grossAmount: new Prisma.Decimal('0.00'),
        advanceDeduct: new Prisma.Decimal('0.00'),
        absenceDeduct: new Prisma.Decimal('0.00'),
        netAmount: new Prisma.Decimal('0.00'),
      });

      const result = await service.payPayroll(
        'pay-1',
        { treasuryId: 'treasury-1' },
        'manager-1',
      );

      expect(result).toMatchObject({
        status: PayrollStatus.PAID,
        isPaid: true,
      });
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('يرفض الصافي السالب بـ 400 ولا يرحّل قيدًا', async () => {
      setupApprovedPayroll({
        netAmount: new Prisma.Decimal('-50.00'),
      });

      await expect(
        service.payPayroll('pay-1', { treasuryId: 'treasury-1' }, 'manager-1'),
      ).rejects.toThrow('لا يمكن دفع كشف راتب بصافي مبلغ سالب');
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });
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
          approvedById: 'approver-1',
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
          approvedById: 'approver-1',
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
          approvedById: 'approver-1',
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
          approvedById: 'approver-1',
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
