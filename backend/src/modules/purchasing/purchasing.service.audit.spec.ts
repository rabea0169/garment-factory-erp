/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { PurchasingService } from './purchasing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { PurchaseOrderStatus } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('PurchasingService Audit (GF-AUDIT-001D)', () => {
  let service: PurchasingService;
  let prisma: PrismaService;
  let inventory: InventoryService;

  const mockPrisma = {
    purchaseOrder: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    purchaseReceiptItem: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn(),
    },
    stockLedgerEntry: {
      aggregate: jest.fn(),
    },
    idempotencyKey: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    // SEC-F02: createReceipt writes an ActivityLog entry inside the same tx.
    activityLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'order-1' }]),
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  const mockInventory = {
    receive: jest.fn(),
    issue: jest.fn(),
  };

  const mockFinancial = {
    postJournalEntryInTx: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InventoryService, useValue: mockInventory },
        { provide: FinancialPostingService, useValue: mockFinancial },
      ],
    }).compile();

    service = module.get<PurchasingService>(PurchasingService);
    prisma = module.get<PrismaService>(PrismaService);
    inventory = module.get<InventoryService>(InventoryService);
  });

  describe('receiveOrder (Legacy Redirect)', () => {
    it('should redirect to createReceipt with remaining quantities', async () => {
      const orderId = 'order-1';
      const order = {
        id: orderId,
        code: 'PO-001',
        // PUR-5 (أ): الاستلام على APPROVED فقط (كانت الحالة غير مضبوطة)
        status: PurchaseOrderStatus.APPROVED,
        items: [
          { id: 'item-1', quantity: 10, rawMaterialId: 'rm-1', unitCost: 5 },
        ],
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);
      mockPrisma.purchaseReceiptItem.findMany.mockResolvedValue([
        { purchaseOrderItemId: 'item-1', quantity: 4 },
      ]);
      mockPrisma.warehouse.findFirst.mockResolvedValue({
        id: 'wh-1',
        code: 'WH-RAW',
      });

      // Mock createReceipt behavior indirectly by mocking its internal calls
      mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
      mockPrisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
      mockPrisma.purchaseReceipt = {
        create: jest.fn().mockResolvedValue({ id: 'rcpt-1', code: 'PR-001' }),
      };

      await service.receiveOrder(orderId, 'user-1');

      // Should have called createReceipt logic with quantity 6 (10 - 4)
      expect(mockInventory.receive).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 6 }),
        'user-1',
        expect.anything(),
      );
    });

    it('should throw if all items already received', async () => {
      const orderId = 'order-1';
      const order = {
        id: orderId,
        // PUR-5 (أ): أمر معتمد وكل بنوده مستلمة — نصل إلى فحص «All items
        // are already received» نفسه (لو كانت RECEIVED لسبقه فحص أسبق)
        status: PurchaseOrderStatus.APPROVED,
        items: [{ id: 'item-1', quantity: 10 }],
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);
      mockPrisma.purchaseReceiptItem.findMany.mockResolvedValue([
        { purchaseOrderItemId: 'item-1', quantity: 10 },
      ]);

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
        status: PurchaseOrderStatus.RECEIVED,
        items: [{ id: itemId, rawMaterialId: 'rm-1' }],
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);
      mockPrisma.warehouse.findFirst.mockResolvedValue({
        id: 'wh-1',
        code: 'WH-RAW',
      });

      // Mock 10 received
      mockPrisma.purchaseReceiptItem.aggregate.mockResolvedValue({
        _sum: { quantity: 10 },
      });
      // Mock 8 already returned
      mockPrisma.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: -8 },
      });

      // Try to return 3 (8 + 3 = 11 > 10)
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
        status: PurchaseOrderStatus.RECEIVED,
        items: [{ id: itemId, rawMaterialId: 'rm-1' }],
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);
      mockPrisma.warehouse.findFirst.mockResolvedValue({
        id: 'wh-1',
        code: 'WH-RAW',
      });

      // Mock 10 received, 5 returned
      mockPrisma.purchaseReceiptItem.aggregate.mockResolvedValue({
        _sum: { quantity: 10 },
      });
      mockPrisma.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: -5 },
      });
      mockInventory.issue.mockResolvedValue({ entryCode: 'SLE-001' });

      const result = (await service.returnToSupplier(
        orderId,
        { purchaseOrderItemId: itemId, quantity: 2 },
        'user-1',
      )) as any;

      expect(result.success).toBe(true);
      expect(mockInventory.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 2,
          reference: expect.stringContaining(`PURCHASE_RETURN_ITEM:${itemId}`),
        }),
        'user-1',
        expect.anything(),
      );
    });
  });

  // PUR-4 (P1 — GF-IMP-W2): كود مرتجع مستقر + سجل تدقيق لمرتجع المورد
  describe('returnToSupplier — PUR-4 كود مستقر وتدقيق', () => {
    it('يكتب ActivityLog SUPPLIER_RETURN_CREATED ويربط كل السجلات بكود مرتجع واحد مستقر', async () => {
      const orderId = 'order-1';
      const itemId = 'item-1';
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: orderId,
        code: 'PO-001',
        status: PurchaseOrderStatus.RECEIVED,
        supplierId: 'sup-1',
        items: [{ id: itemId, rawMaterialId: 'rm-1', unitCost: 5 }],
      });
      mockPrisma.warehouse.findFirst.mockResolvedValue({
        id: 'wh-1',
        code: 'WH-RAW',
      });
      mockPrisma.purchaseReceiptItem.aggregate.mockResolvedValue({
        _sum: { quantity: 10 },
      });
      mockPrisma.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: -5 },
      });
      mockInventory.issue.mockResolvedValue({ entryCode: 'SLE-001' });
      mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
      // مسح أثر الاختبارات السابقة في الملف — الـ mocks مشتركة على مستوى الملف
      mockPrisma.activityLog.create.mockClear();
      (mockInventory.issue as jest.Mock).mockClear();
      (mockFinancial.postJournalEntryInTx as jest.Mock).mockClear();

      await service.returnToSupplier(
        orderId,
        { purchaseOrderItemId: itemId, quantity: 2 },
        'user-1',
      );

      // (ب) ActivityLog داخل المعاملة بالفعل بالكود والكمية والمبلغ
      expect(mockPrisma.activityLog.create).toHaveBeenCalledTimes(1);
      const logCall = mockPrisma.activityLog.create.mock.calls[0][0];
      expect(logCall.data).toMatchObject({
        userId: 'user-1',
        action: 'SUPPLIER_RETURN_CREATED',
        module: 'PURCHASING',
      });
      const details = logCall.data.details;
      expect(details.purchaseOrderId).toBe(orderId);
      expect(details.purchaseOrderItemId).toBe(itemId);
      expect(details.quantity).toBe(2);
      expect(details.amount).toBe(10);
      // (أ) الكود المستقر بصيغة supplier-return:<uuid>
      expect(details.returnCode).toMatch(
        /^supplier-return:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // (أ) نفس الكود في reference حركة المخزون وmetadata القيد
      const issueCall = mockInventory.issue.mock.calls[0][0];
      expect(issueCall.reference).toBe(
        `PURCHASE_RETURN_ITEM:${itemId}:${details.returnCode}`,
      );
      const postingCall = (mockFinancial.postJournalEntryInTx as jest.Mock).mock
        .calls[0];
      expect(postingCall[1].reference).toBe(issueCall.reference);
      expect(postingCall[1].metadata).toMatchObject({
        source: 'PURCHASE_RETURN',
        returnCode: details.returnCode,
        returnQuantity: 2,
        returnAmount: 10,
      });
    });
  });
});
