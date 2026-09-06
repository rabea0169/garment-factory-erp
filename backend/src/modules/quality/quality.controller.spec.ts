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

  // QLT-3 (GF-IMP-W2): فلاتر قائمة الفحوص تمرر كما هي إلى الخدمة
  it('QLT-3: getChecks يمرر فلاتر stage/workOrderId/from/to إلى الخدمة', async () => {
    const filters = {
      stage: ProductionStage.CUTTING,
      workOrderId: 'wo-2',
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T23:59:59Z',
      page: 2,
      limit: 10,
    };
    await controller.getChecks(filters);
    expect(service.getQualityChecks).toHaveBeenCalledWith(filters);
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

  // QLT-6 (GF-IMP-W3): مسارات القراءة (KPIs + القائمة) قُيّدت بالأدوار —
  // لا دور QUALITY مستقل في UserRole فيُفوَّض: إنتاج/إدارة عامة/سوبر أدمن.
  it.each([
    ['getKpis', 'مؤشرات الجودة'],
    ['getChecks', 'قائمة الفحوصات'],
  ] as const)(
    'QLT-6: %s مقيّد بـ PRODUCTION_MANAGER/GENERAL_MANAGER/SUPER_ADMIN (%s)',
    (method, _label) => {
      const roles = getMethodMetadata<UserRole[]>(
        ROLES_KEY,
        QualityController.prototype,
        method,
      );
      expect(roles).toEqual([
        UserRole.PRODUCTION_MANAGER,
        UserRole.GENERAL_MANAGER,
        UserRole.SUPER_ADMIN,
      ]);
    },
  );

  // QLT-6: توثيق Swagger للمسارين لم يكن موجودًا — ApiOperation مطلوب.
  it.each([
    ['getKpis', 'مؤشرات الجودة'],
    ['getChecks', 'قائمة الفحوصات'],
  ] as const)('QLT-6: %s يحمل ApiOperation للوثائق (%s)', (method, _label) => {
    const operation = getMethodMetadata<{ summary?: string } | undefined>(
      'swagger/apiOperation',
      QualityController.prototype,
      method,
    );
    expect(operation?.summary).toBeTruthy();
  });
});
