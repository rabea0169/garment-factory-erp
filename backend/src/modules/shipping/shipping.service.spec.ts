import { ShippingService } from './shipping.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('ShippingService — الشحنات (GF-0003)', () => {
  let service: ShippingService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new ShippingService(prisma as unknown as PrismaService);
  });

  it('يجلب الشحنات مع أمر البيع والعميل', async () => {
    const shipments = [{ id: 'sh-1', salesOrder: { customer: {} } }];
    prisma.shipment.findMany.mockResolvedValue(shipments);

    const result = await service.getShipments();

    expect(result).toEqual(shipments);
    expect(prisma.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { salesOrder: { include: { customer: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('ينشئ شحنة بكود SHP-* ويحفظ بياناتها (حالة PREPARING الافتراضية من المخطط)', async () => {
    prisma.shipment.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'sh-2', ...data }),
    );

    const result = await service.createShipment({
      salesOrderId: 'so-1',
      shippingCost: 75,
      trackingNumber: 'TRK-99',
    });

    expect(result.code).toMatch(/^SHP-\d+$/);
    expect(prisma.shipment.create).toHaveBeenCalledWith({
      data: {
        code: expect.stringMatching(/^SHP-\d+$/) as string,
        salesOrderId: 'so-1',
        shippingCost: 75,
        trackingNumber: 'TRK-99',
      },
    });
  });
});
