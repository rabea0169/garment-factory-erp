import { Test, TestingModule } from '@nestjs/testing';
import { ProductionService } from './production.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkOrderStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
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

  beforeEach(async () => {
    prisma = createPrismaMock();
    eventEmitter = createEventEmitterMock() as unknown as {
      emitAsync: jest.Mock;
    };
    inventoryService = {
      issue: jest.fn(),
      receiveFinishedGood: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: inventoryService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<ProductionService>(ProductionService);
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

  it('تحديث حالة مسموحة (CANCELLED): يحدّث ويطلق حدث الإلغاء', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.PLANNED,
    });
    prisma.workOrder.update.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.CANCELLED,
    });

    await service.updateOrderStatus('wo-1', WorkOrderStatus.CANCELLED);

    expect(prisma.workOrder.update).toHaveBeenCalledWith({
      where: { id: 'wo-1' },
      data: { status: WorkOrderStatus.CANCELLED },
    });
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      EVENTS.WORK_ORDER_CANCELLED,
      expect.any(Object),
    );
  });

  it('يمنع الانتقال المباشر إلى COMPLETED (Bypass Prevention)', async () => {
    prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.PLANNED,
    });

    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.COMPLETED),
    ).rejects.toThrow(
      'Direct completion is disabled. Use ProductionWorkflowService stages (PACKING) to complete production.',
    );
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
  });

  it('يرفع NotFoundException إذا كان أمر التشغيل غير موجود', async () => {
    prisma.workOrder.findUnique.mockResolvedValue(null);

    await expect(
      service.updateOrderStatus('non-existent', WorkOrderStatus.CANCELLED),
    ).rejects.toThrow(NotFoundException);
  });
});
