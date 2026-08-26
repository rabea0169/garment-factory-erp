import 'reflect-metadata';
import { ShipmentStatus, UserRole } from '@prisma/client';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('ShippingController — التفويض والصلاحيات (GF-0003)', () => {
  let controller: ShippingController;
  let service: {
    getShipments: jest.Mock;
    createShipment: jest.Mock;
    updateShipmentStatus: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getShipments: jest.fn().mockResolvedValue([]),
      createShipment: jest.fn().mockResolvedValue({ id: 'sh-1' }),
      updateShipmentStatus: jest.fn().mockResolvedValue({ id: 'sh-1' }),
    };
    controller = new ShippingController(service as unknown as ShippingService);
  });

  it('يفوّض قراءة الشحنات وإنشاءها إلى الخدمة مع actor وidempotency', async () => {
    const body = { salesOrderId: 'so-1', shippingCost: 75 };
    await controller.getShipments();
    await controller.createShipment(body, 'actor-1', 'shipment-key-1');
    expect(service.getShipments).toHaveBeenCalledTimes(1);
    expect(service.createShipment).toHaveBeenCalledWith(
      body,
      'actor-1',
      'shipment-key-1',
    );
  });

  it('يمرر actor وPOD إلى خدمة انتقال الحالة', async () => {
    const body = {
      status: ShipmentStatus.DELIVERED,
      proofOfDelivery: 'POD-1',
    };
    await controller.updateStatus('sh-1', body, 'actor-1');
    expect(service.updateShipmentStatus).toHaveBeenCalledWith(
      'sh-1',
      body.status,
      'actor-1',
      'POD-1',
    );
  });

  it('إنشاء شحنة مقيّد بـ CASHIER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      ShippingController.prototype,
      'createShipment',
    );
    expect(roles).toEqual([UserRole.CASHIER, UserRole.GENERAL_MANAGER]);
  });
});
