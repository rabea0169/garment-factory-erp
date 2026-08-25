import { PaymentType, SalesOrderStatus } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { generateDocumentCode } from '../../core/common/codes.util';

describe('SalesService — العملاء وأوامر البيع (GF-0011 + A5/A7/B1)', () => {
  let service: SalesService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new SalesService(
      prisma as unknown as PrismaService,
      {} as unknown as InventoryService,
    );
  });

  describe('createCustomer — A7 crypto codes', () => {
    it('should generate a customer code matching the crypto pattern', async () => {
      prisma.customer.create.mockResolvedValue({ id: 'c-1' });

      await service.createCustomer({
        name: 'Test Customer',
        phone: '01000000000',
      });

      const call = prisma.customer.create.mock.calls[0] as unknown[] as [
        { data: { code: string; name: string } },
      ];
      const code = call[0].data.code;
      // A7: pattern = CUST-YYYYMMDD-XXXXXXXX (8 hex uppercase)
      expect(code).toMatch(/^CUST-\d{8}-[0-9A-F]{8}$/);
      // Verify it doesn't use Date.now() directly (no collision risk)
      expect(code).not.toBe('CUST-' + Date.now());
    });

    it('should produce different codes on subsequent calls', async () => {
      prisma.customer.create.mockResolvedValue({ id: 'c-1' });

      await service.createCustomer({ name: 'A' });
      await service.createCustomer({ name: 'B' });

      const code1 = (
        (prisma.customer.create.mock.calls[0] as unknown[])[0] as {
          data: { code: string };
        }
      ).data.code;
      const code2 = (
        (prisma.customer.create.mock.calls[1] as unknown[])[0] as {
          data: { code: string };
        }
      ).data.code;
      expect(code1).not.toBe(code2);
    });
  });

  describe('getSalesOrders — B1 reduced include', () => {
    it('should select only id/name/code from customer (not the full object)', async () => {
      prisma.salesOrder.findMany.mockResolvedValue([
        {
          id: 'so-1',
          code: 'SO-1',
          customer: { id: 'c-1', name: 'Customer 1', code: 'CUST-1' },
          items: [],
        },
      ]);
      prisma.salesOrder.count.mockResolvedValue(1);

      await service.getSalesOrders({ page: 1, limit: 20 });

      const findManyArgs = (
        prisma.salesOrder.findMany.mock.calls[0] as unknown[]
      )[0] as {
        include: { customer: { select: Record<string, boolean> } };
      };
      // B1: customer is a select, not a full include
      expect(findManyArgs.include.customer.select).toEqual({
        id: true,
        name: true,
        code: true,
      });
      // Should NOT have other customer fields (phone/address/balance)
      expect(Object.keys(findManyArgs.include.customer.select).sort()).toEqual([
        'code',
        'id',
        'name',
      ]);
    });
  });

  describe('createSalesOrder — A5 pre-check + A7 codes', () => {
    const dto = {
      customerId: 'c-1',
      paymentType: PaymentType.CASH,
      discount: 10,
      items: [{ productVariantId: 'v-1', quantity: 2 }],
    };

    beforeEach(() => {
      prisma.productVariant.findMany.mockResolvedValue([
        { id: 'v-1', product: { retailPrice: 100 } },
      ]);
      prisma.finishedGood.findFirst.mockResolvedValue({ quantity: 10 });
      prisma.salesOrder.create.mockResolvedValue({ id: 'so-1' });
    });

    it('should calculate totalAmount correctly using DB prices', async () => {
      await service.createSalesOrder(dto, 'user-1');

      const createArgs = (
        (prisma.salesOrder.create.mock.calls[0] as unknown[])[0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(createArgs).toEqual(
        expect.objectContaining({
          totalAmount: 190, // (100 * 2) - 10
          status: SalesOrderStatus.DRAFT,
          userId: 'user-1',
        }),
      );
    });

    it('A7: should use crypto-random code matching SO-YYYYMMDD-XXXXXXXX', async () => {
      await service.createSalesOrder(dto, 'user-1');

      const code = (
        (prisma.salesOrder.create.mock.calls[0] as unknown[])[0] as {
          data: { code: string };
        }
      ).data.code;
      expect(code).toMatch(/^SO-\d{8}-[0-9A-F]{8}$/);
      expect(code).not.toBe('SO-' + Date.now());
    });

    it('A5: should pre-check availability and throw BadRequestException if insufficient', async () => {
      prisma.finishedGood.findFirst.mockResolvedValue({ quantity: 1 }); // < 2

      await expect(service.createSalesOrder(dto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });

    it('A5: should allow create when available >= requested', async () => {
      prisma.finishedGood.findFirst.mockResolvedValue({ quantity: 5 }); // >= 2

      await service.createSalesOrder(dto, 'user-1');

      expect(prisma.salesOrder.create).toHaveBeenCalled();
    });

    it('A5: should treat missing finishedGood record as 0 quantity (insufficient)', async () => {
      prisma.finishedGood.findFirst.mockResolvedValue(null);

      await expect(service.createSalesOrder(dto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('confirmOrder — A5 atomic decrement + A7 SLE codes', () => {
    beforeEach(() => {
      prisma.salesOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        code: 'SO-100',
        status: SalesOrderStatus.DRAFT,
        items: [{ productVariantId: 'v-1', quantity: 2 }],
      });
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
      prisma.finishedGood.findFirst.mockResolvedValue({
        id: 'fg-1',
        quantity: 10,
      });
      prisma.finishedGood.updateMany.mockResolvedValue({ count: 1 });
      prisma.finishedGood.findUnique.mockResolvedValue({ quantity: 8 });
      prisma.salesOrder.update.mockResolvedValue({ code: 'SO-100' });
      prisma.stockLedgerEntry.create.mockResolvedValue({});
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
      );
    });

    it('should atomically decrement via updateMany WHERE quantity >= N', async () => {
      await service.confirmOrder('so-1', 'user-1');

      expect(prisma.finishedGood.updateMany).toHaveBeenCalledWith({
        where: { id: 'fg-1', quantity: { gte: 2 } },
        data: { quantity: { decrement: 2 } },
      });
      expect(prisma.salesOrder.update).toHaveBeenCalledWith({
        where: { id: 'so-1' },
        data: { status: SalesOrderStatus.CONFIRMED },
      });
    });

    it('should read new balance after updateMany and write correct SLE', async () => {
      await service.confirmOrder('so-1', 'user-1');

      const sleArgs = (
        (prisma.stockLedgerEntry.create.mock.calls[0] as unknown[])[0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(sleArgs.balanceAfter).toBe(8); // 10 - 2
      expect(sleArgs.quantityDelta).toBe(-2);
      expect(sleArgs.warehouseId).toBe('wh-fg');
      expect(sleArgs.createdById).toBe('user-1');
    });

    it('A7: should use crypto-random SLE code matching SLE-YYYYMMDD-XXXXXXXX', async () => {
      await service.confirmOrder('so-1', 'user-1');

      const sleCode = (
        (prisma.stockLedgerEntry.create.mock.calls[0] as unknown[])[0] as {
          data: { entryCode: string };
        }
      ).data.entryCode;
      expect(sleCode).toMatch(/^SLE-\d{8}-[0-9A-F]{8}$/);
    });

    it('A5: should throw ConflictException when updateMany returns count=0 (race-loser)', async () => {
      prisma.finishedGood.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirmOrder('so-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.stockLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if no fgRecord exists', async () => {
      prisma.finishedGood.findFirst.mockResolvedValue(null);

      await expect(service.confirmOrder('so-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if order is not DRAFT', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        status: SalesOrderStatus.CONFIRMED,
        items: [],
      });

      await expect(service.confirmOrder('so-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if order does not exist', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue(null);

      await expect(service.confirmOrder('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('generateDocumentCode — A7 helper properties', () => {
    it('should produce unique codes for same prefix', () => {
      const a = generateDocumentCode('SO');
      const b = generateDocumentCode('SO');
      expect(a).not.toBe(b);
      expect(a).toMatch(/^SO-\d{8}-[0-9A-F]{8}$/);
    });
  });
});
