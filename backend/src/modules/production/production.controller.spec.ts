import 'reflect-metadata';
import { UserRole, WorkOrderStatus } from '@prisma/client';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';

describe('ProductionController — هوية الجلسة والصلاحيات (GF-0003)', () => {
  let controller: ProductionController;
  let service: {
    getAllWorkOrders: jest.Mock;
    createWorkOrder: jest.Mock;
    updateOrderStatus: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getAllWorkOrders: jest.fn().mockResolvedValue([]),
      createWorkOrder: jest.fn().mockResolvedValue({ id: 'wo-1' }),
      updateOrderStatus: jest.fn().mockResolvedValue({ id: 'wo-1' }),
    };
    controller = new ProductionController(
      service as unknown as ProductionService,
    );
  });

  it('إنشاء أمر تشغيل يمرر هوية الجلسة (من @CurrentUser) كمعامل مستقل', async () => {
    const body = {
      productVariantId: 'v-1',
      bomVersionId: 'b-1',
      quantity: 100,
    };
    // محاولة حقن creatorId داخل body — الخدمة تتجاهله لأنها تستخدم
    // معامل الهوية المستقل القادم من الجلسة (مثبت سلوكيًا في e2e:
    // HACKED-ID لا يُحفظ في قاعدة البيانات)
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

  it('تحديث حالة يمرر (id, status) كما وردا', async () => {
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

  it('تحديث الحالة مقيّد بـ PRODUCTION_MANAGER فقط', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      ProductionController.prototype,
      'updateStatus',
    );
    expect(roles).toEqual([UserRole.PRODUCTION_MANAGER]);
  });
});
