import 'reflect-metadata';
import { ProductionStage, UserRole } from '@prisma/client';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('QualityController — التفويض والصلاحيات (GF-0003)', () => {
  let controller: QualityController;
  let service: {
    getQualityChecks: jest.Mock;
    getQualityKpis: jest.Mock;
    addQualityCheck: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getQualityChecks: jest.fn().mockResolvedValue([]),
      getQualityKpis: jest.fn().mockResolvedValue({ totals: {} }),
      addQualityCheck: jest.fn().mockResolvedValue({ id: 'qc-1' }),
    };
    controller = new QualityController(service as unknown as QualityService);
  });

  it('يفوّض قراءة الفحوصات وتسجيلها إلى الخدمة', async () => {
    const body = {
      workOrderId: 'wo-1',
      stageRunId: 'run-1',
      stage: ProductionStage.SEWING,
      checkedQty: 100,
      passedQty: 95,
      rejectedQty: 5,
      wasteQty: 0,
    };
    await controller.getChecks();
    const query = {
      stage: ProductionStage.SEWING,
      from: '2026-08-01T00:00:00Z',
    };
    await controller.getKpis(query);
    await controller.addCheck(body, 'user-1', 'quality-key-1');
    expect(service.getQualityChecks).toHaveBeenCalledWith(expect.anything());
    expect(service.getQualityChecks).toHaveBeenCalledTimes(1);
    expect(service.getQualityKpis).toHaveBeenCalledWith(query);
    expect(service.addQualityCheck).toHaveBeenCalledWith(
      body,
      'user-1',
      'quality-key-1',
    );
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
