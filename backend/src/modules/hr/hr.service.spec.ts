import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HrService } from './hr.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('HrService — العمال والإنتاج بالقطعة (GF-0003)', () => {
  let service: HrService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    // COMM-F03/F04: HrService now injects FinancialPostingService — provide
    // a no-op mock since the GF-0003 specs don't exercise payroll flows.
    const financial = {
      postJournalEntryInTx: jest.fn().mockResolvedValue({
        entryId: 'je-mock',
        entryCode: 'JE-MOCK',
        totalDebit: 0,
        totalCredit: 0,
        linesCount: 0,
        createdAt: new Date(),
      }),
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

  it('تسجيل سلفة يمرر (workerId, amount, notes) كما وردت', async () => {
    prisma.workerAdvance.create.mockResolvedValue({ id: 'adv-1' });

    await service.recordAdvance({
      workerId: 'w-1',
      amount: 200,
      notes: 'سلفة شهرية',
    });

    expect(prisma.workerAdvance.create).toHaveBeenCalledWith({
      data: { workerId: 'w-1', amount: 200, notes: 'سلفة شهرية' },
    });
  });
});
