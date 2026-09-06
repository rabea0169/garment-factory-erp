import 'reflect-metadata';
import { UserRole, WorkerSpecialty } from '@prisma/client';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';
import { PayrollQueryDto } from './dto/payroll-query.dto';

describe('HrController — التفويض والصلاحيات (GF-0003)', () => {
  let controller: HrController;
  let service: {
    getAllWorkers: jest.Mock;
    getWorkerDetails: jest.Mock;
    createWorker: jest.Mock;
    recordDailyProduction: jest.Mock;
    recordAttendance: jest.Mock;
    recordAdvance: jest.Mock;
    createPayroll: jest.Mock;
    approvePayroll: jest.Mock;
    payPayroll: jest.Mock;
    getPayrolls: jest.Mock;
    cancelPayroll: jest.Mock;
    getWorkerAdvances: jest.Mock;
    getDailyProductionRecords: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getAllWorkers: jest.fn().mockResolvedValue([]),
      getWorkerDetails: jest.fn().mockResolvedValue({ id: 'w-1' }),
      createWorker: jest.fn().mockResolvedValue({ id: 'w-1' }),
      recordDailyProduction: jest.fn().mockResolvedValue({ id: 'dp-1' }),
      recordAttendance: jest.fn().mockResolvedValue({ id: 'att-1' }),
      recordAdvance: jest.fn().mockResolvedValue({ id: 'adv-1' }),
      createPayroll: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      approvePayroll: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      payPayroll: jest.fn().mockResolvedValue({ id: 'pay-1', isPaid: true }),
      getPayrolls: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      cancelPayroll: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      getWorkerAdvances: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      getDailyProductionRecords: jest
        .fn()
        .mockResolvedValue({ data: [], meta: {} }),
    };
    controller = new HrController(service as unknown as HrService);
  });

  it('يفوّض قراءة العمال وتفاصيلهم إلى الخدمة', async () => {
    await controller.getWorkers();
    await controller.getWorkerDetails('w-1');
    expect(service.getAllWorkers).toHaveBeenCalledTimes(1);
    // HR-8: دور الجلسة الاختاريي يمر كـ undefined عند غيابه.
    expect(service.getWorkerDetails).toHaveBeenCalledWith('w-1', undefined);
  });

  it('إنشاء عامل يمرر تاريخ التعيين إلى الخدمة', async () => {
    const body = {
      name: 'أحمد محمود',
      phone: '01000000000',
      specialty: WorkerSpecialty.SEWING,
      pieceRate: 5.5,
      hireDate: '2026-08-27',
    };

    await controller.createWorker(body);

    expect(service.createWorker).toHaveBeenCalledWith(
      {
        ...body,
        hireDate: new Date(body.hireDate),
      },
      undefined,
    );
  });

  it('إنشاء عامل مقيّد بـ HR_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'createWorker',
    );
    expect(roles).toEqual([UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER]);
  });

  it('تسجيل حضور يمرر workerId وDate إلى الخدمة', async () => {
    const body = {
      workerId: 'w-1',
      date: '2026-08-26',
      isPresent: true,
      notes: 'حضور يدوي',
    };
    await controller.recordAttendance(body);
    expect(service.recordAttendance).toHaveBeenCalledWith(
      {
        ...body,
        date: new Date(body.date),
      },
      undefined,
    );
  });

  it('تسجيل حضور مقيّد بـ HR_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'recordAttendance',
    );
    expect(roles).toEqual([UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER]);
  });

  it('تسجيل إنتاج يومي يمرر البيانات كما وردت', async () => {
    const body = {
      workerId: 'w-1',
      date: new Date('2026-08-25'),
      piecesCount: 100,
    };
    await controller.recordProduction(body);
    expect(service.recordDailyProduction).toHaveBeenCalledWith(body, undefined);
  });

  it('تسجيل إنتاج مقيّد بـ PRODUCTION_MANAGER وHR_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'recordProduction',
    );
    expect(roles).toEqual([
      UserRole.PRODUCTION_MANAGER,
      UserRole.HR_MANAGER,
      UserRole.GENERAL_MANAGER,
    ]);
  });

  it('تسجيل سلفة يمرر البيانات وactorId وIdempotency-Key', async () => {
    const body = { workerId: 'w-1', amount: 200 };
    await controller.recordAdvance(body, 'hr-1', 'adv-key');
    expect(service.recordAdvance).toHaveBeenCalledWith(body, 'hr-1', 'adv-key');
  });

  it('إنشاء payroll يمرر تواريخ الفترة وactor وIdempotency-Key', async () => {
    const body = {
      workerId: 'w-1',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      notes: 'كشف أغسطس',
    };
    await controller.createPayroll(body, 'hr-1', 'pay-key');
    expect(service.createPayroll).toHaveBeenCalledWith(
      {
        ...body,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
      },
      'hr-1',
      'pay-key',
    );
  });

  it('payroll محمي بدوري HR_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'createPayroll',
    );
    expect(roles).toEqual([UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER]);
  });

  it('اعتماد payroll يمرر id وactor وIdempotency-Key', async () => {
    await controller.approvePayroll('pay-1', 'manager-1', 'approve-key');
    expect(service.approvePayroll).toHaveBeenCalledWith(
      'pay-1',
      'manager-1',
      'approve-key',
    );
  });

  it('اعتماد payroll محمي بدوري HR_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'approvePayroll',
    );
    expect(roles).toEqual([UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER]);
  });

  it('دفع payroll يمرر الخزينة والتاريخ وactor وIdempotency-Key', async () => {
    const body = {
      treasuryId: 'treasury-1',
      paymentDate: '2026-08-31',
      notes: 'صرف أغسطس',
    };
    await controller.payPayroll('pay-1', body, 'manager-1', 'pay-key');
    expect(service.payPayroll).toHaveBeenCalledWith(
      'pay-1',
      {
        treasuryId: body.treasuryId,
        paymentDate: new Date(body.paymentDate),
        notes: body.notes,
      },
      'manager-1',
      'pay-key',
    );
  });

  it('دفع payroll محمي بدوري HR_MANAGER وGENERAL_MANAGER وACCOUNTANT وCASHIER (HR-5)', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'payPayroll',
    );
    expect(roles).toEqual([
      UserRole.HR_MANAGER,
      UserRole.GENERAL_MANAGER,
      UserRole.ACCOUNTANT,
      UserRole.CASHIER,
    ]);
  });

  it('تسجيل سلفة مقيّد بـ HR_MANAGER فقط', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'recordAdvance',
    );
    expect(roles).toEqual([UserRole.HR_MANAGER]);
  });

  // ===================== GF-IMP-W3 / W3-A =====================

  // HR-8 (ب): دور الجلسة يمرر إلى الخدمة ليقرر ظهور حقول الهوية (نمط INV-2).
  it('قراءة العمال وتفاصيلهم تمرر دور الجلسة إلى الخدمة (HR-8)', async () => {
    await controller.getWorkers(
      { page: 1, limit: 20 },
      UserRole.PRODUCTION_MANAGER,
    );
    await controller.getWorkerDetails('w-1', UserRole.HR_MANAGER);

    expect(service.getAllWorkers).toHaveBeenCalledWith(
      { page: 1, limit: 20 },
      UserRole.PRODUCTION_MANAGER,
    );
    expect(service.getWorkerDetails).toHaveBeenCalledWith(
      'w-1',
      UserRole.HR_MANAGER,
    );
  });

  // HR-6 (أ): قائمة الرواتب — ترقيم وفلاتر تمرر كما هي إلى الخدمة.
  it('قائمة الرواتب تمرر فلاتر الاستعلام إلى الخدمة (HR-6)', async () => {
    const query = {
      page: 1,
      limit: 20,
      status: 'DRAFT',
      workerId: '00000000-0000-0000-0000-000000000001',
      from: '2026-08-01',
      to: '2026-08-31',
    } as unknown as PayrollQueryDto;
    await controller.getPayrolls(query);
    expect(service.getPayrolls).toHaveBeenCalledWith(query);
  });

  // HR-6 (ب): إبطال المسودة — أدوار HR_MANAGER وGENERAL_MANAGER فقط.
  it('إبطال كشف راتب محمي بدوري HR_MANAGER وGENERAL_MANAGER (HR-6)', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'cancelPayroll',
    );
    expect(roles).toEqual([UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER]);
  });

  it('إبطال كشف راتب يمرر id وactor وIdempotency-Key (HR-6)', async () => {
    await controller.cancelPayroll('pay-1', 'hr-1', 'cancel-key');
    expect(service.cancelPayroll).toHaveBeenCalledWith(
      'pay-1',
      'hr-1',
      'cancel-key',
    );
  });

  // HR-6 (ج): قراءات الجوال — السلف والإنتاج اليومي مرقمان بفلاتر.
  it('قائمة السلف والإنتاج تمرر الفلاتر إلى الخدمة (HR-6 ج)', async () => {
    const query = {
      page: 1,
      limit: 20,
      workerId: 'w-1',
      from: '2026-08-01',
      to: '2026-08-31',
    };
    await controller.getAdvances(query);
    await controller.getProduction(query);

    expect(service.getWorkerAdvances).toHaveBeenCalledWith(query);
    expect(service.getDailyProductionRecords).toHaveBeenCalledWith(query);
  });

  // HR-6: أدوار القراءة الثلاثة (القائمة + السلف + الإنتاج) —
  // HR_MANAGER وGENERAL_MANAGER (نص البند: «الأدوار: HR_MANAGER/GENERAL_MANAGER»).
  it('قراءات HR-6 (الرواتب والسلف والإنتاج) محصورة بـ HR_MANAGER وGENERAL_MANAGER', () => {
    for (const method of [
      'getPayrolls',
      'getAdvances',
      'getProduction',
    ] as const) {
      const roles = getMethodMetadata<UserRole[]>(
        ROLES_KEY,
        HrController.prototype,
        method,
      );
      expect(roles).toEqual([UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER]);
    }
  });
});
