import 'reflect-metadata';
import { QuotationStatus } from '@prisma/client';
import { QuotationsService } from './quotations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import type { PrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * SELIM-ERP W1 — اختبارات خدمة عروض الأسعار.
 *
 * تركّز على قواعد المجال (نفس قواعد Selim ERP):
 * - الإجماليات تُحسب على الخادم من البنود (لا تُقبل من العميل).
 * - التعديل/الحذف في DRAFT فقط.
 * - انتقالات الحالة مقيّدة بمسارات محددة.
 * - التحويل يتطلب بروابط SKU كاملة + عميلًا مسجلًا.
 * - الترقيم التسلسلي يُولَّد داخل المعاملة.
 */

/** إدخال وسيط لقراءة بيانات إنشاء العرض (بلا any مسرب — نمط sales spec). */
interface QuotationCreateCall {
  data: { subtotal: number; vatAmount: number; total: number };
}

/**
 * SELIM-W1: امتداد محلي للـ mock الموحد — التحقق من بنود العرض يحتاج
 * productVariant.count (نمط SalesPrismaMock: لا نغيّر شكل نماذج قائمة
 * في الـ helper المشترك حفاظًا على توافق بقية المواصفات).
 */
type QuotationsPrismaMock = PrismaMock & {
  productVariant: PrismaMock['productVariant'] & { count: jest.Mock };
};

function createQuotationsPrismaMock(): QuotationsPrismaMock {
  const base = createPrismaMock();
  return {
    ...base,
    productVariant: { ...base.productVariant, count: jest.fn() },
  };
}

describe('QuotationsService — قواعد عروض الأسعار (SELIM W1)', () => {
  let service: QuotationsService;
  let prisma: QuotationsPrismaMock;
  let nextNumber: jest.Mock;
  // tx يشترك مع prisma في نفس الـ mocks (المعاملة تمر على نفس الوكيل).
  const tx = {} as unknown as QuotationsPrismaMock;

  const baseDto = {
    customerId: 'cust-1',
    customerName: 'شركة النور',
    discount: 0,
    vatRate: 0.14,
    items: [
      {
        productName: 'تيشيرت بولو',
        productVariantId: 'var-1',
        quantity: 10,
        unitPrice: 250,
      },
    ],
    notes: null,
  };

  beforeEach(() => {
    prisma = createQuotationsPrismaMock();
    prisma.$transaction.mockImplementation(
      (
        arg: ((client: QuotationsPrismaMock) => Promise<unknown>) | unknown[],
      ): Promise<unknown> =>
        typeof arg === 'function' ? arg(tx) : Promise.resolve([[], 0]),
    );
    prisma.quotation.findMany.mockResolvedValue([]);
    prisma.quotation.count.mockResolvedValue(0);
    prisma.quotation.create.mockResolvedValue({ id: 'q-1' });
    prisma.quotation.update.mockResolvedValue({ id: 'q-1' });
    prisma.quotation.delete.mockResolvedValue({ id: 'q-1' });
    prisma.quotation.groupBy.mockResolvedValue([]);
    prisma.quotation.aggregate.mockResolvedValue({ _sum: { total: null } });
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      name: 'شركة النور',
    });
    prisma.product.count.mockResolvedValue(1);
    prisma.productVariant.count.mockResolvedValue(1);
    prisma.productVariant.findMany.mockResolvedValue([]);
    prisma.salesOrder.count.mockResolvedValue(0);
    prisma.salesOrder.create.mockResolvedValue({ id: 'so-1' });
    Object.assign(tx, prisma);
    nextNumber = jest.fn().mockResolvedValue('QUO-0001');
    const sequence = { nextNumber } as unknown as SequenceService;
    const financial = {} as unknown as FinancialPostingService;
    service = new QuotationsService(
      prisma as unknown as PrismaService,
      sequence,
      financial,
    );
  });

  it('يحسب الإجماليات على الخادم: مجموع + VAT على الصافي', async () => {
    await service.create(baseDto as never, 'user-1');
    const createCall = (
      prisma.quotation.create.mock.calls as unknown as Array<
        [QuotationCreateCall]
      >
    )[0][0];
    // 10 × 250 = 2500، VAT 14% على 2500 = 350، الإجمالي 2850.
    expect(Number(createCall.data.subtotal)).toBe(2500);
    expect(Number(createCall.data.vatAmount)).toBe(350);
    expect(Number(createCall.data.total)).toBe(2850);
    // الترقيم عبر SequenceService داخل المعاملة.
    expect(nextNumber).toHaveBeenCalledWith('QUOTATION', tx);
  });

  it('يرفض الخصم الأكبر من مجموع البنود', async () => {
    await expect(
      service.create({ ...baseDto, discount: 99999 } as never, 'user-1'),
    ).rejects.toThrow('الخصم لا يمكن أن يتجاوز');
  });

  it('يرفض إنشاء عرض لعميل غير موجود', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    await expect(service.create(baseDto as never, 'user-1')).rejects.toThrow(
      'العميل المحدد غير موجود',
    );
  });

  it('يرفض تعديل عرض غير مسودة', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-1',
      status: QuotationStatus.SENT,
    });
    await expect(
      service.update('q-1', baseDto as never, 'user-1'),
    ).rejects.toThrow('بعد إرساله');
  });

  it('يرفض حذف عرض محوّل', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-1',
      status: QuotationStatus.CONVERTED,
    });
    await expect(service.remove('q-1')).rejects.toThrow(
      'لا يمكن حذف عرض سعر مرسل أو محول',
    );
  });

  it('يرفض الإرسال إلا من المسودة', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-1',
      status: QuotationStatus.DRAFT,
    });
    await service.updateStatus('q-1', 'SENT');
    expect(prisma.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q-1' },
        data: { status: 'SENT' },
      }),
    );
  });

  it('يرفض القبول من غير المرسلة', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-1',
      status: QuotationStatus.DRAFT,
    });
    await expect(service.updateStatus('q-1', 'ACCEPTED')).rejects.toThrow(
      'يتطلبان عرضًا مرسلًا',
    );
  });

  it('يرفض تحويل عرض ببند بلا SKU', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-1',
      status: QuotationStatus.ACCEPTED,
      customerId: 'cust-1',
      customerName: 'شركة النور',
      quotationNo: 'QUO-0001',
      subtotal: '2500',
      discount: '0',
      vatRate: '0.14',
      vatAmount: '350',
      items: [
        {
          productName: 'صنف حر',
          productVariantId: null,
          quantity: '10',
          unitPrice: '250',
        },
      ],
    });
    await expect(service.convert('q-1', 'user-1', 'CASH')).rejects.toThrow(
      'غير مرتبط بتوليفة',
    );
  });

  it('يرفض تحويل عرض بلا عميل مسجل', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-1',
      status: QuotationStatus.ACCEPTED,
      customerId: null,
      items: [
        {
          productVariantId: 'var-1',
          quantity: '10',
          unitPrice: '250',
          productName: 'تيشيرت',
        },
      ],
    });
    await expect(service.convert('q-1', 'user-1', 'CASH')).rejects.toThrow(
      'عميلًا مسجلًا',
    );
  });

  it('يرفض تحويل عرض مرفوض', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'q-1',
      status: QuotationStatus.REJECTED,
      items: [],
    });
    await expect(service.convert('q-1', 'user-1', 'CASH')).rejects.toThrow(
      'مقبولًا',
    );
  });
});
