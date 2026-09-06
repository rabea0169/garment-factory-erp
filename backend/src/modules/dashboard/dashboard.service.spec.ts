import { Prisma } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * GF-REMAINING-004 + GF-IMP-W3 (DSH-3/4/5):
 * - DSH-3: اختزال 60 ثانية بمفتاح المجال الزمني — نداءان بنفس النطاق خلال
 *   المدة = استعلام خام واحد؛ نطاق مختلف أو انتهاء المدة = استعلام جديد.
 * - DSH-4: to بلا مركب زمني (منتصف الليل) يُمدّ حدّه الأعلى إلى نهاية اليوم
 *   (حصريًا) فلا تُبتلع بيانات آخر يوم.
 * - DSH-5: netOfTax بجانب الإجمالي، خصم مرتجعات البيع المؤكدة من الإيراد
 *   المعروض، وعد أنواع المنتج التام بتمييز المتغير (COUNT DISTINCT) بدل
 *   صفوف الأرصدة.
 */

/** مختزال بيانات خام موحد للاستعلامات الستة التي تطلقها getStats */
function makePrismaMock() {
  return {
    $queryRaw: jest.fn(
      (strings: TemplateStringsArray, ..._values: unknown[]) => {
        const sql = strings.join(' ');
        if (sql.includes('sales_returns')) {
          return Promise.resolve([
            { period: '2026-08', amount: new Prisma.Decimal('250.00') },
          ]);
        }
        if (sql.includes('sales_orders')) {
          return Promise.resolve([
            {
              period: '2026-08',
              amount: new Prisma.Decimal('1250.50'),
              taxAmount: new Prisma.Decimal('175.07'),
            },
          ]);
        }
        if (sql.includes('workers')) {
          return Promise.resolve([
            { workerId: 'worker-1', name: 'عامل 1', pieces: BigInt(42) },
          ]);
        }
        if (sql.includes('daily_production')) {
          return Promise.resolve([
            { period: '2026-08-26', pieces: BigInt(42) },
          ]);
        }
        if (sql.includes('finished_good_stocks')) {
          return Promise.resolve([{ count: BigInt(2) }]);
        }
        if (sql.includes('raw_materials')) {
          return Promise.resolve([{ count: BigInt(3) }]);
        }
        return Promise.resolve([]);
      },
    ),
    rawMaterial: { count: jest.fn().mockResolvedValue(12) },
    finishedGoodStock: { count: jest.fn().mockResolvedValue(4) },
  };
}

const RANGE = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-26T23:59:59.999Z',
};

