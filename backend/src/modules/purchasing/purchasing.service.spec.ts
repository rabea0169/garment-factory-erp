/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { PurchasingService } from './purchasing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { PaymentType, PurchaseOrderStatus } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { computeRequestHash } from '../../core/common/idempotency.util';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';

describe('PurchasingService (GF-0009)', () => {
  let service: PurchasingService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let inventoryService: { receive: jest.Mock; return: jest.Mock };
  let financialPosting: { postJournalEntryInTx: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();

    inventoryService = { receive: jest.fn(), return: jest.fn() };
    financialPosting = { postJournalEntryInTx: jest.fn() };
    prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });

    service = new PurchasingService(
      prisma as unknown as PrismaService,
      inventoryService as unknown as InventoryService,
      financialPosting as unknown as FinancialPostingService,
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

      expect((result as { id: string }).id).toBe('grn-1');
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

    it('يربط Idempotency-Key بإذن الاستلام ويخزن الاستجابة داخل transaction', async () => {
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
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
      prisma.purchaseReceipt.create.mockResolvedValue({
        id: 'grn-1',
        code: 'GRN-100',
        items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }],
      });
      prisma.purchaseOrder.update.mockResolvedValue({
        status: PurchaseOrderStatus.PENDING,
      });

      await service.createReceipt(
        'po-1',
        { items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }] },
        'user-1',
        'receipt-key',
      );

      expect(prisma.idempotencyKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: 'receipt-key',
          scope: 'purchasing-receipt-create',
        }),
        select: { id: true },
      });
      expect(prisma.purchaseReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ idempotencyKeyId: 'idem-1' }),
        include: { items: true },
      });
      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith({
        where: { key: 'receipt-key' },
        data: { response: expect.anything() },
      });
    });

    it('يعيد replay لإذن الاستلام دون إنشاء receipt جديد', async () => {
      const dto = { items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }] };
      const key = 'receipt-replay-key';
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key,
        scope: 'purchasing-receipt-create',
        requestHash: computeRequestHash({
          orderId: 'po-1',
          items: dto.items,
          notes: null,
          userId: 'user-1',
        }),
        response: { id: 'grn-1', code: 'GRN-100' },
      });

      const result = await service.createReceipt('po-1', dto, 'user-1', key);

      expect(result).toEqual({
        id: 'grn-1',
        code: 'GRN-100',
        replayed: true,
      });
      expect(prisma.purchaseOrder.findUnique).not.toHaveBeenCalled();
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
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

  describe('receiveOrder (Legacy)', () => {
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

    it('should receive all remaining items via createReceipt', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.PENDING,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([
        { purchaseOrderItemId: 'poi-1', quantity: 4 },
      ]);
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.$transaction.mockImplementation(async (cb) => cb(prisma));
      prisma.purchaseReceipt.create.mockResolvedValue({
        id: 'grn-full',
        code: 'GRN-FULL',
      });
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1' });

      await service.receiveOrder('po-1', 'user-1');

      // Should call createReceipt with quantity 6 (10 - 4)
      expect(inventoryService.receive).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 6 }),
        'user-1',
        prisma,
      );
    });
  });

  describe('returnToSupplier', () => {
    it('should throw if item not found in order', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        items: [{ id: 'poi-1' }],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([]);
      prisma.stockLedgerEntry.findMany.mockResolvedValue([]);

      await expect(
        service.returnToSupplier(
          'po-1',
          { items: [{ purchaseOrderItemId: 'poi-unknown', quantity: 1 }] },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if return quantity exceeds net received', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        items: [{ id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10 }],
      });
      // Received 5, Returned 2 -> Net 3. Trying to return 4 should fail.
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([
        { purchaseOrderItemId: 'poi-1', quantity: 5 },
      ]);
      prisma.stockLedgerEntry.findMany.mockResolvedValue([
        { reference: 'RET-PO-100-poi-1', quantityDelta: -2 },
      ]);

      await expect(
        service.returnToSupplier(
          'po-1',
          { items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should process return and post to financial within transaction', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        supplierId: 'sup-1',
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([
        { purchaseOrderItemId: 'poi-1', quantity: 10 },
      ]);
      prisma.stockLedgerEntry.findMany.mockResolvedValue([]);
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.$transaction.mockImplementation(async (cb) => cb(prisma));
      prisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1' });

      const result = await service.returnToSupplier(
        'po-1',
        { items: [{ purchaseOrderItemId: 'poi-1', quantity: 2 }] },
        'user-1',
      );

      expect(result.success).toBe(true);
      expect(inventoryService.return).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 2,
          reference: 'RET-PO-100-poi-1',
        }),
        'user-1',
        prisma,
      );
      expect(financialPosting.postJournalEntryInTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          description: expect.stringContaining('مرتجع'),
          supplierUpdates: [{ supplierId: 'sup-1', delta: -10 }], // 2 * 5 = 10
        }),
        'user-1',
      );
    });

    it('should handle idempotency for returns', async () => {
      const dto = { items: [{ purchaseOrderItemId: 'poi-1', quantity: 2 }] };
      const key = 'return-key';
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key,
        scope: 'purchasing-return-create',
        requestHash: computeRequestHash({
          orderId: 'po-1',
          items: dto.items,
          notes: null,
          userId: 'user-1',
        }),
        response: { success: true, replayed: true },
      });

      const result = await service.returnToSupplier('po-1', dto, 'user-1', key);

      expect(result.replayed).toBe(true);
      expect(prisma.purchaseOrder.findUnique).not.toHaveBeenCalled();
      expect(inventoryService.return).not.toHaveBeenCalled();
    });
  });
});
