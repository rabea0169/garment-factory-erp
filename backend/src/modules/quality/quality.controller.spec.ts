import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('QualityController — التفويض والصلاحيات (GF-0003)', () => {
  let controller: QualityController;
  let service: { getQualityChecks: jest.Mock; addQualityCheck: jest.Mock };

  beforeEach(() => {
    service = {
      getQualityChecks: jest.fn().mockResolvedValue([]),
      addQualityCheck: jest.fn().mockResolvedValue({ id: 'qc-1' }),
    };
    controller = new QualityController(service as unknown as QualityService);
  });

  it('يفوّض قراءة الفحوصات وتسجيلها إلى الخدمة', async () => {
    const body = {
      workOrderId: 'wo-1',
      stage: 'SEWING',
      checkedQty: 100,
      passedQty: 95,
      rejectedQty: 5,
    };
    await controller.getChecks();
    await controller.addCheck(body);
    expect(service.getQualityChecks).toHaveBeenCalledTimes(1);
    expect(service.addQualityCheck).toHaveBeenCalledWith(body);
  });

  it('تسجيل فحص مقيّد بـ PRODUCTION_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      QualityController.prototype,
      'addCheck',
    );
    expect(roles).toEqual([
      UserRole.PRODUCTION_MANAGER,
      UserRole.GENERAL_MANAGER,
    ]);
  });
});