describe('DashboardService (GF-REMAINING-004)', () => {
  it('يجمع المبيعات والإنتاج والعمال والمخزون من مصادرها الحقيقية', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);

    const result = await service.getStats({ ...RANGE });

    expect(result.filters).toEqual(RANGE);
    // DSH-5: amount = الإجمالي (1250.50) - مرتجعات الشهر (250) = 1000.5
    // netOfTax = الإجمالي - الضريبة (175.07) = 1075.43
    expect(result.sales).toEqual([
      { period: '2026-08', amount: 1000.5, netOfTax: 1075.43 },
    ]);
    expect(result.production).toEqual([{ period: '2026-08-26', pieces: 42 }]);
    expect(result.topWorkers).toEqual([
      { workerId: 'worker-1', name: 'عامل 1', pieces: 42 },
    ]);
    // DSH-5(ج): الأنواع من COUNT(DISTINCT) لا من finishedGoodStock.count
    expect(result.inventory).toEqual({
      totalMaterials: 12,
      lowStockMaterials: 3,
      totalFinishedGoodsTypes: 2,
    });
    expect(prisma.finishedGoodStock.count).not.toHaveBeenCalled();
    // 6 استعلامات خام: مبيعات + مرتجعات + إنتاج يومي + عمال + نقص خامات +
    // أنواع المنتج التام المميزة
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(6);
  });

  it('يرفض فترة تبدأ بعد نهايتها قبل تنفيذ أي استعلام', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);

    await expect(
      service.getStats({
        from: '2026-08-27T00:00:00.000Z',
        to: '2026-08-26T00:00:00.000Z',
      }),
    ).rejects.toThrow('Dashboard start date cannot be after end date');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.rawMaterial.count).not.toHaveBeenCalled();
  });

  // ---------- DSH-3: اختزال 60 ثانية ----------

  it('DSH-3: نداءان بنفس النطاق خلال المدة = استعلامات خام واحدة فقط (6 لا 12)', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);

    const first = await service.getStats({ ...RANGE });
    const second = await service.getStats({ ...RANGE });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(6);
    expect(second).toEqual(first);
    // الشفافية: generatedAt يعكس لحظة التجميع الفعلية (من الاختزال)
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  it('DSH-3: نطاق مختلف = استعلامات جديدة (لا يشارك الاختزال)', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);

    await service.getStats({ ...RANGE });
    await service.getStats({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T23:59:59.999Z',
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(12);
  });

  it('DSH-3: انتهاء مدة الاختزال (60s) = إعادة تجميع كاملة', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);
    const realNow = Date.now();

    await service.getStats({ ...RANGE });

    // نتقدم بالساعة 61 ثانية بعد النداء الأول — مدخل الاختزال منتهٍ
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(realNow + 61_000 + 1);
    try {
      await service.getStats({ ...RANGE });
    } finally {
      nowSpy.mockRestore();
    }

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(12);
  });

  it('DSH-3: invalidateStatsCache يبطّل الاختزال فيُعاد التجميع فورًا', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);

    await service.getStats({ ...RANGE });
    service.invalidateStatsCache();
    await service.getStats({ ...RANGE });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(12);
  });

  // ---------- DSH-4: نهاية اليوم ----------

  it('DSH-4: to منتصف الليل → الحد الأعلى يصبح نهاية اليوم حصريًا (< to+1day)', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);

    await service.getStats({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T00:00:00.000Z', // منتصف ليل بلا مركب زمني
    });

    // استعلام المبيعات: ثاني معامل = الحد الأعلى الحصري
    const salesCall = prisma.$queryRaw.mock.calls.find((call) =>
      call[0].join(' ').includes('sales_orders'),
    );
    expect(salesCall).toBeDefined();
    const sql = salesCall![0].join(' ');
    expect(sql).toContain('"createdAt" <');
    expect(sql).not.toContain('"createdAt" <=');
    // 2026-08-31T00:00:00Z + يوم = 2026-09-01T00:00:00Z — يوم 31 كاملًا داخل النطاق
    expect((salesCall![2] as Date).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
    expect((salesCall![1] as Date).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });

  it('DSH-4: to بمركب زمني → الحد الأعلى يبقى لحظة to نفسها (+1ms حصريًا)', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);

    await service.getStats({ ...RANGE });

    const salesCall = prisma.$queryRaw.mock.calls.find((call) =>
      call[0].join(' ').includes('sales_orders'),
    );
    expect((salesCall![2] as Date).toISOString()).toBe(
      // 23:59:59.999 + 1ms حصريًا ≡ <= 23:59:59.999 بدقة المللي ثانية
      '2026-08-27T00:00:00.000Z',
    );
  });

  // ---------- DSH-5: دلالات المؤشرات ----------

  it('DSH-5(أ): تعريف المبيعات يوثّق netOfTax (القيمة قبل الضريبة) بجانب الإجمالي', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);
    const result = await service.getStats({ ...RANGE });

    expect(result.definitions.sales).toContain('netOfTax');
    expect(result.definitions.sales).toContain('vatAmount');
    // DSH-5(ب): التعريف يوثّق خصم المرتجعات المؤكدة من الإيراد المعروض
    expect(result.definitions.sales).toContain('sales_returns');
    // DSH-5(ج): التعريف يوثّق عد الأنواع بالمميزة لا بصفوف الأرصدة
    expect(result.definitions.inventory).toContain('DISTINCT');
  });

  it('DSH-5(ب): استعلام المرتجعات يجمع من sales_returns داخل نطاق الفترة نفسه', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);

    await service.getStats({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T00:00:00.000Z',
    });

    const returnsCall = prisma.$queryRaw.mock.calls.find((call) =>
      call[0].join(' ').includes('sales_returns'),
    );
    expect(returnsCall).toBeDefined();
    const sql = returnsCall![0].join(' ');
    expect(sql).toContain('SUM("totalAmount")');
    expect(sql).toContain('"createdAt" <');
    expect((returnsCall![2] as Date).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('DSH-5(ج): أنواع المنتج التام تعد بـ COUNT(DISTINCT productVariantId) من الأرصدة الموجبة', async () => {
    const prisma = makePrismaMock();
    const service = new DashboardService(prisma as unknown as PrismaService);

    const result = await service.getStats({ ...RANGE });

    const fgCall = prisma.$queryRaw.mock.calls.find((call) =>
      call[0].join(' ').includes('finished_good_stocks'),
    );
    const sql = fgCall![0].join(' ');
    expect(sql).toContain('COUNT(DISTINCT "productVariantId")');
    expect(sql).toContain('quantity > 0');
    expect(result.inventory.totalFinishedGoodsTypes).toBe(2);
  });

  it('شهر بلا مرتجعات: amount = الإجمالي كما هو وnetOfTax = الإجمالي - الضريبة', async () => {
    const prisma = makePrismaMock();
    prisma.$queryRaw.mockImplementation(
      (strings: TemplateStringsArray, ..._values: unknown[]) => {
        const sql = strings.join(' ');
        if (sql.includes('sales_returns')) return Promise.resolve([]);
        if (sql.includes('sales_orders')) {
          return Promise.resolve([
            {
              period: '2026-08',
              amount: new Prisma.Decimal('1250.50'),
              taxAmount: new Prisma.Decimal('175.07'),
            },
          ]);
        }
        if (sql.includes('workers')) {
          return Promise.resolve([
            { workerId: 'worker-1', name: 'عامل 1', pieces: BigInt(42) },
          ]);
        }
        if (sql.includes('daily_production')) {
          return Promise.resolve([
            { period: '2026-08-26', pieces: BigInt(42) },
          ]);
        }
        if (sql.includes('finished_good_stocks')) {
          return Promise.resolve([{ count: BigInt(2) }]);
        }
        if (sql.includes('raw_materials')) {
          return Promise.resolve([{ count: BigInt(3) }]);
        }
        return Promise.resolve([]);
      },
    );
    const service = new DashboardService(prisma as unknown as PrismaService);

    const result = await service.getStats({ ...RANGE });

    expect(result.sales).toEqual([
      { period: '2026-08', amount: 1250.5, netOfTax: 1075.43 },
    ]);
  });
});
