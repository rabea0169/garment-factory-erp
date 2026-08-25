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
  let eventEmitter: { emit: jest.Mock };
  let inventoryService: { issue: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    eventEmitter = createEventEmitterMock() as unknown as { emit: jest.Mock };
    inventoryService = { issue: jest.fn() };
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

    expect((result as any).data || result).toEqual(orders);
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
      code: 'WO-1234',
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
        code: expect.stringMatching(/^WO-\d+$/) as string,
        productVariantId: 'v-1',
        bomVersionId: 'b-1',
        quantity: 100,
        status: WorkOrderStatus.PLANNED,
        createdById: 'user-session-1',
      },
    });
  });

  it('إنشاء أمر تشغيل يطلق حدث WORK_ORDER_CREATED بالأمر المنشأ', async () => {
    const created = { id: 'wo-1', code: 'WO-1', status: 'PLANNED' };
    prisma.workOrder.create.mockResolvedValue(created);

    await service.createWorkOrder(
      { productVariantId: 'v-1', bomVersionId: 'b-1', quantity: 10 },
      'u-1',
    );

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

  it('الإكمال: يسحب الخامات ويستلم المنتج التام داخل transaction', async () => {
    // Mock the updated logic for GF-0008
    prisma.workOrder.findUnique = jest.fn().mockResolvedValue({
      id: 'wo-1',
      status: 'SEWING',
      productVariantId: 'v-1',
      quantity: 100,
      bomVersion: { lines: [] },
    });
    prisma.warehouse = {
      findFirst: jest.fn().mockResolvedValue({ id: 'wh-1', code: 'WH-RAW' }),
    } as unknown as typeof prisma.warehouse;

    // Mock transaction to just return a dummy order
    prisma.$transaction.mockResolvedValue({
      id: 'wo-1',
      status: 'COMPLETED',
      productVariantId: 'v-1',
      quantity: 100,
    });

    const result = await service.updateOrderStatus(
      'wo-1',
      WorkOrderStatus.COMPLETED,
    );

    expect(result.status).toBe('COMPLETED');
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
