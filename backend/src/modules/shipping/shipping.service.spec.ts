import { BadRequestException } from '@nestjs/common';
import { SalesOrderStatus, ShipmentStatus } from '@prisma/client';
import { ShippingService } from './shipping.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('ShippingService — الشحنات (GF-0003)', () => {
  let service: ShippingService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    service = new ShippingService(prisma as unknown as PrismaService);
  });

  it('يجلب الشحنات مع أمر البيع والعميل', async () => {
    const shipments = [{ id: 'sh-1', salesOrder: { customer: {} } }];
    prisma.shipment.findMany.mockResolvedValue(shipments);
    prisma.shipment.count.mockResolvedValue(shipments.length);

    const result = await service.getShipments();

    expect(result.data).toEqual(shipments);
    expect(prisma.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { salesOrder: { include: { customer: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('ينشئ شحنة بكود SHP-* ويحفظ بياناتها (حالة PREPARING الافتراضية من المخطط)', async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.CONFIRMED,
    });
    prisma.shipment.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'sh-2', ...data }),
    );

    const result = await service.createShipment({
      salesOrderId: 'so-1',
      shippingCost: 75,
      trackingNumber: 'TRK-99',
    });

    expect(result.code).toMatch(/^SHP-\d{8}-[0-9A-F]{8}$/);
    expect(prisma.shipment.create).toHaveBeenCalledWith({
      data: {
        code: expect.stringMatching(/^SHP-\d{8}-[0-9A-F]{8}$/) as string,
        salesOrderId: 'so-1',
        shippingCost: 75,
        trackingNumber: 'TRK-99',
      },
    });
  });

  it('يرفض إنشاء شحنة لأمر غير مؤكد', async () => {
    prisma.salesOrder.findUnique.mockResolvedValue({
      id: 'so-1',
      status: SalesOrderStatus.DRAFT,
    });

    await expect(
      service.createShipment({ salesOrderId: 'so-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });

  it('يسمح بانتقال PREPARING إلى SHIPPED ويضع shippedAt', async () => {
    prisma.shipment.findUnique
      .mockResolvedValueOnce({
        id: 'sh-1',
        status: ShipmentStatus.PREPARING,
      })
      .mockResolvedValue({
        id: 'sh-1',
        status: ShipmentStatus.SHIPPED,
      });
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });

    await service.updateShipmentStatus(
      'sh-1',
      ShipmentStatus.SHIPPED,
      'actor-1',
    );

    const calls = prisma.shipment.updateMany.mock.calls as unknown as Array<
      [
        {
          where: { id: string; status: ShipmentStatus };
          data: { status: ShipmentStatus; shippedAt?: Date };
        },
      ]
    >;
    const request = calls[0][0];
    expect(request.where).toEqual({
      id: 'sh-1',
      status: ShipmentStatus.PREPARING,
    });
    expect(request.data.status).toBe(ShipmentStatus.SHIPPED);
    expect(request.data.shippedAt).toBeInstanceOf(Date);
  });

  it('يرفض انتقالًا غير منطقي في حالة الشحنة', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      id: 'sh-1',
      status: ShipmentStatus.PREPARING,
    });

    await expect(
      service.updateShipmentStatus('sh-1', ShipmentStatus.DELIVERED, 'actor-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('يشترط إثبات التسليم ويسجل الفاعل عند DELIVERED', async () => {
    prisma.shipment.findUnique
      .mockResolvedValueOnce({
        id: 'sh-1',
        status: ShipmentStatus.IN_TRANSIT,
      })
      .mockResolvedValueOnce({
        id: 'sh-1',
        status: ShipmentStatus.IN_TRANSIT,
      })
      .mockResolvedValue({
        id: 'sh-1',
        status: ShipmentStatus.DELIVERED,
        proofOfDelivery: 'POD-1',
        deliveredById: 'actor-1',
      });

    await expect(
      service.updateShipmentStatus('sh-1', ShipmentStatus.DELIVERED, 'actor-1'),
    ).rejects.toThrow('إثبات التسليم مطلوب');

    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    prisma.activityLog.create.mockResolvedValue({ id: 'log-1' });

    const delivered = await service.updateShipmentStatus(
      'sh-1',
      ShipmentStatus.DELIVERED,
      'actor-1',
      'POD-1',
    );

    expect(delivered).toMatchObject({
      status: ShipmentStatus.DELIVERED,
      proofOfDelivery: 'POD-1',
      deliveredById: 'actor-1',
    });
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'actor-1',
        action: 'SHIPMENT_STATUS_CHANGED',
      }) as Record<string, unknown>,
    });
  });
});
