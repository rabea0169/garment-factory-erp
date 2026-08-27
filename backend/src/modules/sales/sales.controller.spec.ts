import 'reflect-metadata';
import { PaymentType, UserRole } from '@prisma/client';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';

describe('SalesController — هوية الجلسة والصلاحيات (GF-0011)', () => {
  let controller: SalesController;
  let service: {
    getCustomers: jest.Mock;
    createCustomer: jest.Mock;
    createCustomerPayment: jest.Mock;
    getSalesOrders: jest.Mock;
    createSalesOrder: jest.Mock;
    confirmOrder: jest.Mock;
    cancelOrder: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getCustomers: jest.fn().mockResolvedValue([]),
      createCustomer: jest.fn().mockResolvedValue({ id: 'c-1' }),
      createCustomerPayment: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      getSalesOrders: jest.fn().mockResolvedValue([]),
      createSalesOrder: jest.fn().mockResolvedValue({ id: 'so-1' }),
      confirmOrder: jest
        .fn()
        .mockResolvedValue({ id: 'so-1', status: 'CONFIRMED' }),
      cancelOrder: jest
        .fn()
        .mockResolvedValue({ id: 'so-1', status: 'CANCELLED' }),
    };
    controller = new SalesController(service as unknown as SalesService);
  });

  it('تحصيل دفعة يمرر actor من الجلسة وIdempotency-Key', async () => {
    const body = {
      customerId: 'c-1',
      amount: 100,
      notes: 'تحصيل نقدي',
    } as unknown as CreateCustomerPaymentDto;

    await controller.createCustomerPayment(body, 'user-1', 'payment-key');

    expect(service.createCustomerPayment).toHaveBeenCalledWith(
      { ...body, actorId: 'user-1' },
      'payment-key',
    );
  });

  it('تحصيل الدفعات مقيّد بـ CASHIER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      SalesController.prototype,
      'createCustomerPayment',
    );
    expect(roles).toEqual([UserRole.CASHIER, UserRole.GENERAL_MANAGER]);
  });

  it('إنشاء أمر بيع يمرر هوية الجلسة ولا يقبل userId من الطلب', async () => {
    const body = {
      customerId: 'c-1',
      paymentType: PaymentType.CASH,
      discount: 0,
      items: [{ productVariantId: 'v-1', quantity: 2 }],
    } as unknown as CreateSalesOrderDto;

    await controller.createOrder('user-1', body, undefined);

    expect(service.createSalesOrder).toHaveBeenCalledWith(
      body,
      'user-1',
      undefined,
    );
  });

  it('إلغاء أمر البيع يمرر actor وIdempotency-Key', async () => {
    await controller.cancelOrder('so-1', 'user-1', 'cancel-key');
    expect(service.cancelOrder).toHaveBeenCalledWith(
      'so-1',
      'user-1',
      'cancel-key',
    );
  });

  it('إلغاء أمر البيع مقيّد بـ CASHIER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      SalesController.prototype,
      'cancelOrder',
    );
    expect(roles).toEqual([UserRole.CASHIER, UserRole.GENERAL_MANAGER]);
  });

  it('تأكيد أمر البيع يتطلب صلاحيات CASHIER أو GENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      SalesController.prototype,
      'confirmOrder',
    );
    expect(roles).toEqual([UserRole.CASHIER, UserRole.GENERAL_MANAGER]);
  });

  it('يمرر المعرف userId لتأكيد الأمر', async () => {
    await controller.confirmOrder('so-1', 'user-1', undefined);
    expect(service.confirmOrder).toHaveBeenCalledWith(
      'so-1',
      'user-1',
      undefined,
    );
  });
});
