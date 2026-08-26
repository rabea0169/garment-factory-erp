import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProductionService } from './production.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkOrderStatus } from '@prisma/client';

describe('GF-AUDIT-001C: Prevent old production status path bypass', () => {
  let service: ProductionService;

  const mockPrisma = {
    workOrder: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  mockPrisma.$transaction.mockImplementation(
    (cb: (prisma: any) => Promise<any>) => cb(mockPrisma),
  );

  const mockInventoryService = {
    issue: jest.fn(),
    receiveFinishedGood: jest.fn(),
  };

  const mockEventEmitter = {
    emitAsync: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<ProductionService>(ProductionService);
  });

  it('SHOULD NOT allow setting status to COMPLETED via legacy path (Bypass Check)', async () => {
    mockPrisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1',
      status: WorkOrderStatus.PLANNED,
      quantity: 10,
      code: 'WO-1',
      productVariantId: 'v-1',
      bomVersion: { lines: [] },
    });
    mockPrisma.warehouse.findFirst.mockResolvedValue({
      id: 'wh-1',
    });

    // This is what we want to prevent
    await expect(
      service.updateOrderStatus('wo-1', WorkOrderStatus.COMPLETED, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('SHOULD NOT allow modifying a COMPLETED work order (Immutability Check)', async () => {
    mockPrisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo-completed',
      status: WorkOrderStatus.COMPLETED,
    });

    await expect(
      service.updateOrderStatus(
        'wo-completed',
        WorkOrderStatus.CANCELLED,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
