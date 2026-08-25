/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { PaymentType, SalesOrderStatus } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { BadRequestException } from '@nestjs/common';

describe('SalesService — العملاء وأوامر البيع (GF-0011)', () => {
  let service: SalesService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.salesOrder = {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    } as any;
    prisma.productVariant = {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    } as any;
    prisma.warehouse = { findFirst: jest.fn() } as any;
    prisma.finishedGood = {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    } as any;
    prisma.stockLedgerEntry = {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    } as any;

    service = new SalesService(
      prisma as unknown as PrismaService,
      {} as unknown as InventoryService,
    );
  });

  describe('createSalesOrder', () => {
    it('should calculate totalAmount correctly using DB prices', async () => {
      const dto = {
        customerId: 'c-1',
        paymentType: PaymentType.CASH,
        discount: 10,
        items: [{ productVariantId: 'v-1', quantity: 2 }],
      };

      prisma.productVariant.findMany.mockResolvedValue([
        { id: 'v-1', product: { retailPrice: 100 } },
      ]);
      prisma.salesOrder.create.mockResolvedValue({ id: 'so-1' });

      await service.createSalesOrder(dto, 'user-1');

      expect(prisma.salesOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalAmount: 190, // (100 * 2) - 10
            status: SalesOrderStatus.DRAFT,
            userId: 'user-1',
          }),
        }),
      );
    });
  });

  describe('confirmOrder', () => {
    it('should issue inventory and mark as CONFIRMED', async () => {
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

      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
      prisma.salesOrder.update.mockResolvedValue({ code: 'SO-100' });

      await service.confirmOrder('so-1', 'user-1');

      expect(prisma.salesOrder.update).toHaveBeenCalledWith({
        where: { id: 'so-1' },
        data: { status: SalesOrderStatus.CONFIRMED },
      });
      expect(prisma.finishedGood.update).toHaveBeenCalledWith({
        where: { id: 'fg-1' },
        data: { quantity: 8 },
      });
      expect(prisma.stockLedgerEntry.create).toHaveBeenCalled();
    });

    it('should throw if insufficient stock', async () => {
      prisma.salesOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        code: 'SO-100',
        status: SalesOrderStatus.DRAFT,
        items: [{ productVariantId: 'v-1', quantity: 10 }],
      });
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-fg' });
      prisma.finishedGood.findFirst.mockResolvedValue({
        id: 'fg-1',
        quantity: 5,
      }); // Less than 10
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));

      await expect(service.confirmOrder('so-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
