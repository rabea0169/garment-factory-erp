import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';

describe('SalesController — هوية الجلسة والصلاحيات (GF-0003)', () => {
  let controller: SalesController;
  let service: {
    getCustomers: jest.Mock;
    createCustomer: jest.Mock;
    getSalesOrders: jest.Mock;
    createSalesOrder: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getCustomers: jest.fn().mockResolvedValue([]),
      createCustomer: jest.fn().mockResolvedValue({ id: 'c-1' }),
      getSalesOrders: jest.fn().mockResolvedValue([]),
      createSalesOrder: jest.fn().mockResolvedValue({ id: 'so-1' }),
    };
    controller = new SalesController(service as unknown as SalesService);
  });

  it('إنشاء أمر بيع يمرر هوية الجلسة ولا يقبل userId من الطلب', async () => {
    const body = {
      customerId: 'c-1',
      paymentType: 'CASH',
      discount: 0,
      items: [],
      userId: 'HACKED-USER',
    };
    await controller.createOrder('user-from-session', body);

    // الـ body يمرر كما هو إلى الخدمة، لكن الهوية تمرر منفصلة من الجلسة —
    // الخدمة تستخدم المعامل الثاني فقط (مثبت في sales.service.spec)
    expect(service.createSalesOrder).toHaveBeenCalledWith(
      expect.anything(),
      'user-from-session',
    );
  });

  it('إضافة عميل تمرر البيانات كما وردت', async () => {
    const body = { name: 'عميل جديد', phone: '01000000000' };
    await controller.createCustomer(body);
    expect(service.createCustomer).toHaveBeenCalledWith(body);
  });

  it('إنشاء أمر بيع مقيّد بـ CASHIER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      SalesController.prototype,
      'createOrder',
    );
    expect(roles).toEqual([UserRole.CASHIER, UserRole.GENERAL_MANAGER]);
  });

  it('إضافة عميل مقيّدة بـ CASHIER وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      SalesController.prototype,
      'createCustomer',
    );
    expect(roles).toEqual([UserRole.CASHIER, UserRole.GENERAL_MANAGER]);
  });
});
