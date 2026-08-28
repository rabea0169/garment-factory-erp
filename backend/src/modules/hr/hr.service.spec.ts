import { ConflictException, NotFoundException } from '@nestjs/common';
import { PayrollStatus, Prisma, WorkerSpecialty } from '@prisma/client';
import { HrService } from './hr.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('HrService — العمال والإنتاج بالقطعة (GF-0003)', () => {
  let service: HrService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let financial: {
    postJournalEntryInTx: jest.Mock;
    postJournalEntry: jest.Mock;
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    // RES-F02: make $transaction invoke the callback with prisma so all the
    // tx.* mocks we set up below resolve correctly.
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
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

    const result = await service.getWorkerDetails('w-1');

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
      pieceRate: 5.5,
    });
    prisma.dailyProduction.create.mockResolvedValue({ id: 'dp-1' });

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
        pieceRate: 5.5,
        totalAmount: 550,
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
});
