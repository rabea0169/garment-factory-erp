/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { PurchasingService } from './purchasing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { PurchaseOrderStatus } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';

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
    // COMM-F01: added rawMaterial + supplier to the mock — returnToSupplier
    // now fetches costPerUnit from RawMaterial and the supplier name for the
    // GL entry description.
    rawMaterial: {
      findUnique: jest.fn(),
    },
    supplier: {
      findUnique: jest.fn(),
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
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  const mockInventory = {
    receive: jest.fn(),
    issue: jest.fn(),
  };

  const mockFinancial = {
    postJournalEntryInTx: jest.fn().mockResolvedValue({
      entryId: 'je-1',
      entryCode: 'JE-TEST-001',
      totalDebit: 100,
      totalCredit: 100,
      linesCount: 1,
      createdAt: new Date(),
    }),
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
        code: 'PO-001',
        supplierId: 'sup-1',
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
      // COMM-F01: rawMaterial + supplier mocks required by the new GL posting.
      mockPrisma.rawMaterial.findUnique.mockResolvedValue({
        id: 'rm-1',
        costPerUnit: 12.5,
        currentStock: 50,
      });
      mockPrisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        name: 'Supplier A',
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

  // COMM-F01: returnToSupplier must post a reverse GL entry
  // (Dr ACCOUNTS_PAYABLE / Cr INVENTORY) and reduce the supplier's balance,
  // not just issue stock from the ledger. Without this, the GL Inventory
  // and ACCOUNTS_PAYABLE stay at their pre-return values, leaving a silent
  // gap between the inventory sub-ledger and the GL — fraud risk per
  // the COMM-F01 audit finding.
  describe('returnToSupplier — COMM-F01 GL posting', () => {
    beforeEach(() => {
      // Reset mock call history before each COMM-F01 assertion so prior
      // tests' call counts don't leak into the new assertions.
      mockFinancial.postJournalEntryInTx.mockClear();
      mockInventory.issue.mockResolvedValue({ entryCode: 'SLE-RETURN-1' });
      mockPrisma.idempotencyKey.findUnique.mockResolvedValue(null);
      mockPrisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-return-1' });
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        supplierId: 'sup-1',
        status: PurchaseOrderStatus.RECEIVED,
        items: [{ id: 'poi-1', rawMaterialId: 'rm-1' }],
      });
      mockPrisma.warehouse.findFirst.mockResolvedValue({
        id: 'wh-raw',
        code: 'WH-RAW',
      });
      mockPrisma.purchaseReceiptItem.aggregate.mockResolvedValue({
        _sum: { quantity: 10 },
      });
      mockPrisma.stockLedgerEntry.aggregate.mockResolvedValue({
        _sum: { quantityDelta: 0 },
      });
      // Weighted average cost of the returned raw material = 25 EGP/unit.
      // For a return of 4 units, the GL entry should be 100 EGP.
      mockPrisma.rawMaterial.findUnique.mockResolvedValue({
        id: 'rm-1',
        costPerUnit: 25,
        currentStock: 100,
      });
      mockPrisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        name: 'مورد النسيج الذهبي',
      });
    });

    it('posts a reverse GL entry debiting ACCOUNTS_PAYABLE and crediting INVENTORY', async () => {
      await service.returnToSupplier(
        'po-1',
        { purchaseOrderItemId: 'poi-1', quantity: 4 },
        'user-1',
        'return-key-1',
      );

      expect(mockFinancial.postJournalEntryInTx).toHaveBeenCalledTimes(1);
      const [txArg, inputArg, userIdArg] =
        mockFinancial.postJournalEntryInTx.mock.calls[0];

      // Same transaction client — atomic with the stock movement.
      expect(txArg).toBe(mockPrisma);
      expect(userIdArg).toBe('user-1');

      // Posting key uses the task-spec base (`supplier-return-${po.id}-${itemId}`)
      // extended with the return idempotency record id for uniqueness across
      // multiple returns for the same item.
      expect(inputArg.postingKey).toBe('supplier-return-po-1-poi-1-idem-return-1');
      expect(inputArg.isAuto).toBe(true);
      expect(inputArg.reference).toContain('PURCHASE_RETURN_ITEM:poi-1');

      // The single GL line: Dr ACCOUNTS_PAYABLE / Cr INVENTORY — amount = qty * weightedAvgCost = 4 * 25 = 100.
      expect(inputArg.lines).toHaveLength(1);
      const line = inputArg.lines[0];
      expect(line.debitAccountId).toBe(CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE);
      expect(line.creditAccountId).toBe(CHART_OF_ACCOUNTS.INVENTORY);
      expect(line.amount).toBe(100);

      // Supplier balance must be reduced by the same amount (delta = -100).
      expect(inputArg.supplierUpdates).toEqual([
        { supplierId: 'sup-1', delta: -100 },
      ]);

      // Description includes the supplier name (audit trail).
      expect(inputArg.description).toContain('مورد النسيج الذهبي');
      expect(inputArg.description).toContain('PO-100');

      // Metadata identifies the source for downstream reconciliation.
      expect(inputArg.metadata).toMatchObject({
        source: 'PURCHASE_RETURN',
        purchaseOrderId: 'po-1',
        purchaseOrderItemId: 'poi-1',
        quantity: 4,
        unitCost: 25,
      });
    });

    it('throws if the raw material cannot be loaded (cannot compute return amount)', async () => {
      mockPrisma.rawMaterial.findUnique.mockResolvedValue(null);

      await expect(
        service.returnToSupplier(
          'po-1',
          { purchaseOrderItemId: 'poi-1', quantity: 4 },
          'user-1',
          'return-key-2',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockFinancial.postJournalEntryInTx).not.toHaveBeenCalled();
    });

    it('skips the GL posting only when the weighted-avg cost is zero (no inventory value to reverse)', async () => {
      mockPrisma.rawMaterial.findUnique.mockResolvedValue({
        id: 'rm-1',
        costPerUnit: 0,
        currentStock: 100,
      });

      await service.returnToSupplier(
        'po-1',
        { purchaseOrderItemId: 'poi-1', quantity: 4 },
        'user-1',
        'return-key-3',
      );

      // Zero-cost returns have no GL impact — guard prevents posting a
      // zero-amount line which FinancialPostingService rejects (E4: amount > 0).
      expect(mockFinancial.postJournalEntryInTx).not.toHaveBeenCalled();
    });
  });
});
