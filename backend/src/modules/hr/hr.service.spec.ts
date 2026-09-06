import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollStatus,
  Prisma,
  UserRole,
  WorkerSpecialty,
} from '@prisma/client';
import { HrService } from './hr.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { computeRequestHash } from '../../core/common/idempotency.util';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * HR-2 (GF-IMP-W2) + HR-6/8 (GF-IMP-W3): payPayroll يوزّع الخصم على سلف
 * الفترة FIFO عبر workerAdvance.findMany/update، وقوائم القراءة تحتاج
 * count، والتحذير الناعم يحتاج attendance/dailyProduction.findFirst،
 * وإبطال المسودة يحتاج payroll.deleteMany — امتداد محلي للـ mock الموحد
 * بنمط inventory.service.spec (لا نعدّل الـ helper المشترك).
 */
type HrPrismaMock = ReturnType<typeof createPrismaMock> & {
  workerAdvance: {
    create: jest.Mock;
    aggregate: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  attendance: {
    create: jest.Mock;
    findFirst: jest.Mock;
  };
  dailyProduction: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  payroll: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    deleteMany: jest.Mock;
  };
};

function createHrPrismaMock(): HrPrismaMock {
  return {
    ...createPrismaMock(),
    workerAdvance: {
      create: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    attendance: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    dailyProduction: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    payroll: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn(),
    },
  };
}

