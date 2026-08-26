import { Test, TestingModule } from '@nestjs/testing';
import { PurchasingService } from './purchasing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { PurchaseOrderStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

describe('PurchasingService Audit (GF-AUDIT-001D)', () => {
  let service: PurchasingService;
  let prismaMock: DeepMockProxy<PrismaService>;
  let inventoryMock: DeepMockProxy<InventoryService>;
  let financialMock: DeepMockProxy<FinancialPostingService>;

  beforeEach(async () => {
    prismaMock = mockDeep<PrismaService>();
    inventoryMock = mockDeep<InventoryService>();
    financialMock = mockDeep<FinancialPostingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasingService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: InventoryService, useValue: inventoryMock },
        { provide: FinancialPostingService, useValue: financialMock },
      ],
    }).compile();

    service = module.get<PurchasingService>(PurchasingService);

    jest.clearAllMocks();
  });

  describe('receiveOrder (Legacy Redirect)', () => {
    it('should redirect to createReceipt with remaining quantities', async () => {
      const orderId = 'order-1';
      const order = {
        id: orderId,
        code: 'PO-001',
        items: [
          {
            id: 'item-1',
            quantity: 10,
            rawMaterialId: 'rm-1',
            unitCost: 5,
          },
        ],
      };

      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
      (prismaMock.purchaseOrder.findUnique as any).mockResolvedValue(order);
      (prismaMock.purchaseReceiptItem.findMany as any).mockResolvedValue([
        { purchaseOrderItemId: 'item-1', quantity: 4 },
      ]);
      (prismaMock.warehouse.findFirst as any).mockResolvedValue({
        id: 'wh-1',
        code: 'WH-RAW',
      });

      (prismaMock.idempotencyKey.findUnique as any).mockResolvedValue(null);
      (prismaMock.idempotencyKey.create as any).mockResolvedValue({
        id: 'idem-1',
      });
      (prismaMock.purchaseReceipt.create as any).mockResolvedValue({
        id: 'rcpt-1',
        code: 'PR-001',
      });

      prismaMock.$transaction.mockImplementation(
        async (cb: any) => await cb(prismaMock),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

      await service.receiveOrder(orderId, 'user-1');

      /* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(inventoryMock.receive).toHaveBeenCalled();
      const calls = (inventoryMock.receive as any).mock.calls;
      const firstCall = calls[0] as any[];
      const input = firstCall[0];
      const userId = firstCall[1];
      const tx = firstCall[2];
      expect(input).toMatchObject({ quantity: 6 });
      /* eslint-enable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(userId).toBe('user-1');
      expect(tx).toBeDefined();
    });

    it('should throw if all items already received', async () => {
      const orderId = 'order-1';
      const order = {
        id: orderId,
        items: [{ id: 'item-1', quantity: 10 }],
      };
      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
      (prismaMock.purchaseOrder.findUnique as any).mockResolvedValue(order);
      (prismaMock.purchaseReceiptItem.findMany as any).mockResolvedValue([
        { purchaseOrderItemId: 'item-1', quantity: 10 },
      ]);
      /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

      await expect(service.receiveOrder(orderId, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('returnToSupplier', () => {
    it('should prevent returning more than received', async () => {
      const orderId = 'order-1';
      const itemId = 'item-1';
      const order = {
        id: orderId,
        code: 'PO-001',
        status: PurchaseOrderStatus.RECEIVED,
        items: [{ id: itemId, rawMaterialId: 'rm-1' }],
      };
      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
      (prismaMock.purchaseOrder.findUnique as any).mockResolvedValue(order);
      (prismaMock.warehouse.findFirst as any).mockResolvedValue({
        id: 'wh-1',
        code: 'WH-RAW',
      });

      (prismaMock.purchaseReceiptItem.aggregate as any).mockResolvedValue({
        _sum: { quantity: 10 },
      });
      (prismaMock.stockLedgerEntry.aggregate as any).mockResolvedValue({
        _sum: { quantityDelta: -8 },
      });

      prismaMock.$transaction.mockImplementation(
        async (cb: any) => await cb(prismaMock),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

      await expect(
        service.returnToSupplier(
          orderId,
          { purchaseOrderItemId: itemId, quantity: 3 },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should process return if within limits', async () => {
      const orderId = 'order-1';
      const itemId = 'item-1';
      const order = {
        id: orderId,
        code: 'PO-001',
        status: PurchaseOrderStatus.RECEIVED,
        items: [{ id: itemId, rawMaterialId: 'rm-1' }],
      };
      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
      (prismaMock.purchaseOrder.findUnique as any).mockResolvedValue(order);
      (prismaMock.warehouse.findFirst as any).mockResolvedValue({
        id: 'wh-1',
        code: 'WH-RAW',
      });

      (prismaMock.purchaseReceiptItem.aggregate as any).mockResolvedValue({
        _sum: { quantity: 10 },
      });
      (prismaMock.stockLedgerEntry.aggregate as any).mockResolvedValue({
        _sum: { quantityDelta: -5 },
      });
      (inventoryMock.issue as any).mockResolvedValue({ entryCode: 'SLE-001' });

      prismaMock.$transaction.mockImplementation(
        async (cb: any) => await cb(prismaMock),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

      const result = await service.returnToSupplier(
        orderId,
        { purchaseOrderItemId: itemId, quantity: 2 },
        'user-1',
      );

      expect(result).toMatchObject({ success: true });
      /* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(inventoryMock.issue).toHaveBeenCalled();
      const calls = (inventoryMock.issue as any).mock.calls;
      const firstCall = calls[0] as any[];
      const input = firstCall[0];
      const userId = firstCall[1];
      const tx = firstCall[2];
      expect(input).toMatchObject({
        quantity: 2,
        reference: expect.stringContaining(`PURCHASE_RETURN_ITEM:${itemId}`),
      });
      /* eslint-enable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
      expect(userId).toBe('user-1');
      expect(tx).toBeDefined();
    });
  });
});
