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
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('الإكمال: يسحب الخامات ويستلم المنتج التام داخل transaction', async () => {
    // Mock the updated logic for GF-0008
    prisma.workOrder.findUnique = jest.fn().mockResolvedValue({
      id: 'wo-1',
      status: 'SEWING',
      productVariantId: 'v-1',
      quantity: 100,
      code: 'WO-1',
      bomVersion: { lines: [] },
    });
    prisma.warehouse = {
      findFirst: jest.fn().mockResolvedValue({ id: 'wh-1', code: 'WH-RAW' }),
    } as unknown as typeof prisma.warehouse;
    prisma.workOrder.update.mockResolvedValue({
      id: 'wo-1',
      status: 'COMPLETED',
      productVariantId: 'v-1',
      quantity: 100,
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    inventoryService.receiveFinishedGood.mockResolvedValue({
      replayed: false,
      entryCode: 'SLE-1',
      type: 'RECEIVE',
      rawMaterialId: '',
      warehouseId: 'wh-1',
      quantityDelta: 100,
      balanceAfter: 100,
      unitCost: 0,
      totalValue: 0,
      costPerUnitAfter: 0,
      createdAt: new Date().toISOString(),
    });

    const result = await service.updateOrderStatus(
      'wo-1',
      WorkOrderStatus.COMPLETED,
    );

    expect(result.status).toBe('COMPLETED');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(inventoryService.receiveFinishedGood).toHaveBeenCalledWith(
      expect.objectContaining({
        productVariantId: 'v-1',
        warehouseId: 'wh-1',
        quantity: 100,
      }),
      undefined,
      prisma,
    );
    expect(prisma.finishedGood.create).not.toHaveBeenCalled();
    expect(prisma.finishedGood.update).not.toHaveBeenCalled();
  });
});
