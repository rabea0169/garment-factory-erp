import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('ShippingController — التفويض والصلاحيات (GF-0003)', () => {
  let controller: ShippingController;
  let service: { getShipments: jest.Mock; createShipment: jest.Mock };

  beforeEach(() => {
    service = {
      getShipments: jest.fn().mockResolvedValue([]),
      createShipment: jest.fn().mockResolvedValue({ id: 'sh-1' }),
    };
    controller = new ShippingController(service as unknown as ShippingService);
  });

  it('يفوّض قراءة الشحنات وإنشاءها إلى الخدمة', async () => {
    const body = { salesOrderId: 'so-1', shippingCost: 75 };
    await controller.getShipments();
    await controller.createShipment(body);
    expect(service.getShipments).toHaveBeenCalledTimes(1);
    expect(service.createShipment).toHaveBeenCalledWith(body);
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
