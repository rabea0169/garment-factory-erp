import 'reflect-metadata';
import { UserRole, WorkerSpecialty } from '@prisma/client';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

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
    };
    controller = new HrController(service as unknown as HrService);
  });

  it('يفوّض قراءة العمال وتفاصيلهم إلى الخدمة', async () => {
    await controller.getWorkers();
    await controller.getWorkerDetails('w-1');
    expect(service.getAllWorkers).toHaveBeenCalledTimes(1);
    expect(service.getWorkerDetails).toHaveBeenCalledWith('w-1');
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

    expect(service.createWorker).toHaveBeenCalledWith({
      ...body,
      hireDate: new Date(body.hireDate),
    });
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
    expect(service.recordAttendance).toHaveBeenCalledWith({
      ...body,
      date: new Date(body.date),
    });
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
    expect(service.recordDailyProduction).toHaveBeenCalledWith(body);
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

  it('تسجيل سلفة يمرر البيانات كما وردت', async () => {
    const body = { workerId: 'w-1', amount: 200 };
    await controller.recordAdvance(body);
    expect(service.recordAdvance).toHaveBeenCalledWith(body);
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

  it('دفع payroll محمي بدوري HR_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'payPayroll',
    );
    expect(roles).toEqual([UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER]);
  });

  it('تسجيل سلفة مقيّد بـ HR_MANAGER فقط', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'recordAdvance',
    );
    expect(roles).toEqual([UserRole.HR_MANAGER]);
  });
});
