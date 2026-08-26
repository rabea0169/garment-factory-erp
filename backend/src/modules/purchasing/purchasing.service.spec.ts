/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { PurchasingService } from './purchasing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { PaymentType, PurchaseOrderStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('PurchasingService (GF-0009)', () => {
  let service: PurchasingService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let inventoryService: { receive: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();

    inventoryService = { receive: jest.fn() };
    prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });

    service = new PurchasingService(
      prisma as unknown as PrismaService,
      inventoryService as unknown as InventoryService,
    );
  });

  describe('createPurchaseOrder', () => {
    it('should create order and items', async () => {
      const dto = {
        supplierId: 'sup-1',
        paymentType: PaymentType.CASH,
        items: [{ rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 }],
      };

      prisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1', ...dto });

      const res = await service.createPurchaseOrder(dto, 'user-1');
      expect(res.id).toBe('po-1');

      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            status: PurchaseOrderStatus.DRAFT,
            totalAmount: 50,
          }),
        }),
      );
    });
  });

  describe('createReceipt', () => {
    it('ينشئ إذن استلام جزئيًا ويرسل الكمية المستلمة فقط إلى المخزون', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.PENDING,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([]);
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.$transaction.mockImplementation(async (cb) => cb(prisma));
      prisma.purchaseReceipt.create.mockResolvedValue({
        id: 'grn-1',
        code: 'GRN-100',
        items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }],
      });
      prisma.purchaseOrder.update.mockResolvedValue({
        status: PurchaseOrderStatus.PENDING,
      });

      const result = await service.createReceipt(
        'po-1',
        { items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }] },
        'user-1',
      );

      expect(result.id).toBe('grn-1');
      expect(inventoryService.receive).toHaveBeenCalledWith(
        expect.objectContaining({ rawMaterialId: 'rm-1', quantity: 4 }),
        'user-1',
        prisma,
      );
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: { status: PurchaseOrderStatus.PENDING },
      });
    });

    it('يرفض الاستلام الذي يتجاوز كمية أمر الشراء', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        status: PurchaseOrderStatus.PENDING,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([]);

      await expect(
        service.createReceipt(
          'po-1',
          { items: [{ purchaseOrderItemId: 'poi-1', quantity: 11 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
    });
  });

  describe('receiveOrder', () => {
    it('should throw if order already received', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        status: PurchaseOrderStatus.RECEIVED,
        items: [],
      });
      await expect(service.receiveOrder('po-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should receive items via InventoryService within a transaction', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.PENDING,
        items: [{ rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 }],
      });
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.$transaction.mockImplementation(async (cb) => {
        return cb(prisma); // Pass mocked prisma as tx
      });
      prisma.purchaseOrder.update.mockResolvedValue({ code: 'PO-100' });

      await service.receiveOrder('po-1', 'user-1');

      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: { status: PurchaseOrderStatus.RECEIVED },
      });
      expect(inventoryService.receive).toHaveBeenCalledWith(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-raw',
          quantity: 10,
          unitCost: 5,
          reference: 'PO-100',
          notes: expect.any(String),
        },
        'user-1',
        prisma,
      );
    });
  });
});
