import 'reflect-metadata';
import { ProductionStage, UserRole, WorkOrderStatus } from '@prisma/client';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { ProductionWorkflowService } from './production-workflow.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';

describe('ProductionController — هوية الجلسة والصلاحيات (GF-0003/GF-0013)', () => {
  let controller: ProductionController;
  let service: {
    getAllWorkOrders: jest.Mock;
    createWorkOrder: jest.Mock;
    updateOrderStatus: jest.Mock;
  };
  let workflow: {
    transitionStage: jest.Mock;
    recordStageOutput: jest.Mock;
    consumeMaterial: jest.Mock;
    finalizeCost: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getAllWorkOrders: jest.fn().mockResolvedValue([]),
      createWorkOrder: jest.fn().mockResolvedValue({ id: 'wo-1' }),
      updateOrderStatus: jest.fn().mockResolvedValue({ id: 'wo-1' }),
    };
    workflow = {
      transitionStage: jest.fn().mockResolvedValue({
        replayed: false,
        transitionId: 'transition-1',
        stageRunId: 'run-1',
      }),
      recordStageOutput: jest.fn().mockResolvedValue(undefined),
      consumeMaterial: jest
        .fn()
        .mockResolvedValue({ consumptionId: 'consumption-1' }),
      finalizeCost: jest.fn().mockResolvedValue({ id: 'cost-1' }),
    };
    controller = new ProductionController(
      service as unknown as ProductionService,
      workflow as unknown as ProductionWorkflowService,
    );
  });

  it('إنشاء أمر تشغيل يمرر هوية الجلسة (من @CurrentUser) كمعامل مستقل', async () => {
    const body = {
      productVariantId: 'v-1',
      bomVersionId: 'b-1',
      quantity: 100,
    };
    const maliciousBody = {
      ...body,
      creatorId: 'HACKED-ID',
    } as unknown as CreateWorkOrderDto;

    await controller.createWorkOrder('user-from-session', maliciousBody);

    expect(service.createWorkOrder).toHaveBeenCalledWith(
      maliciousBody,
      'user-from-session',
    );
  });

  it('تحديث حالة legacy يمرر (id, status) كما وردا', async () => {
    await controller.updateStatus(
      'wo-1',
      { status: WorkOrderStatus.SEWING },
      'test-user-id',
    );
    expect(service.updateOrderStatus).toHaveBeenCalledWith(
      'wo-1',
      'SEWING',
      'test-user-id',
    );
  });

  it('انتقال GF-0013 يمرر actor وIdempotency-Key إلى الخدمة', async () => {
    const body = {
      toStage: ProductionStage.CUTTING,
      reason: 'بدء أمر التشغيل',
    };

    await controller.transitionStage(
      'wo-1',
      body,
      'actor-from-jwt',
      'transition-key-1',
    );

    expect(workflow.transitionStage).toHaveBeenCalledWith(
      { workOrderId: 'wo-1', ...body, idempotencyKey: 'transition-key-1' },
      'actor-from-jwt',
    );
  });

  it('استهلاك الخامة يمرر actor ولا يقبل هوية من body', async () => {
    const body = {
      stageRunId: 'run-1',
      rawMaterialId: 'raw-1',
      warehouseId: 'warehouse-1',
      plannedQuantity: 3,
      actualQuantity: 4,
      wasteQuantity: 1,
      unit: 'METER',
    };

    await controller.consumeMaterial(
      'wo-1',
      body,
      'inventory-actor',
      'consume-key-1',
    );

    expect(workflow.consumeMaterial).toHaveBeenCalledWith(
      { workOrderId: 'wo-1', ...body, idempotencyKey: 'consume-key-1' },
      'inventory-actor',
    );
  });

  it('تسجيل output وfinalize يمران بالـ work order الصحيح', async () => {
    const body = {
      stage: ProductionStage.CUTTING,
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
    };

    await controller.recordStageOutput('wo-1', body, 'production-actor');
    await controller.finalizeCost('wo-1', 'production-actor');

    expect(workflow.recordStageOutput).toHaveBeenCalledWith(
      {
        workOrderId: 'wo-1',
        ...body,
      },
      'production-actor',
    );
    expect(workflow.finalizeCost).toHaveBeenCalledWith(
      'wo-1',
      'production-actor',
    );
  });

  it('إنشاء أمر تشغيل مقيّد بـ PRODUCTION_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      ProductionController.prototype,
      'createWorkOrder',
    );
    expect(roles).toEqual([
      UserRole.PRODUCTION_MANAGER,
      UserRole.GENERAL_MANAGER,
    ]);
  });

  it('مسارات workflow تستخدم أدوار الإنتاج والمدير العام', () => {
    const expected = [UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER];
    for (const method of [
      'transitionStage',
      'recordStageOutput',
      'finalizeCost',
    ] as const) {
      expect(
        getMethodMetadata<UserRole[]>(
          ROLES_KEY,
          ProductionController.prototype,
          method,
        ),
      ).toEqual(expected);
    }
  });

  it('استهلاك الخامة مقيّد بالإنتاج والمخزون والمدير العام', () => {
    expect(
      getMethodMetadata<UserRole[]>(
        ROLES_KEY,
        ProductionController.prototype,
        'consumeMaterial',
      ),
    ).toEqual([
      UserRole.PRODUCTION_MANAGER,
      UserRole.INVENTORY_MANAGER,
      UserRole.GENERAL_MANAGER,
    ]);
  });

  it('تحديث الحالة legacy مقيّد بـ PRODUCTION_MANAGER و GENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      ProductionController.prototype,
      'updateStatus',
    );
    expect(roles).toEqual([
      UserRole.PRODUCTION_MANAGER,
      UserRole.GENERAL_MANAGER,
    ]);
  });
});
