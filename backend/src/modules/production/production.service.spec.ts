import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductionStage, WorkOrderStatus } from '@prisma/client';
import { ProductionService } from './production.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { WorkOrderQueryDto } from './dto/work-order-query.dto';
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
    // audit-WO-CANCEL: default = no stage runs / no consumptions.
    prisma.productionStageRun.count.mockResolvedValue(0);
    prisma.productionMaterialConsumption.count.mockResolvedValue(0);
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

  it('يجلب أوامر التشغيل بـ select نحيف (PRD-7) — ملخص فقط بلا stageUpdates/BOM', async () => {
    const orders = [
      {
        id: 'wo-1',
        code: 'WO-1',
        status: WorkOrderStatus.IN_PROGRESS,
        currentStage: ProductionStage.SEWING,
        quantity: 100,
        createdAt: new Date('2026-08-30T10:00:00.000Z'),
        variant: {
          id: 'v-1',
          size: 'M',
          color: 'أزرق',
          product: { id: 'p-1', code: 'PRD-1', name: 'تيشيرت' },
        },
      },
    ];
    prisma.workOrder.findMany.mockResolvedValue(orders);
    prisma.workOrder.count.mockResolvedValue(1);

    const result = await service.getAllWorkOrders({});

    expect(result.data).toEqual(orders);
    expect(prisma.workOrder.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 20,
      where: {},
      select: {
        id: true,
        code: true,
        status: true,
        currentStage: true,
        quantity: true,
        createdAt: true,
        variant: {
          select: {
            id: true,
            size: true,
            color: true,
            product: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // count بنفس where الفارغة
    expect(prisma.workOrder.count).toHaveBeenCalledWith({ where: {} });
  });

  // ============ PRD-7: فلاتر القائمة ============

  it('PRD-7: يطبّق status وcurrentStage وfrom/to في where نفسها للقائمة والعدّ', async () => {
    prisma.workOrder.findMany.mockResolvedValue([]);
    prisma.workOrder.count.mockResolvedValue(0);

    const query: WorkOrderQueryDto = {
      status: WorkOrderStatus.IN_PROGRESS,
      currentStage: ProductionStage.SEWING,
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.999Z',
      page: 1,
      limit: 20,
    };
    await service.getAllWorkOrders(query);

    const expectedWhere = {
      status: WorkOrderStatus.IN_PROGRESS,
      currentStage: ProductionStage.SEWING,
      createdAt: {
        gte: new Date(query.from as string),
        lte: new Date(query.to as string),
      },
    };
    expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 0, take: 20 }),
    );
    expect(prisma.workOrder.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });
  });

  it('PRD-7: تاريخ بداية بعد النهاية → 400 قبل أي استعلام', async () => {
    await expect(
      service.getAllWorkOrders({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('تاريخ بداية الفلاتر لا يمكن أن يكون بعد تاريخ النهاية');
    expect(prisma.workOrder.findMany).not.toHaveBeenCalled();
  });

  it('PRD-7: from فقط بلا to → شرط gte وحده (فترة مفتوحة)', async () => {
    prisma.workOrder.findMany.mockResolvedValue([]);
    prisma.workOrder.count.mockResolvedValue(0);

    await service.getAllWorkOrders({ from: '2026-08-01T00:00:00.000Z' });

    expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: new Date('2026-08-01T00:00:00.000Z') } },
      }),
    );
  });

  it('PRD-7: الاستدعاء بلا وسيطات يعمل (الافتراضي بلا فلاتر)', async () => {
    prisma.workOrder.findMany.mockResolvedValue([]);
    prisma.workOrder.count.mockResolvedValue(0);

    await service.getAllWorkOrders();

    expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, skip: 0, take: 20 }),
    );
  });

  // PRD-7/CC-6: قالب ListQueryDto المشترك — q يبحث في كود الأمر بcontains
  // غير حساس (الحقل النصي المعرف الوحيد في WorkOrder)
  it('PRD-7: q (قالب ListQueryDto) يبحث في كود الأمر بcontains غير حساس للقائمة والعدّ', async () => {
    prisma.workOrder.findMany.mockResolvedValue([]);
    prisma.workOrder.count.mockResolvedValue(0);

    await service.getAllWorkOrders({ q: 'wo-2026' });

    const expectedWhere = {
      code: { contains: 'wo-2026', mode: 'insensitive' as const },
    };
    expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 0, take: 20 }),
    );
    expect(prisma.workOrder.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });
  });

  it('PRD-7: q مع الفلاتر النوعية تتقاطع في where واحدة', async () => {
    prisma.workOrder.findMany.mockResolvedValue([]);
    prisma.workOrder.count.mockResolvedValue(0);

    await service.getAllWorkOrders({
      q: 'WO-9',
      status: WorkOrderStatus.PLANNED,
    });

    const expectedWhere = {
      status: WorkOrderStatus.PLANNED,
      code: { contains: 'WO-9', mode: 'insensitive' as const },
    };
    expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(prisma.workOrder.count).toHaveBeenCalledWith({
      where: expectedWhere,
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

  it('audit-WO-CANCEL: refuses CANCELLED from an active workflow status (IN_PROGRESS) — WIP protection', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.IN_PROGRESS,
    });

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.CANCELLED),
    ).rejects.toThrow(ConflictException);
    expect(prisma.workOrder.updateMany).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it('audit-WO-CANCEL: refuses CANCELLED even from PLANNED when stage runs or consumptions exist (defense-in-depth)', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.PLANNED,
    });
    prisma.productionStageRun.count.mockResolvedValue(2);
    prisma.productionMaterialConsumption.count.mockResolvedValue(3);

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.CANCELLED),
    ).rejects.toThrow(ConflictException);
    expect(prisma.workOrder.updateMany).not.toHaveBeenCalled();
  });
});
