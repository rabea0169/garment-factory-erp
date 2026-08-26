import { WorkOrderStatus } from '@prisma/client';
import { ProductionService } from './production.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  createEventEmitterMock,
  createPrismaMock,
} from '../../../test/helpers/prisma-mock';
import { EVENTS } from '../../events/event-types';

describe('ProductionService — أوامر التشغيل (GF-0003)', () => {
  let service: ProductionService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let eventEmitter: { emitAsync: jest.Mock };
  let inventoryService: {
    issue: jest.Mock;
    receiveFinishedGood: jest.Mock;
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    inventoryService = {
      issue: jest.fn(),
      receiveFinishedGood: jest.fn(),
    };
    service = new ProductionService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
      inventoryService as unknown as InventoryService,
    );
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

  it('إنشاء أمر تشغيل يطلق حدث WORK_ORDER_CREATED بالأمر المنشأ', async () => {
    const created = {
      id: 'wo-1',
      code: 'WO-20260101-ABCD1234',
      status: 'PLANNED',
    };
    prisma.workOrder.create.mockResolvedValue(created);

    await service.createWorkOrder(
      { productVariantId: 'v-1', bomVersionId: 'b-1', quantity: 10 },
      'u-1',
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      EVENTS.WORK_ORDER_CREATED,
      created,
    );
  });

  it('تحديث الحالة لـ CANCELLED: يسمح به ويطلق حدث الإلغاء', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: 'PLANNED',
    });
    prisma.workOrder.update.mockResolvedValue({
      id: 'wo-1',
      status: 'CANCELLED',
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    const result = await service.updateOrderStatus(
      'wo-1',
      WorkOrderStatus.CANCELLED,
    );

    expect(result.status).toBe('CANCELLED');
    expect(prisma.workOrder.update).toHaveBeenCalledWith({
      where: { id: 'wo-1' },
      data: { status: 'CANCELLED' },
    });
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      EVENTS.WORK_ORDER_CANCELLED,
      expect.anything(),
    );
  });

  it('idempotency: العودة بنجاح إذا كان الأمر ملغى بالفعل دون تكرار الحدث', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: 'CANCELLED',
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    const result = await service.updateOrderStatus(
      'wo-1',
      WorkOrderStatus.CANCELLED,
    );

    expect(result.status).toBe('CANCELLED');
    expect(prisma.workOrder.update).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalledWith(
      EVENTS.WORK_ORDER_CANCELLED,
      expect.anything(),
    );
  });

  it('منع الإكمال المباشر: يرفض التحديث لـ COMPLETED', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: 'PLANNED',
    });

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.COMPLETED),
    ).rejects.toThrow(
      'Work orders must be completed via the production workflow',
    );
  });

  it('منع تعديل المكتمل: يرفض أي تحديث إذا كانت الحالة الحالية COMPLETED', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: 'COMPLETED',
    });

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.CANCELLED),
    ).rejects.toThrow('Work order is already completed');
  });

  it('منع الحالات القديمة: يرفض التحديث لحالات مثل SEWING', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: 'PLANNED',
    });

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.SEWING),
    ).rejects.toThrow('is deprecated for direct updates');
  });
});
