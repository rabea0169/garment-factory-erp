import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('HrController — التفويض والصلاحيات (GF-0003)', () => {
  let controller: HrController;
  let service: {
    getAllWorkers: jest.Mock;
    getWorkerDetails: jest.Mock;
    recordDailyProduction: jest.Mock;
    recordAttendance: jest.Mock;
    recordAdvance: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getAllWorkers: jest.fn().mockResolvedValue([]),
      getWorkerDetails: jest.fn().mockResolvedValue({ id: 'w-1' }),
      recordDailyProduction: jest.fn().mockResolvedValue({ id: 'dp-1' }),
      recordAttendance: jest.fn().mockResolvedValue({ id: 'att-1' }),
      recordAdvance: jest.fn().mockResolvedValue({ id: 'adv-1' }),
    };
    controller = new HrController(service as unknown as HrService);
  });

  it('يفوّض قراءة العمال وتفاصيلهم إلى الخدمة', async () => {
    await controller.getWorkers();
    await controller.getWorkerDetails('w-1');
    expect(service.getAllWorkers).toHaveBeenCalledTimes(1);
    expect(service.getWorkerDetails).toHaveBeenCalledWith('w-1');
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

  it('تسجيل سلفة مقيّد بـ HR_MANAGER فقط', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      HrController.prototype,
      'recordAdvance',
    );
    expect(roles).toEqual([UserRole.HR_MANAGER]);
  });
});
