import 'reflect-metadata';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { UserRole, PaymentType } from '@prisma/client';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';
import { ROLES_KEY } from '../auth/roles.guard';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

describe('PurchasingController', () => {
  let controller: PurchasingController;
  let service: {
    createPurchaseOrder: jest.Mock;
    receiveOrder: jest.Mock;
    cancelPurchaseOrder: jest.Mock;
    approvePurchaseOrder: jest.Mock;
  };

  beforeEach(() => {
    service = {
      createPurchaseOrder: jest.fn().mockResolvedValue({ id: 'po-1' }),
      receiveOrder: jest
        .fn()
        .mockResolvedValue({ id: 'po-1', status: 'RECEIVED' }),
      cancelPurchaseOrder: jest
        .fn()
        .mockResolvedValue({ id: 'po-1', status: 'CANCELLED' }),
      approvePurchaseOrder: jest
        .fn()
        .mockResolvedValue({ id: 'po-1', status: 'APPROVED' }),
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
    expect(service.createPurchaseOrder).toHaveBeenCalledWith(
      payload,
      'user-1',
      undefined,
    );
  });

  it('PUR-3: create يمرر Idempotency-Key من الترويسة إلى الخدمة', async () => {
    const payload = {
      supplierId: 's-1',
      paymentType: PaymentType.CASH,
      items: [],
    } as unknown as CreatePurchaseOrderDto;
    await controller.create(payload, 'user-1', 'po-key-1');
    expect(service.createPurchaseOrder).toHaveBeenCalledWith(
      payload,
      'user-1',
      'po-key-1',
    );
  });

  it('receive passes id and userId to service', async () => {
    await controller.receive('po-1', 'user-1');
    expect(service.receiveOrder).toHaveBeenCalledWith('po-1', 'user-1');
  });

  it('PUR-5: cancel يمرر id وuserId وIdempotency-Key إلى الخدمة', async () => {
    await controller.cancelOrder('po-1', 'user-1', 'cancel-key-1');
    expect(service.cancelPurchaseOrder).toHaveBeenCalledWith(
      'po-1',
      'user-1',
      'cancel-key-1',
    );
  });

  it('PUR-5 (أ): approve يمرر id وuserId وIdempotency-Key إلى الخدمة', async () => {
    await controller.approveOrder('po-1', 'user-1', 'approve-key-1');
    expect(service.approvePurchaseOrder).toHaveBeenCalledWith(
      'po-1',
      'user-1',
      'approve-key-1',
    );
  });

  it('PUR-5 (أ): approve مقيد بـ INVENTORY_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      PurchasingController.prototype,
      'approveOrder',
    );
    expect(roles).toEqual([
      UserRole.INVENTORY_MANAGER,
      UserRole.GENERAL_MANAGER,
    ]);
  });

  it('PUR-5: cancel مقيد بـ INVENTORY_MANAGER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      PurchasingController.prototype,
      'cancelOrder',
    );
    expect(roles).toEqual([
      UserRole.INVENTORY_MANAGER,
      UserRole.GENERAL_MANAGER,
    ]);
  });
});
