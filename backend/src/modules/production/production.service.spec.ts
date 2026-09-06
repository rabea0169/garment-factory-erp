import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkOrderStatus } from '@prisma/client';
import { ProductionService } from './production.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * مواصفة موسّعة محليًا (نمط inventory.service.spec): PRD-2 يحتاج
 * workOrder.updateMany (تحديث CAS المشروط بالحالة) فوق مصنع الـ mock
 * المشترك.
 */
type ProductionPrismaMock = ReturnType<typeof createPrismaMock> & {
  workOrder: ReturnType<typeof createPrismaMock>['workOrder'] & {
    updateMany: jest.Mock;
  };
};

function createProductionPrismaMock(): ProductionPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
    workOrder: { ...base.workOrder, updateMany: jest.fn() },
  };
}

describe('ProductionService — أوامر التشغيل (GF-0003)', () => {
  let service: ProductionService;
  let prisma: ProductionPrismaMock;
  let inventoryService: {
    issue: jest.Mock;
    receiveFinishedGood: jest.Mock;
  };
  /** CC-8: جاسوس على بث أي حدث من هذا المسار — لا مستمعين فلا بث مطلقًا. */
  let emitSpy: jest.SpyInstance;

  beforeEach(() => {
    prisma = createProductionPrismaMock();
    inventoryService = {
      issue: jest.fn(),
      receiveFinishedGood: jest.fn(),
    };
    // RES-F02: make $transaction invoke the callback with prisma mock.
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    // PRD-2: الافتراضي CAS ينجح (صف واحد مُحدَّث).
    prisma.workOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.activityLog.create.mockResolvedValue({});
    emitSpy = jest
      .spyOn(EventEmitter2.prototype, 'emitAsync')
      .mockResolvedValue([]);
    service = new ProductionService(
      prisma as unknown as PrismaService,
      inventoryService as unknown as InventoryService,
    );
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  it('يجلب أوامر التشغيل مع المنتج وتحديثات المراحل', async () => {
    const orders = [
      { id: 'wo-1', variant: {}, bomVersion: {}, stageUpdates: [] },
    ];
    prisma.workOrder.findMany.mockResolvedValue(orders);

    const result = await service.getAllWorkOrders({});

    expect(result.data).toEqual(orders);
    expect(prisma.workOrder.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 20,
      include: {
        variant: { include: { product: true } },
        bomVersion: true,
        stageUpdates: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('إنشاء أمر تشغيل: حالة PLANNED و code فريد ومنشئه من الجلسة (creatorId)', async () => {
    const created = {
      id: 'wo-1',
      code: 'WO-20260101-ABCD1234',
      productVariantId: 'v-1',
      bomVersionId: 'b-1',
      quantity: 100,
      status: 'PLANNED',
      createdById: 'user-session-1',
    };
    prisma.workOrder.create.mockResolvedValue(created);

    const result = await service.createWorkOrder(
      { productVariantId: 'v-1', bomVersionId: 'b-1', quantity: 100 },
      'user-session-1',
    );

    expect(result.status).toBe('PLANNED');
    expect(prisma.workOrder.create).toHaveBeenCalledWith({
      data: {
        code: expect.stringMatching(/^WO-\d{8}-[0-9A-F]{8}$/) as string,
        productVariantId: 'v-1',
        bomVersionId: 'b-1',
        quantity: 100,
        status: WorkOrderStatus.PLANNED,
        createdById: 'user-session-1',
      },
    });
  });

  // CC-8: حدث WORK_ORDER_CREATED حُذف (بلا أي مستمع في المستودع كله) —
  // الاختبار يتحقق من عدم البث بدلًا من البث.
  it('CC-8: إنشاء أمر تشغيل لا يبث أي حدث (لا مستمعين — الحدث الميت حُذف)', async () => {
    prisma.workOrder.create.mockResolvedValue({
      id: 'wo-1',
      code: 'WO-20260101-ABCD1234',
      status: 'PLANNED',
    });

    await service.createWorkOrder(
      { productVariantId: 'v-1', bomVersionId: 'b-1', quantity: 10 },
      'u-1',
    );

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('PRD-2: تحديث حالة مسموحة (CANCELLED): CAS مشروط بالحالة المقروءة + تدقيق الفاعل', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      code: 'WO-1',
      status: WorkOrderStatus.PLANNED,
      quantity: 10,
    });

    const result = await service.updateOrderStatus(
      'wo-1',
      WorkOrderStatus.CANCELLED,
      'user-42',
    );

    // القراءة والكتابة داخل معاملة واحدة
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.workOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'wo-1', status: WorkOrderStatus.PLANNED },
      data: { status: WorkOrderStatus.CANCELLED },
    });
    expect(result.status).toBe(WorkOrderStatus.CANCELLED);
    // كتابة التدقيق بالفاعل الفعلي مع الحالة قبل/بعد
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-42',
        action: 'WORK_ORDER_STATUS_UPDATED',
        module: 'production',
        details: {
          workOrderId: 'wo-1',
          fromStatus: WorkOrderStatus.PLANNED,
          toStatus: WorkOrderStatus.CANCELLED,
        },
      },
    });
    // CC-8: حدث الإلغاء الميت حُذف — لا بث
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('PRD-2: تعارض CAS — تغيّرت الحالة بالتوازي → 409 لا كتابة ولا تدقيق', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      code: 'WO-1',
      status: WorkOrderStatus.PLANNED,
      quantity: 10,
    });
    // طلب متوازٍ غيّر الحالة أولًا — CAS يحدّث صفر صفوف
    prisma.workOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.CANCELLED, 'user-42'),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.CANCELLED, 'user-42'),
    ).rejects.toThrow('تغيرت حالة أمر التشغيل أثناء التحديث');
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it('PRD-2: بلا فاعل (استدعاء داخلي قديم) يُحدَّث بلا سجل تدقيق', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      code: 'WO-1',
      status: WorkOrderStatus.PLANNED,
      quantity: 10,
    });

    const result = await service.updateOrderStatus(
      'wo-1',
      WorkOrderStatus.CANCELLED,
    );

    expect(result.status).toBe(WorkOrderStatus.CANCELLED);
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it('يمنع الانتقال المباشر إلى COMPLETED', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.PLANNED,
    });

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.COMPLETED),
    ).rejects.toThrow(
      'Direct completion is disabled. Use ProductionWorkflowService stages (PACKING) to complete production.',
    );
    expect(prisma.workOrder.updateMany).not.toHaveBeenCalled();
  });

  it('يمنع الانتقال المباشر إلى حالات الـ workflow (مثل SEWING)', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.PLANNED,
    });

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.SEWING),
    ).rejects.toThrow(
      'Direct transition to SEWING is disabled. Use ProductionWorkflowService.transitionStage instead.',
    );
    expect(prisma.workOrder.updateMany).not.toHaveBeenCalled();
  });

  it('يمنع تعديل أمر تشغيل مكتمل (Immutability)', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.COMPLETED,
    });

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.CANCELLED),
    ).rejects.toThrow(
      'Completed work orders are immutable. Use approved reversal workflows if needed.',
    );
    expect(prisma.workOrder.updateMany).not.toHaveBeenCalled();
  });
});
