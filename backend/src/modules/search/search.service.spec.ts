import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { SearchService } from './search.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * SELIM-ERP W2 — اختبارات البحث الشامل:
 * - استعلام قصير يعود فارغًا (حد الحد الأدنى).
 * - تصفية المجموعات بحسب الدور (نفس أدوار قراءة الوحدات الأصل).
 * - تجميع النتائج وإسقاط الأنواع الفارغة.
 */

describe('SearchService — البحث الشامل (SELIM W2)', () => {
  let service: SearchService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    // كل المجموعات تعود فارغة افتراضيًا — الاختبار يخصّص ما يحتاجه فقط
    // (jest.fn() بلا قيمة يعيد undefined فيكسر سلسلة الوعود).
    for (const delegate of [
      prisma.customer,
      prisma.product,
      prisma.quotation,
      prisma.salesOrder,
      prisma.purchaseOrder,
      prisma.supplier as unknown as { findMany: jest.Mock },
      prisma.workOrder,
      prisma.worker,
      prisma.treasury,
    ]) {
      delegate.findMany.mockResolvedValue([]);
    }
    service = new SearchService(prisma as unknown as PrismaService);
  });

  it('يرفض الاستعلامات الأقصر من حرفين — لا استعلامات قاعدة', async () => {
    const result = await service.search('ق', UserRole.CASHIER);
    expect(result.groups).toEqual([]);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('يرجع المجموعات الأساسية للكاشير بلا عمال ولا مشتريات', async () => {
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'c-1',
        name: 'عميل القاهرة',
        code: 'CUST-1',
        phone: '01000000000',
        isActive: true,
      },
    ]);
    prisma.salesOrder.findMany.mockResolvedValue([
      { id: 's-1', code: 'SO-2026-1', totalAmount: '150', status: 'CONFIRMED' },
    ]);

    const result = await service.search('القا', UserRole.CASHIER);
    const types = result.groups.map((g) => g.type);
    expect(types).toContain('customer');
    expect(types).toContain('salesOrder');
    // الكاشير: لا عمال ولا أوامر شراء ولا موردون (أدوار المشتريات/HR).
    expect(types).not.toContain('worker');
    expect(types).not.toContain('purchaseOrder');
    expect(types).not.toContain('supplier');
    expect(types).not.toContain('workOrder');
    // المجموعات الفارغة تُسقط من الرد.
    expect(result.groups.every((g) => g.hits.length > 0)).toBe(true);
  });

  it('مدير الموارد البشرية يرى العمال — والمحاسب يرى أوامر الشراء والخزائن', async () => {
    prisma.worker.findMany.mockResolvedValue([
      { id: 'w-1', name: 'عامل خياطة', code: 'WKR-1' },
    ]);
    const hrResult = await service.search('خياط', UserRole.HR_MANAGER);
    expect(hrResult.groups.map((g) => g.type)).toContain('worker');
    expect(hrResult.groups.map((g) => g.type)).not.toContain('purchaseOrder');

    prisma.purchaseOrder.findMany.mockResolvedValue([
      { id: 'p-1', code: 'PO-2026-9', totalAmount: '500', status: 'APPROVED' },
    ]);
    const accResult = await service.search('PO', UserRole.ACCOUNTANT);
    expect(accResult.groups.map((g) => g.type)).toContain('purchaseOrder');
    expect(accResult.groups.map((g) => g.type)).not.toContain('worker');
  });

  it('الحد لكل نوع = 5 — يمرر take: 5 في كل استعلام', async () => {
    await service.search('اختبار', UserRole.GENERAL_MANAGER);
    expect(
      (
        prisma.customer.findMany.mock.calls as unknown as Array<
          [{ take?: number }]
        >
      )[0][0].take,
    ).toBe(5);
  });
});
