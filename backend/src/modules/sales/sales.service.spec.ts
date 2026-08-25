import { PaymentType } from '@prisma/client';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('SalesService — العملاء وأوامر البيع (GF-0003)', () => {
  let service: SalesService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new SalesService(prisma as unknown as PrismaService);
  });

  it('يجلب العملاء مرتبين بالأحدث', async () => {
    const customers = [{ id: 'c-1', name: 'عميل تجريبي' }];
    prisma.customer.findMany.mockResolvedValue(customers);

    const result = await service.getCustomers();

    expect(result).toEqual(customers);
    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('ينشئ عميلًا مع توليد كود فريد CUST-*', async () => {
    prisma.customer.create.mockResolvedValue({ id: 'c-2', code: 'CUST-123' });

    const result = await service.createCustomer({
      name: 'عميل جديد',
      phone: '01000000000',
    });

    expect(result.code).toMatch(/^CUST-\d+$/);
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: {
        name: 'عميل جديد',
        phone: '01000000000',
        code: expect.stringMatching(/^CUST-\d+$/) as string,
      },
    });
  });

  it('يجلب أوامر البيع مع العميل والبنود والـ variants', async () => {
    const orders = [{ id: 'so-1', customer: {}, items: [] }];
    prisma.salesOrder.findMany.mockResolvedValue(orders);

    const result = await service.getSalesOrders();

    expect(result).toEqual(orders);
    expect(prisma.salesOrder.findMany).toHaveBeenCalledWith({
      include: {
        customer: true,
        items: { include: { variant: { include: { product: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('إنشاء أمر بيع: الإجمالي يُحسب في الخادم (2×100 + 1×50 − خصم 25 = 225)', async () => {
    prisma.salesOrder.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'so-9', ...args.data }),
    );

    const result = await service.createSalesOrder(
      {
        customerId: 'c-1',
        paymentType: PaymentType.CASH,
        discount: 25,
        items: [
          { productVariantId: 'v-1', quantity: 2, unitPrice: 100 },
          { productVariantId: 'v-2', quantity: 1, unitPrice: 50 },
        ],
      },
      'user-from-session',
    );

    expect(result.totalAmount).toBe(225);
    expect(prisma.salesOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'c-1',
        userId: 'user-from-session',
        paymentType: PaymentType.CASH,
        totalAmount: 225,
        discount: 25,
        items: {
          create: [
            {
              productVariantId: 'v-1',
              quantity: 2,
              unitPrice: 100,
              totalPrice: 200,
            },
            {
              productVariantId: 'v-2',
              quantity: 1,
              unitPrice: 50,
              totalPrice: 50,
            },
          ],
        },
      }) as Record<string, unknown>,
    });
  });

  it('إنشاء أمر بيع بلا خصم: الإجمالي = مجموع البنود فقط', async () => {
    prisma.salesOrder.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'so-10', ...args.data }),
    );

    const result = await service.createSalesOrder(
      {
        customerId: 'c-1',
        paymentType: PaymentType.CREDIT,
        discount: 0,
        items: [{ productVariantId: 'v-1', quantity: 3, unitPrice: 70 }],
      },
      'u-2',
    );

    expect(result.totalAmount).toBe(210);
  });
});
