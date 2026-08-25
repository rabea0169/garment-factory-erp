import 'reflect-metadata';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { UserRole, PaymentType } from '@prisma/client';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';
import { ROLES_KEY } from '../auth/roles.guard';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

describe('PurchasingController', () => {
  let controller: PurchasingController;
  let service: { createPurchaseOrder: jest.Mock; receiveOrder: jest.Mock };

  beforeEach(() => {
    service = {
      createPurchaseOrder: jest.fn().mockResolvedValue({ id: 'po-1' }),
      receiveOrder: jest
        .fn()
        .mockResolvedValue({ id: 'po-1', status: 'RECEIVED' }),
    };
    controller = new PurchasingController(
      service as unknown as PurchasingService,
    );
  });

  it('create sets roles INVENTORY_MANAGER, GENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      PurchasingController.prototype,
      'create',
    );
    expect(roles).toEqual([
      UserRole.INVENTORY_MANAGER,
      UserRole.GENERAL_MANAGER,
    ]);
  });

  it('create passes payload and userId to service', async () => {
    const payload = {
      supplierId: 's-1',
      paymentType: PaymentType.CASH,
      items: [],
    } as unknown as CreatePurchaseOrderDto;
    await controller.create(payload, 'user-1');
    expect(service.createPurchaseOrder).toHaveBeenCalledWith(payload, 'user-1');
  });

  it('receive passes id and userId to service', async () => {
    await controller.receive('po-1', 'user-1');
    expect(service.receiveOrder).toHaveBeenCalledWith('po-1', 'user-1');
  });
});