describe('HrService — العمال والإنتاج بالقطعة (GF-0003)', () => {
  let service: HrService;
  let prisma: HrPrismaMock;
  let financial: {
    postJournalEntryInTx: jest.Mock;
    postJournalEntry: jest.Mock;
  };

  beforeEach(() => {
    prisma = createHrPrismaMock();
    // RES-F02: make $transaction invoke the callback with prisma so all the
    // tx.* mocks we set up below resolve correctly.
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    // HR-8 (أ): افتراضيًا حضور موجود — كي لا تُطبَع تحذيرات Logger في كل
    // اختبارات الإنتاج القديمة (اختبارات التحذير الناعم تضبط null صراحة).
    prisma.attendance.findFirst.mockResolvedValue({ id: 'att-default' });
    financial = {
      postJournalEntryInTx: jest.fn(),
      postJournalEntry: jest.fn(),
    };
    service = new HrService(
      prisma as unknown as PrismaService,
      financial as unknown as FinancialPostingService,
    );
  });

  it('يجلب العمال مرتبين بالأحدث', async () => {
    const workers = [{ id: 'w-1', name: 'أحمد محمود' }];
    prisma.worker.findMany.mockResolvedValue(workers);
    prisma.worker.count.mockResolvedValue(workers.length);

    const result = await service.getAllWorkers();

    expect(result.data).toEqual(workers);
    expect(prisma.worker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('ينشئ عاملًا ببيانات master data وكود مولد', async () => {
    const hireDate = new Date('2026-08-27');
    prisma.worker.create.mockResolvedValue({ id: 'w-1' });

    await service.createWorker({
      name: '  أحمد محمود  ',
      phone: ' 01000000000 ',
      nationalId: ' 29801011234567 ',
      specialty: WorkerSpecialty.SEWING,
      pieceRate: 5.5,
      hireDate,
    });

    const calls = prisma.worker.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const createCall = calls[0]?.[0];
    expect(createCall).toBeDefined();
    if (!createCall) throw new Error('worker.create was not called');

    expect(createCall.data).toEqual(
      expect.objectContaining({
        name: 'أحمد محمود',
        phone: '01000000000',
        nationalId: '29801011234567',
        specialty: WorkerSpecialty.SEWING,
        pieceRate: 5.5,
        hireDate,
      }),
    );
    expect(String(createCall.data.code)).toMatch(/^WRK-/);
  });

  it('يحّول تعارض الرقم القومي أو code إلى 409', async () => {
    prisma.worker.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );

    await expect(
      service.createWorker({
        name: 'عامل مكرر',
        specialty: WorkerSpecialty.CUTTING,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('تفاصيل العامل تشمل آخر 10 إنتاجات وآخر 5 سلف', async () => {
    const worker = {
      id: 'w-1',
      name: 'أحمد',
      dailyProduction: [],
      advances: [],
    };
    prisma.worker.findUnique.mockResolvedValue(worker);

    // HR-8: دور HR يرى الحقول كاملة (include) — نفس السلوك السابق.
    const result = await service.getWorkerDetails('w-1', UserRole.HR_MANAGER);

    expect(result).toEqual(worker);
    expect(prisma.worker.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'w-1' },
        include: {
          dailyProduction: { take: 10, orderBy: { date: 'desc' } },
          advances: { take: 5, orderBy: { date: 'desc' } },
        },
      }),
    );
  });

  it('يرمي 404 لعامل غير موجود', async () => {
    prisma.worker.findUnique.mockResolvedValue(null);
    await expect(service.getWorkerDetails('ghost')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('يسجل حضور العامل ليوم محدد', async () => {
    const date = new Date('2026-08-26');
    prisma.worker.findUnique.mockResolvedValue({ id: 'w-1' });
    prisma.attendance.create.mockResolvedValue({
      id: 'att-1',
      workerId: 'w-1',
      date,
      isPresent: true,
    });

    const result = await service.recordAttendance({
      workerId: 'w-1',
      date,
      isPresent: true,
      notes: 'حضور يدوي',
    });

    expect(result.id).toBe('att-1');
    expect(prisma.attendance.create).toHaveBeenCalledWith({
      data: {
        workerId: 'w-1',
        date,
        isPresent: true,
        notes: 'حضور يدوي',
      },
    });
  });

  it('يرفض تسجيل الحضور لعامل غير موجود', async () => {
    prisma.worker.findUnique.mockResolvedValue(null);

    await expect(
      service.recordAttendance({
        workerId: 'ghost',
        date: new Date('2026-08-26'),
        isPresent: true,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.attendance.create).not.toHaveBeenCalled();
  });

  it('يعيد 409 عند تكرار حضور العامل في اليوم نفسه', async () => {
    prisma.worker.findUnique.mockResolvedValue({ id: 'w-1' });
    prisma.attendance.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );

    await expect(
      service.recordAttendance({
        workerId: 'w-1',
        date: new Date('2026-08-26'),
        isPresent: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('تسجيل إنتاج: يحسب الإجمالي في الخادم (100 قطعة × 5.5 = 550) ويحفظ snapshot للسعر', async () => {
    prisma.worker.findUnique.mockResolvedValue({
      id: 'w-1',
      pieceRate: new Prisma.Decimal('5.5'),
    });
    prisma.dailyProduction.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'dp-1', ...data }),
    );

    const result = await service.recordDailyProduction({
      workerId: 'w-1',
      workOrderId: 'wo-1',
      date: new Date('2026-08-25'),
      piecesCount: 100,
    });

    expect(result.id).toBe('dp-1');
    expect(prisma.dailyProduction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workerId: 'w-1',
        workOrderId: 'wo-1',
        piecesCount: 100,
        pieceRate: new Prisma.Decimal('5.5'),
        totalAmount: new Prisma.Decimal('550'),
      }) as Record<string, unknown>,
    });
  });

  it('تسجيل إنتاج لعامل غير موجود يرمي 404 ولا ينشئ سجلًا', async () => {
    prisma.worker.findUnique.mockResolvedValue(null);
    await expect(
      service.recordDailyProduction({
        workerId: 'ghost',
        date: new Date(),
        piecesCount: 10,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.dailyProduction.create).not.toHaveBeenCalled();
  });

  it('تسجيل سلفة بدون treasuryId لا يرحّل قيدًا ماليًا', async () => {
    prisma.worker.findUnique.mockResolvedValue({
      id: 'w-1',
      name: 'أحمد',
      code: 'WRK-1',
    });
    prisma.workerAdvance.create.mockResolvedValue({ id: 'adv-1' });

    const created = await service.recordAdvance(
      {
        workerId: 'w-1',
        amount: 200,
        notes: 'سلفة شهرية',
      },
      'hr-1',
    );

    expect(created).toEqual({ id: 'adv-1' });
    expect(prisma.workerAdvance.create).toHaveBeenCalledWith({
      data: { workerId: 'w-1', amount: 200, notes: 'سلفة شهرية' },
    });
    // COMM-F05: بدون treasuryId لا يُرحَّل أي قيد GL.
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'hr-1',
          action: 'WORKER_ADVANCE_RECORDED',
          details: expect.objectContaining({
            postedToGL: false,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('تسجيل سلفة بعامل غير موجود يرمي 404', async () => {
    prisma.worker.findUnique.mockResolvedValue(null);

    await expect(
      service.recordAdvance({ workerId: 'ghost', amount: 200 }, 'hr-1'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.workerAdvance.create).not.toHaveBeenCalled();
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('تسجيل سلفة بtreasuryId غير نشط يرمي 404', async () => {
    prisma.worker.findUnique.mockResolvedValue({
      id: 'w-1',
      name: 'أحمد',
      code: 'WRK-1',
    });
    prisma.treasury.findUnique.mockResolvedValue({
      id: 't-1',
      isActive: false,
    });

    await expect(
      service.recordAdvance(
        { workerId: 'w-1', amount: 200, treasuryId: 't-1' },
        'hr-1',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.workerAdvance.create).not.toHaveBeenCalled();
    expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
  });

  it('تسجيل سلفة بtreasuryId نشط يرحّل قيد GL (Dr Worker Advances / Cr Cash) ويخصم من الخزينة', async () => {
    prisma.worker.findUnique.mockResolvedValue({
      id: 'w-1',
      name: 'أحمد',
      code: 'WRK-1',
    });
    prisma.treasury.findUnique.mockResolvedValue({ id: 't-1', isActive: true });
    prisma.workerAdvance.create.mockResolvedValue({ id: 'adv-1' });
    financial.postJournalEntryInTx.mockResolvedValue({
      entryId: 'je-1',
      entryCode: 'JE-1',
      totalDebit: 200,
      totalCredit: 200,
      linesCount: 1,
      createdAt: new Date(),
    });

    await service.recordAdvance(
      { workerId: 'w-1', amount: 200, treasuryId: 't-1' },
      'hr-1',
    );

    expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
    const call = financial.postJournalEntryInTx.mock.calls[0] as [
      unknown,
      {
        postingKey: string;
        lines: { amount: number }[];
        treasuryUpdates: { treasuryId: string; delta: number }[];
      },
      unknown,
    ];
    expect(call[1].postingKey).toBe('hr-worker-advance:adv-1');
    expect(call[1].lines[0].amount).toBe(200);
    expect(call[1].treasuryUpdates).toEqual([
      { treasuryId: 't-1', delta: -200 },
    ]);
  });

  // COMM-F02: Separation of Duties — the user who created a payroll must NOT
  // approve it themselves. This blocks the insider threat where a single
  // HR_MANAGER creates + approves a fake payroll without oversight.
  describe('COMM-F02 — فصل الواجبات في اعتماد كشف الراتب', () => {
    const draftPayroll = {
      id: 'pay-1',
      workerId: 'w-1',
      periodStart: new Date('2026-08-01'),
      periodEnd: new Date('2026-08-31'),
      grossAmount: new Prisma.Decimal(1000),
      advanceDeduct: new Prisma.Decimal(0),
      absenceDeduct: new Prisma.Decimal(0),
      netAmount: new Prisma.Decimal(1000),
      status: PayrollStatus.DRAFT,
      isPaid: false,
      paidAt: null,
      notes: null,
      createdById: 'hr-1',
      approvedById: null,
      approvedAt: null,
    };

    it('يرفض اعتماد كشف الراتب من نفس منشئه (409 ConflictException)', async () => {
      prisma.payroll.findUnique.mockResolvedValue(draftPayroll);

      await expect(service.approvePayroll('pay-1', 'hr-1')).rejects.toThrow(
        ConflictException,
      );

      // No state change, no GL posting, no idempotency key stored.
      expect(prisma.payroll.updateMany).not.toHaveBeenCalled();
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('يسمح لمستخدم آخر باعتماد كشف الراتب ويرحّل القيد GL', async () => {
      prisma.payroll.findUnique
        .mockResolvedValueOnce(draftPayroll)
        .mockResolvedValueOnce({
          ...draftPayroll,
          status: PayrollStatus.APPROVED,
          approvedById: 'gm-1',
        });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
      prisma.worker.findUnique.mockResolvedValue({
        id: 'w-1',
        name: 'أحمد',
      });
      financial.postJournalEntryInTx.mockResolvedValue({
        entryId: 'je-1',
        entryCode: 'JE-1',
        totalDebit: 1000,
        totalCredit: 1000,
        linesCount: 1,
        createdAt: new Date(),
      });

      const result = await service.approvePayroll('pay-1', 'gm-1');

      expect(result.status).toBe(PayrollStatus.APPROVED);
      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const call = financial.postJournalEntryInTx.mock.calls[0] as [
        unknown,
        {
          postingKey: string;
          lines: { amount: number }[];
          treasuryUpdates?: { treasuryId: string; delta: number }[];
        },
        unknown,
      ];
      expect(call[1].postingKey).toBe('payroll-approval:pay-1');
      expect(call[1].lines[0].amount).toBe(1000);
    });

    it('يرفض اعتماد كشف راتب معتمد مسبقًا (409)', async () => {
      prisma.payroll.findUnique.mockResolvedValue({
        ...draftPayroll,
        status: PayrollStatus.APPROVED,
      });

      await expect(service.approvePayroll('pay-1', 'gm-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // HR-1 (P0 — GF-IMP-W1): قيد الدفع يصفّي SALARIES_PAYABLE بالإجمالي ولا
  // يسجّل المصروف مرتين (المصروف يُقيّد مرة واحدة من الاعتماد فقط).
  describe('HR-1 — قيد دفع الرواتب', () => {
    const approvedPayroll = {
      id: 'pay-1',
      workerId: 'w-1',
      periodStart: new Date('2026-08-01'),
      periodEnd: new Date('2026-08-31'),
      grossAmount: new Prisma.Decimal(1000),
      advanceDeduct: new Prisma.Decimal(300),
      absenceDeduct: new Prisma.Decimal(0),
      netAmount: new Prisma.Decimal(700),
      status: PayrollStatus.APPROVED,
      isPaid: false,
      paidAt: null,
      notes: null,
      createdById: 'hr-1',
      approvedById: 'gm-1',
      approvedAt: new Date('2026-08-31T12:00:00.000Z'),
    };

    it('يدفع بDr SALARIES_PAYABLE بالإجمالي / Cr CASH بالصافي / Cr WORKER_ADVANCES بالخصومات', async () => {
      prisma.payroll.findUnique
        .mockResolvedValueOnce(approvedPayroll)
        .mockResolvedValueOnce({
          ...approvedPayroll,
          status: PayrollStatus.PAID,
          isPaid: true,
          paidAt: new Date('2026-09-01T12:00:00.000Z'),
        });
      prisma.treasury.findUnique.mockResolvedValue({
        id: 't-1',
        isActive: true,
      });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
      financial.postJournalEntryInTx.mockResolvedValue({
        entryId: 'je-2',
        entryCode: 'JE-2',
        totalDebit: 1000,
        totalCredit: 1000,
        linesCount: 2,
        createdAt: new Date(),
      });

      // HR-5: الدافع غير المعتمد (نمط SoD على الدفع)
      const result = await service.payPayroll(
        'pay-1',
        { treasuryId: 't-1', notes: 'صرف راتب أغسطس' },
        'cashier-1',
      );

      expect(result).toMatchObject({ status: PayrollStatus.PAID });
      expect(financial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const call = financial.postJournalEntryInTx.mock.calls[0] as [
        unknown,
        {
          postingKey: string;
          lines: {
            debitAccountId: string;
            creditAccountId: string;
            amount: number;
          }[];
          treasuryUpdates: { treasuryId: string; delta: number }[];
        },
        unknown,
      ];
      expect(call[1].postingKey).toBe('hr-payroll-pay:pay-1');
      // مجموع المدين على SALARIES_PAYABLE = الإجمالي 1000 (صافٍ 700 + خصم 300)
      // فيعود رصيد رواتب مستحقة إلى صفر بعد الاعتماد والدفع.
      const payableDebit = call[1].lines
        .filter((l) => l.debitAccountId === CHART_OF_ACCOUNTS.SALARIES_PAYABLE)
        .reduce((sum, l) => sum + l.amount, 0);
      expect(payableDebit).toBe(1000);
      expect(
        call[1].lines.some((l) => l.creditAccountId === CHART_OF_ACCOUNTS.CASH),
      ).toBe(true);
      expect(call[1].lines).toContainEqual(
        expect.objectContaining({
          debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
          creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
          amount: 300,
        }),
      );
      // المصروف يُقيّد مرة واحدة من الاعتماد فقط — الدفع لا يلمس المصاريف.
      expect(
        call[1].lines.some(
          (l) =>
            l.debitAccountId === CHART_OF_ACCOUNTS.GENERAL_EXPENSE ||
            l.debitAccountId === CHART_OF_ACCOUNTS.SALARIES_EXPENSE,
        ),
      ).toBe(false);
      // الخزينة تُخصم بالصافي فقط.
      expect(call[1].treasuryUpdates).toEqual([
        { treasuryId: 't-1', delta: -700 },
      ]);
    });

    it('HR-2: يوزّع خصم السلف FIFO على سلف الفترة داخل نفس معاملة الدفع', async () => {
      prisma.payroll.findUnique
        .mockResolvedValueOnce(approvedPayroll)
        .mockResolvedValueOnce({
          ...approvedPayroll,
          status: PayrollStatus.PAID,
          isPaid: true,
          paidAt: new Date('2026-09-01T12:00:00.000Z'),
        });
      prisma.treasury.findUnique.mockResolvedValue({
        id: 't-1',
        isActive: true,
      });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
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
        { treasuryId: 't-1', notes: 'صرف راتب أغسطس' },
        'cashier-1',
      );

      // الخصم 300 يُوزّع FIFO: 200 كاملة على الأولى ثم 100 من الثانية.
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
  });
});

// ============================================================
// GF-IMP-W3 — W3-A: HR-4/5/6/7/8 (اختبارات المواصفات)
// ============================================================
describe('HrService — GF-IMP-W3 (HR-4/5/6/7/8)', () => {
  let service: HrService;
  let prisma: HrPrismaMock;
  let financial: { postJournalEntryInTx: jest.Mock };
  const periodStart = new Date('2026-08-01T00:00:00.000Z');
  const periodEnd = new Date('2026-08-31T00:00:00.000Z');

  const payrollRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay-w3',
    workerId: 'worker-1',
    periodStart,
    periodEnd,
    grossAmount: new Prisma.Decimal('500.00'),
    advanceDeduct: new Prisma.Decimal('0.00'),
    absenceDeduct: new Prisma.Decimal('0.00'),
    netAmount: new Prisma.Decimal('500.00'),
    status: PayrollStatus.DRAFT,
    isPaid: false,
    paidAt: null,
    notes: null,
    createdById: 'hr-1',
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
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });
    service = new HrService(
      prisma as unknown as PrismaService,
      financial as unknown as FinancialPostingService,
    );
  });

  // HR-7 (P2): الضرب بالقطعة يجب أن يجري على Prisma.Decimal — بلا تحلل
  // عائم (0.1 × 3 = 0.3 بالضبط، لا 0.30000000000000004).
  describe('HR-7 — دقة إجماليات الإنتاج (Decimal)', () => {
    it('3 قطع × 0.1 = Decimal 0.3 بالضبط (لا 0.30000000000000004)', async () => {
      prisma.worker.findUnique.mockResolvedValue({
        id: 'w-1',
        pieceRate: new Prisma.Decimal('0.1'),
      });
      prisma.dailyProduction.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'dp-w3', ...data }),
      );

      const result = await service.recordDailyProduction({
        workerId: 'w-1',
        date: new Date('2026-08-25'),
        piecesCount: 3,
      });

      const createCalls = prisma.dailyProduction.create.mock
        .calls as unknown as [[{ data: { totalAmount: Prisma.Decimal } }]];
      const createArg = createCalls[0][0];
      expect(Prisma.Decimal.isDecimal(createArg.data.totalAmount)).toBe(true);
      expect(createArg.data.totalAmount.eq('0.3')).toBe(true);
      expect(createArg.data.totalAmount.toString()).toBe('0.3');
      expect(
        createArg.data.totalAmount.toNumber() === 0.30000000000000004,
      ).toBe(false);
      expect(result.totalAmount.eq('0.3')).toBe(true);
    });

    it('التقريب إلى منزلتين عند التخزين فقط (7 قطع × 1.005 = 7.04)', async () => {
      prisma.worker.findUnique.mockResolvedValue({
        id: 'w-1',
        pieceRate: new Prisma.Decimal('1.005'),
      });
      prisma.dailyProduction.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'dp-w3', ...data }),
      );

      await service.recordDailyProduction({
        workerId: 'w-1',
        date: new Date('2026-08-25'),
        piecesCount: 7,
      });

      const createCalls = prisma.dailyProduction.create.mock
        .calls as unknown as [[{ data: { totalAmount: Prisma.Decimal } }]];
      const createArg = createCalls[0][0];
      expect(createArg.data.totalAmount.eq('7.04')).toBe(true);
      expect(createArg.data.totalAmount.decimalPlaces()).toBe(2);
    });

    it('snapshot السعر يُحفظ كما ورد (Decimal من العامل) بلا تحويل', async () => {
      prisma.worker.findUnique.mockResolvedValue({
        id: 'w-1',
        pieceRate: new Prisma.Decimal('5.5'),
      });
      prisma.dailyProduction.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'dp-w3', ...data }),
      );

      await service.recordDailyProduction({
        workerId: 'w-1',
        date: new Date('2026-08-25'),
        piecesCount: 100,
      });

      const createCalls = prisma.dailyProduction.create.mock
        .calls as unknown as [
        [{ data: { pieceRate: unknown; totalAmount: Prisma.Decimal } }],
      ];
      const createArg = createCalls[0][0];
      expect((createArg.data.pieceRate as Prisma.Decimal).eq('5.5')).toBe(true);
      expect(createArg.data.totalAmount.eq('550')).toBe(true);
    });
  });

  // HR-4 (P2): صافٍ = صفر (السلف غطت الإجمالي) — مسار تسوية بلا نقد:
  // لا خزينة مطلوبة أصلًا، ولا حركة خزينة، والقيد متوازن على الخصومات.
  describe('HR-4 — تسوية صافي صفر بلا خزينة', () => {
    const setupApprovedZeroNet = () => {
      prisma.payroll.findUnique
        .mockResolvedValueOnce(
          payrollRow({
            grossAmount: new Prisma.Decimal('500.00'),
            advanceDeduct: new Prisma.Decimal('500.00'),
            netAmount: new Prisma.Decimal('0.00'),
            status: PayrollStatus.APPROVED,
            approvedById: 'gm-1',
          }),
        )
        .mockResolvedValueOnce(
          payrollRow({
            grossAmount: new Prisma.Decimal('500.00'),
            advanceDeduct: new Prisma.Decimal('500.00'),
            netAmount: new Prisma.Decimal('0.00'),
            status: PayrollStatus.PAID,
            isPaid: true,
            paidAt: new Date('2026-09-01'),
            approvedById: 'gm-1',
          }),
        );
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-w3' });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });
    };

    it('صافٍ صفر بلا treasuryId: ينتقل إلى PAID وقيد الخصومات فقط بلا خزينة', async () => {
      setupApprovedZeroNet();

      const result = await service.payPayroll('pay-w3', {}, 'manager-2');

      expect(result).toMatchObject({
        status: PayrollStatus.PAID,
        isPaid: true,
      });
      // لا بحث عن خزينة أصلًا — المسار نقدي-صفر بالكامل.
      expect(prisma.treasury.findUnique).not.toHaveBeenCalled();
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
      // القيد متوازن: Dr SALARIES_PAYABLE 500 / Cr WORKER_ADVANCES 500
      const payableDebit = call[1].lines
        .filter((l) => l.debitAccountId === CHART_OF_ACCOUNTS.SALARIES_PAYABLE)
        .reduce((sum, l) => sum + l.amount, 0);
      expect(payableDebit).toBe(500);
      expect(call[1].lines).toEqual([
        expect.objectContaining({
          debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
          creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
          amount: 500,
        }),
      ]);
      expect(call[1].treasuryUpdates).toBeUndefined();
    });

    it('صافٍ موجب بلا treasuryId → 400 (الخزينة مطلوبة لصرف النقد)', async () => {
      prisma.payroll.findUnique.mockResolvedValueOnce(
        payrollRow({ status: PayrollStatus.APPROVED, approvedById: 'gm-1' }),
      );

      await expect(
        service.payPayroll('pay-w3', {}, 'manager-2'),
      ).rejects.toThrow('الخزينة مطلوبة لدفع كشف راتب بصافٍ أكبر من صفر');
      expect(prisma.payroll.updateMany).not.toHaveBeenCalled();
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });
  });

  // HR-5 (P2): فصل الواجبات على الدفع — المعتمد لا يدفع بنفسه.
  describe('HR-5 — فصل الواجبات على دفع الرواتب', () => {
    it('الدافع هو نفسه المعتمد → 409 ولا يُدفع', async () => {
      prisma.payroll.findUnique.mockResolvedValue(
        payrollRow({
          status: PayrollStatus.APPROVED,
          approvedById: 'same-actor',
        }),
      );

      await expect(
        service.payPayroll(
          'pay-w3',
          { treasuryId: 'treasury-1' },
          'same-actor',
        ),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.payPayroll(
          'pay-w3',
          { treasuryId: 'treasury-1' },
          'same-actor',
        ),
      ).rejects.toThrow('فصل الواجبات');
      expect(prisma.payroll.updateMany).not.toHaveBeenCalled();
      expect(financial.postJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('الدافع غير المعتمد (مثل المحاسب أو أمين الصندوق) ينجح', async () => {
      prisma.payroll.findUnique
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.APPROVED,
            approvedById: 'gm-1',
          }),
        )
        .mockResolvedValueOnce(
          payrollRow({
            status: PayrollStatus.PAID,
            isPaid: true,
            paidAt: new Date('2026-09-01'),
            approvedById: 'gm-1',
          }),
        );
      prisma.treasury.findUnique.mockResolvedValue({
        id: 'treasury-1',
        isActive: true,
      });
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-w3' });
      prisma.payroll.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.payPayroll(
        'pay-w3',
        { treasuryId: 'treasury-1' },
        'accountant-1',
      );

      expect(result).toMatchObject({
        status: PayrollStatus.PAID,
        isPaid: true,
      });
    });
  });

  // HR-6 (P2): واجهة قراءة الرواتب + إبطال المسودة + قوائم السلف والإنتاج.
  describe('HR-6 — قراءة الرواتب وإبطال المسودة', () => {
    it('قائمة الرواتب: فلاتر status/workerId/period + إسقاط آمن + اسم العامل + أرقام', async () => {
      prisma.payroll.findMany.mockResolvedValue([
        {
          ...payrollRow(),
          worker: { id: 'worker-1', name: 'أحمد', code: 'WKR-1' },
        },
      ]);
      prisma.payroll.count.mockResolvedValue(1);

      const result = await service.getPayrolls({
        page: 1,
        limit: 20,
        status: PayrollStatus.DRAFT,
        workerId: 'worker-1',
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(prisma.payroll.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: PayrollStatus.DRAFT,
            workerId: 'worker-1',
            periodStart: { lte: new Date('2026-08-31') },
            periodEnd: { gte: new Date('2026-08-01') },
          },
          orderBy: { periodStart: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(prisma.payroll.count).toHaveBeenCalledWith({
        where: {
          status: PayrollStatus.DRAFT,
          workerId: 'worker-1',
          periodStart: { lte: new Date('2026-08-31') },
          periodEnd: { gte: new Date('2026-08-01') },
        },
      });
      // select آمن صريح: لا هاش ولا حقول خارج القائمة، مع اسم العامل.
      const payrollCalls = prisma.payroll.findMany.mock.calls as unknown as [
        [{ select: Record<string, unknown> }],
      ];
      expect(payrollCalls[0][0].select).toBeDefined();
      expect(payrollCalls[0][0].select.worker).toBeDefined();
      // المبالغ أرقام JSON-friendly (لا Prisma.Decimal strings).
      expect(result.data[0].grossAmount).toBe(500);
      expect(result.data[0].netAmount).toBe(500);
      expect(result.data[0].worker).toEqual({
        id: 'worker-1',
        name: 'أحمد',
        code: 'WKR-1',
      });
      expect(result.meta.total).toBe(1);
      // HR-6: العقد الحرفي { items, total, page, limit } — حرفيًا كما
      // يستهلكه وكيل الجوال (المفتاح items لا data).
      expect(result.items).toBe(result.data);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('نطاق بحث غير منطقي (from بعد to) → 400 ولا استعلام قاعدة', async () => {
      await expect(
        service.getPayrolls({
          page: 1,
          limit: 20,
          from: '2026-09-01',
          to: '2026-08-01',
        }),
      ).rejects.toThrow(
        'تاريخ بداية فترة البحث لا يمكن أن يكون بعد تاريخ النهاية',
      );
      expect(prisma.payroll.findMany).not.toHaveBeenCalled();
      expect(prisma.payroll.count).not.toHaveBeenCalled();
    });

    it('إبطال مسودة: CAS على DRAFT + ActivityLog + idempotency كامل', async () => {
      prisma.payroll.findUnique.mockResolvedValue(payrollRow());
      prisma.payroll.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.cancelPayroll(
        'pay-w3',
        'hr-1',
        'cancel-key',
      );

      expect(result).toMatchObject({ cancelled: true, id: 'pay-w3' });
      // CAS: حذف مشروط بحالة DRAFT فقط (الـ enum بلا قيمة CANCELLED —
      // الإبطال الفيزيائي للمسودة بلا آثار هو التمثيل الوحيد المتاح).
      expect(prisma.payroll.deleteMany).toHaveBeenCalledWith({
        where: { id: 'pay-w3', status: PayrollStatus.DRAFT },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PAYROLL_CANCELLED',
            module: 'HR',
            userId: 'hr-1',
            details: expect.objectContaining({
              payrollId: 'pay-w3',
            }) as Record<string, unknown>,
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      );
      // الاستجابة خُزنت على مفتاح idempotency داخل المعاملة.
      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'cancel-key' },
        }),
      );
    });

    it('إبطال كشف غير مسودة → 400 ولا يُحذف', async () => {
      prisma.payroll.findUnique.mockResolvedValue(
        payrollRow({ status: PayrollStatus.APPROVED }),
      );

      await expect(
        service.cancelPayroll('pay-w3', 'hr-1', 'cancel-key'),
      ).rejects.toThrow('لا يمكن إبطال إلا كشف راتب في حالة المسودة');
      expect(prisma.payroll.deleteMany).not.toHaveBeenCalled();
    });

    it('إبطال كشف غير موجود → 404', async () => {
      prisma.payroll.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelPayroll('ghost', 'hr-1', 'cancel-key'),
      ).rejects.toThrow(NotFoundException);
    });

    it('CAS فشل (تغيرت الحالة بالتزامن) → 409', async () => {
      prisma.payroll.findUnique.mockResolvedValue(payrollRow());
      prisma.payroll.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.cancelPayroll('pay-w3', 'hr-1', 'cancel-key'),
      ).rejects.toThrow(ConflictException);
    });

    it('replay لمفتاح الإبطال يعيد الاستجابة المخزنة بلا أثر ثانٍ', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'cancel-key',
        scope: 'hr-payroll-cancel',
        requestHash: computeRequestHash({
          payrollId: 'pay-w3',
          actorId: 'hr-1',
        }),
        response: { id: 'pay-w3', cancelled: true, replayed: true },
      });

      const result = await service.cancelPayroll(
        'pay-w3',
        'hr-1',
        'cancel-key',
      );

      expect(result).toMatchObject({ id: 'pay-w3', cancelled: true });
      expect(prisma.payroll.deleteMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });
  });

  describe('HR-6 — قوائم السلف والإنتاج (شاشات الجوال)', () => {
    it('قائمة السلف: فلاتر workerId/from/to + إسقاط آمن + أرقام', async () => {
      prisma.workerAdvance.findMany.mockResolvedValue([
        {
          id: 'adv-1',
          workerId: 'worker-1',
          amount: new Prisma.Decimal('200.00'),
          settledAmount: new Prisma.Decimal('50.00'),
          date: new Date('2026-08-10'),
          notes: 'سلفة',
          worker: { id: 'worker-1', name: 'أحمد', code: 'WKR-1' },
        },
      ]);
      prisma.workerAdvance.count.mockResolvedValue(1);

      const result = await service.getWorkerAdvances({
        page: 1,
        limit: 20,
        workerId: 'worker-1',
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(prisma.workerAdvance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workerId: 'worker-1',
            date: {
              gte: new Date('2026-08-01'),
              lte: new Date('2026-08-31'),
            },
          },
          orderBy: { date: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.data[0]).toMatchObject({
        id: 'adv-1',
        amount: 200,
        settledAmount: 50,
        worker: { id: 'worker-1', name: 'أحمد' },
      });
      expect(result.meta.total).toBe(1);
      // HR-6 (ج): العقد الحرفي { items, total, page, limit }.
      expect(result.items).toBe(result.data);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('قائمة السلف: نطاق غير منطقي (from بعد to) → 400 بلا استعلام', async () => {
      await expect(
        service.getWorkerAdvances({
          page: 1,
          limit: 20,
          workerId: 'worker-1',
          from: '2026-09-01',
          to: '2026-08-01',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.workerAdvance.findMany).not.toHaveBeenCalled();
      expect(prisma.workerAdvance.count).not.toHaveBeenCalled();
    });

    it('قائمة الإنتاج اليومي: فلاتر workerId/from/to + أرقام', async () => {
      prisma.dailyProduction.findMany.mockResolvedValue([
        {
          id: 'dp-1',
          workerId: 'worker-1',
          workOrderId: 'wo-1',
          date: new Date('2026-08-15'),
          piecesCount: 120,
          pieceRate: new Prisma.Decimal('5.5'),
          totalAmount: new Prisma.Decimal('660.00'),
          worker: { id: 'worker-1', name: 'أحمد', code: 'WKR-1' },
        },
      ]);
      prisma.dailyProduction.count.mockResolvedValue(1);

      const result = await service.getDailyProductionRecords({
        page: 1,
        limit: 20,
        workerId: 'worker-1',
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(prisma.dailyProduction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workerId: 'worker-1',
            date: {
              gte: new Date('2026-08-01'),
              lte: new Date('2026-08-31'),
            },
          },
          orderBy: { date: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.data[0]).toMatchObject({
        id: 'dp-1',
        piecesCount: 120,
        pieceRate: 5.5,
        totalAmount: 660,
      });
      // HR-6 (ج): العقد الحرفي { items, total, page, limit }.
      expect(result.items).toBe(result.data);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('قائمة الإنتاج: نطاق غير منطقي (from بعد to) → 400 بلا استعلام', async () => {
      await expect(
        service.getDailyProductionRecords({
          page: 1,
          limit: 20,
          workerId: 'worker-1',
          from: '2026-09-01',
          to: '2026-08-01',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.dailyProduction.findMany).not.toHaveBeenCalled();
      expect(prisma.dailyProduction.count).not.toHaveBeenCalled();
    });
  });

  // HR-8 (P2): تحذير ناعم للحضور + قصر حقول الهوية على أدوار HR.
  describe('HR-8 — الحضور الناعم وحقول الهوية', () => {
    it('تسجيل إنتاج بلا حضور ولا إنتاج سابق في اليوم نفسه → تحذير فقط (لا رفض)', async () => {
      prisma.worker.findUnique.mockResolvedValue({
        id: 'w-1',
        pieceRate: new Prisma.Decimal('5.5'),
      });
      prisma.attendance.findFirst.mockResolvedValue(null);
      prisma.dailyProduction.findFirst.mockResolvedValue(null);
      prisma.dailyProduction.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'dp-w3', ...data }),
      );
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await service.recordDailyProduction({
        workerId: 'w-1',
        date: new Date('2026-08-25'),
        piecesCount: 10,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('بلا سجل حضور أو إنتاج سابق'),
      );
      // التحذير الناعم لا يمنع الإنشاء (السياسة معلقة ADR-15).
      expect(prisma.dailyProduction.create).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it('يوجد حضور لنفس اليوم → لا تحذير إطلاقًا', async () => {
      prisma.worker.findUnique.mockResolvedValue({
        id: 'w-1',
        pieceRate: new Prisma.Decimal('5.5'),
      });
      prisma.attendance.findFirst.mockResolvedValue({ id: 'att-1' });
      prisma.dailyProduction.findFirst.mockResolvedValue(null);
      prisma.dailyProduction.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'dp-w3', ...data }),
      );
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await service.recordDailyProduction({
        workerId: 'w-1',
        date: new Date('2026-08-25'),
        piecesCount: 10,
      });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('تفاصيل العامل لأدوار HR تشمل nationalId وphone', async () => {
      prisma.worker.findUnique.mockResolvedValue({
        id: 'w-1',
        code: 'WKR-1',
        name: 'أحمد',
        nationalId: '29001011234567',
        phone: '01000000000',
        specialty: 'SEWING',
        dailyProduction: [],
        advances: [],
      });

      const result = await service.getWorkerDetails('w-1', UserRole.HR_MANAGER);

      expect(result.nationalId).toBe('29001011234567');
      expect(result.phone).toBe('01000000000');
    });

    it('تفاصيل العامل لدور غير HR: بلا nationalId ولا phone (نمط INV-2)', async () => {
      prisma.worker.findUnique.mockImplementation(
        ({ select }: { select?: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'w-1',
            code: 'WKR-1',
            name: 'أحمد',
            specialty: 'SEWING',
            // mock يحترم select: الحقول غير المطلوبة غائبة أصلًا
            ...(select?.nationalId ? { nationalId: '29001011234567' } : {}),
            ...(select?.phone ? { phone: '01000000000' } : {}),
            dailyProduction: [],
            advances: [],
          }),
      );

      const result = (await service.getWorkerDetails(
        'w-1',
        UserRole.PRODUCTION_MANAGER,
      )) as Record<string, unknown>;

      expect(result.nationalId).toBeUndefined();
      expect(result.phone).toBeUndefined();
      expect(result.name).toBe('أحمد');
      // الاستعلام نفسه لا يطلب الحقول الحساسة من القاعدة.
      const workerCalls = prisma.worker.findUnique.mock.calls as unknown as [
        [{ select: Record<string, unknown> }],
      ];
      expect(workerCalls[0][0].select.nationalId).toBeUndefined();
      expect(workerCalls[0][0].select.phone).toBeUndefined();
    });

    it('قائمة العمال لدور غير HR: select بلا حقول الهوية', async () => {
      prisma.worker.findMany.mockResolvedValue([{ id: 'w-1', name: 'أحمد' }]);
      prisma.worker.count.mockResolvedValue(1);

      await service.getAllWorkers(
        { page: 1, limit: 20 },
        UserRole.PRODUCTION_MANAGER,
      );

      const listCalls = prisma.worker.findMany.mock.calls as unknown as [
        [{ select: Record<string, unknown> }],
      ];
      expect(listCalls[0][0].select).toBeDefined();
      expect(listCalls[0][0].select.nationalId).toBeUndefined();
      expect(listCalls[0][0].select.phone).toBeUndefined();
    });

    it('قائمة العمال لأدوار HR: حقول الهوية متاحة', async () => {
      prisma.worker.findMany.mockResolvedValue([
        { id: 'w-1', name: 'أحمد', nationalId: '29001011234567' },
      ]);
      prisma.worker.count.mockResolvedValue(1);

      const result = await service.getAllWorkers(
        { page: 1, limit: 20 },
        UserRole.GENERAL_MANAGER,
      );

      expect(result.data[0].nationalId).toBe('29001011234567');
    });

    it('الدور غير المعروف (استدعاء برمجي بلا دور) → غير HR (fail-closed)', async () => {
      prisma.worker.findMany.mockResolvedValue([{ id: 'w-1', name: 'أحمد' }]);
      prisma.worker.count.mockResolvedValue(1);

      await service.getAllWorkers({ page: 1, limit: 20 });

      const listCalls = prisma.worker.findMany.mock.calls as unknown as [
        [{ select: Record<string, unknown> }],
      ];
      expect(listCalls[0][0].select.nationalId).toBeUndefined();
      expect(listCalls[0][0].select.phone).toBeUndefined();
    });
  });
});
