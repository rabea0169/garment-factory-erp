import { WorkOrderStatus } from '@prisma/client';
import { ProductionService } from './production.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createEventEmitterMock,
  createPrismaMock,
} from '../../../test/helpers/prisma-mock';
import { EVENTS } from '../../events/event-types';

describe('ProductionService — أوامر التشغيل (GF-0003)', () => {
  let service: ProductionService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    eventEmitter = createEventEmitterMock() as unknown as { emit: jest.Mock };
    service = new ProductionService(
      prisma as unknown as PrismaService,
      eventEmitter as never,
    );
  });

  it('يجلب أوامر التشغيل مع المنتج وتحديثات المراحل', async () => {
    const orders = [{ id: 'wo-1', product: {}, stageUpdates: [] }];
    prisma.workOrder.findMany.mockResolvedValue(orders);

    const result = await service.getAllWorkOrders();

    expect(result).toEqual(orders);
    expect(prisma.workOrder.findMany).toHaveBeenCalledWith({
      include: { product: true, stageUpdates: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('إنشاء أمر تشغيل: حالة PLANNED و code فريد ومنشئه من الجلسة (creatorId)', async () => {
    const created = {
      id: 'wo-1',
      code: 'WO-1234',
      productId: 'p-1',
      quantity: 100,
      status: 'PLANNED',
      createdById: 'user-session-1',
    };
    prisma.workOrder.create.mockResolvedValue(created);

    const result = await service.createWorkOrder(
      { productId: 'p-1', quantity: 100 },
      'user-session-1',
    );

    expect(result.status).toBe('PLANNED');
    expect(prisma.workOrder.create).toHaveBeenCalledWith({
      data: {
        code: expect.stringMatching(/^WO-\d+$/) as string,
        productId: 'p-1',
        quantity: 100,
        status: WorkOrderStatus.PLANNED,
        createdById: 'user-session-1',
      },
    });
  });

  it('إنشاء أمر تشغيل يطلق حدث WORK_ORDER_CREATED بالأمر المنشأ', async () => {
    const created = { id: 'wo-1', code: 'WO-1', status: 'PLANNED' };
    prisma.workOrder.create.mockResolvedValue(created);

    await service.createWorkOrder({ productId: 'p-1', quantity: 10 }, 'u-1');

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      EVENTS.WORK_ORDER_CREATED,
      created,
    );
  });

  it('تحديث حالة غير مكتملة: يحدّث فقط دون لمس المنتج التام ولا أحداث إكمال', async () => {
    prisma.workOrder.update.mockResolvedValue({
      id: 'wo-1',
      status: 'SEWING',
      productId: 'p-1',
      quantity: 100,
    });

    await service.updateOrderStatus('wo-1', WorkOrderStatus.SEWING);

    expect(prisma.workOrder.update).toHaveBeenCalledWith({
      where: { id: 'wo-1' },
      data: { status: 'SEWING' },
    });
    expect(prisma.finishedGood.create).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('الإكمال: يحدّث الحالة وينشئ منتجًا تامًا بأول variant بكمية الأمر ويطلق حدث الإكمال', async () => {
    prisma.workOrder.update.mockResolvedValue({
      id: 'wo-1',
      status: 'COMPLETED',
      productId: 'p-1',
      quantity: 100,
    });
    prisma.productVariant.findFirst.mockResolvedValue({ id: 'v-1' });

    const result = await service.updateOrderStatus(
      'wo-1',
      WorkOrderStatus.COMPLETED,
    );

    expect(result.status).toBe('COMPLETED');
    expect(prisma.finishedGood.create).toHaveBeenCalledWith({
      data: { productVariantId: 'v-1', quantity: 100 },
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      EVENTS.WORK_ORDER_COMPLETED,
      {
        id: 'wo-1',
        status: 'COMPLETED',
        productId: 'p-1',
        quantity: 100,
      },
    );
  });

  it('الإكمال بدون variant للمنتج: لا ينشئ منتجًا تامًا (سلوك حالي موثق — يُعالج في GF-0008)', async () => {
    prisma.workOrder.update.mockResolvedValue({
      id: 'wo-2',
      status: 'COMPLETED',
      productId: 'p-no-variants',
      quantity: 10,
    });
    prisma.productVariant.findFirst.mockResolvedValue(null);

    await service.updateOrderStatus('wo-2', WorkOrderStatus.COMPLETED);

    expect(prisma.finishedGood.create).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      EVENTS.WORK_ORDER_COMPLETED,
      expect.anything(),
    );
  });
});
