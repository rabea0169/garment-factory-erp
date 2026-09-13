import 'reflect-metadata';
import { FinancialReportsService } from './financial-reports.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';

/**
 * SELIM-ERP W1 — اختبارات خدمة التقارير المالية.
 *
 * تركّز على حسابات التقارير (نفس قواعد Selim ERP):
 * - قائمة الدخل: تجميع المدين/الدائن → إيرادات/مصروفات/صافي ربح.
 * - نطاق التقرير: افتراضي الشهر الحالي، ورفض النطاق المعكوس.
 * - الميزانية العمومية: معادلة التوازن + الفرق عند الانحراف.
 * - VAT: صافي = مخرجات − مدخلات (مع استثناء 1330 سلف العمال هنا).
 * - أعمار الذمم: توزيع الأرصدة على دلاء 0-30/31-60/61-90/90+.
 * - الميزانيات: تفرد الفترة (P2002 وفحص مسبق) وحدود رقم الفترة
 *   وتباين المخطط/الفعلي.
 */
describe('FinancialReportsService — حسابات التقارير (SELIM W1)', () => {
  let service: FinancialReportsService;
  let prisma: {
    $transaction: jest.Mock;
    account: { findMany: jest.Mock; findUnique: jest.Mock };
    journalLine: { groupBy: jest.Mock };
    salesOrder: { aggregate: jest.Mock; findMany: jest.Mock };
    purchaseOrder: { findMany: jest.Mock };
    customer: { findMany: jest.Mock };
    supplier: { findMany: jest.Mock };
    budget: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    costCenter: { findUnique: jest.Mock };
  };

  const VAT_PAYABLE = CHART_OF_ACCOUNTS.VAT_PAYABLE;

  beforeEach(() => {
    prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (arg: ((client: unknown) => unknown) | unknown[]) =>
            typeof arg === 'function' ? Promise.resolve(arg({})) : [[], 0],
        ),
      account: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      journalLine: { groupBy: jest.fn().mockResolvedValue([]) },
      salesOrder: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { vatAmount: null, totalAmount: null },
          _count: 0,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      purchaseOrder: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
      budget: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) =>
            Promise.resolve(args.data),
          ),
        update: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) =>
            Promise.resolve(args.data),
          ),
        delete: jest.fn().mockResolvedValue({ id: 'b-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      costCenter: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new FinancialReportsService(prisma as never);
  });

  // ----------------------------------------------------------------
  // قائمة الدخل
  // ----------------------------------------------------------------

  it('قائمة الدخل: إيرادات (دائن-مدين) ومصروفات (مدين-دائن) وصافي الربح', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 'r1', code: '4100', name: 'إيرادات المبيعات', type: 'REVENUE' },
      { id: 'e1', code: '5000', name: 'المصروفات العمومية', type: 'EXPENSE' },
    ]);
    prisma.journalLine.groupBy
      .mockResolvedValueOnce([
        { debitAccountId: 'e1', _sum: { amount: '300' } },
      ])
      .mockResolvedValueOnce([
        { creditAccountId: 'r1', _sum: { amount: '1000' } },
      ]);

    const report = await service.getIncomeStatement({
      from: '2026-09-01',
      to: '2026-09-30',
    });

    // الإيرادات 1000 دائن، المصروفات 300 مدين، الصافي 700.
    expect(report.revenues).toEqual([
      { accountId: 'r1', code: '4100', name: 'إيرادات المبيعات', amount: 1000 },
    ]);
    expect(report.expenses).toEqual([
      {
        accountId: 'e1',
        code: '5000',
        name: 'المصروفات العمومية',
        amount: 300,
      },
    ]);
    expect(report.totalRevenues).toBe(1000);
    expect(report.totalExpenses).toBe(300);
    expect(report.netIncome).toBe(700);
    // التجميع بفلترة تاريخ القيد على النطاق المطلوب (نفس نهج ميزان المراجعة).
    const groupCalls = prisma.journalLine.groupBy.mock
      .calls as unknown as Array<
      [{ where: { journalEntry: { date: Record<string, unknown> } } }]
    >;
    expect(groupCalls[0]?.[0]?.where.journalEntry.date).toEqual({
      gte: new Date('2026-09-01'),
      lte: new Date('2026-09-30'),
    });
  });

  it('قائمة الدخل: النطاق يفترض الشهر الحالي عند غياب التواريخ', async () => {
    const report = await service.getIncomeStatement({});
    const now = new Date();
    const expectedFrom = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
    expect(report.from).toBe(expectedFrom);
    expect(report.netIncome).toBe(0);
  });

  it('كل التقارير ترفض نطاقًا تبدأ نهايته قبل بدايته', async () => {
    await expect(
      service.getIncomeStatement({ from: '2026-09-30', to: '2026-09-01' }),
    ).rejects.toThrow('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    await expect(
      service.getVatReport({ from: '2026-09-30', to: '2026-09-01' }),
    ).rejects.toThrow('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
  });

  // ----------------------------------------------------------------
  // الميزانية العمومية
  // ----------------------------------------------------------------

  it('الميزانية العمومية: الأصول = الالتزامات + حقوق الملكية (مع صافي الربح)', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 'a1', code: '1100', name: 'النقدية', type: 'ASSET' },
      { id: 'l1', code: '2200', name: 'الموردون', type: 'LIABILITY' },
      { id: 'q1', code: '3000', name: 'رأس المال', type: 'EQUITY' },
      { id: 'r1', code: '4100', name: 'المبيعات', type: 'REVENUE' },
      { id: 'e1', code: '5000', name: 'المصروفات', type: 'EXPENSE' },
    ]);
    prisma.journalLine.groupBy
      .mockResolvedValueOnce([
        { debitAccountId: 'a1', _sum: { amount: '800' } },
        { debitAccountId: 'e1', _sum: { amount: '200' } },
      ])
      .mockResolvedValueOnce([
        { creditAccountId: 'l1', _sum: { amount: '400' } },
        { creditAccountId: 'q1', _sum: { amount: '100' } },
        { creditAccountId: 'r1', _sum: { amount: '500' } },
      ]);

    const report = await service.getBalanceSheet({ asOf: '2026-09-30' });

    // أصول 800؛ التزامات 400؛ حقوق 100 + صافي ربح (500-200=300) = 400 → متوازنة.
    expect(report.totalAssets).toBe(800);
    expect(report.totalLiabilities).toBe(400);
    expect(report.netIncome).toBe(300);
    expect(report.totalEquity).toBe(400);
    expect(report.checkAssetsEqualLiabilitiesEquity).toBe(true);
    expect(report.difference).toBe(0);
    // التجميع من بداية الدفاتر حتى asOf (لا gte).
    const groupCalls = prisma.journalLine.groupBy.mock
      .calls as unknown as Array<
      [{ where: { journalEntry: { date: Record<string, unknown> } } }]
    >;
    expect(groupCalls[0]?.[0]?.where.journalEntry.date).toEqual({
      lte: new Date('2026-09-30'),
    });
  });

  it('الميزانية العمومية: يكشف الانحراف بفرق صريح عند اختلال الدفاتر', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 'a1', code: '1100', name: 'النقدية', type: 'ASSET' },
      { id: 'l1', code: '2200', name: 'الموردون', type: 'LIABILITY' },
      { id: 'q1', code: '3000', name: 'رأس المال', type: 'EQUITY' },
      { id: 'r1', code: '4100', name: 'المبيعات', type: 'REVENUE' },
    ]);
    prisma.journalLine.groupBy
      .mockResolvedValueOnce([
        { debitAccountId: 'a1', _sum: { amount: '900' } },
      ])
      .mockResolvedValueOnce([
        { creditAccountId: 'l1', _sum: { amount: '400' } },
        { creditAccountId: 'q1', _sum: { amount: '100' } },
        { creditAccountId: 'r1', _sum: { amount: '300' } },
      ]);

    const report = await service.getBalanceSheet({ asOf: '2026-09-30' });
    // 900 ≠ 400 + (100 + 300) → غير متوازنة بفرق 100.
    expect(report.checkAssetsEqualLiabilitiesEquity).toBe(false);
    expect(report.difference).toBe(100);
  });

  // ----------------------------------------------------------------
  // تقرير VAT
  // ----------------------------------------------------------------

  it('تقرير VAT: الصافي = المخرجات − المدخلات مع استثناء 1330 (سلف العمال)', async () => {
    prisma.account.findMany.mockResolvedValue([
      {
        id: 'input-vat',
        code: '1331',
        name: 'ضريبة مشتريات',
        type: 'ASSET',
      },
      {
        // كود 1330 في هذا المستودع = سلف العمال (وليس ضريبة كما في Selim)
        // — يجب استثناؤه حتى لا يتلوث inputVat بحركة السلف.
        id: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
        code: '1330',
        name: 'سلف العمال',
        type: 'ASSET',
      },
    ]);
    prisma.journalLine.groupBy
      .mockResolvedValueOnce([
        { debitAccountId: VAT_PAYABLE, _sum: { amount: '200' } },
        { debitAccountId: 'input-vat', _sum: { amount: '100' } },
        {
          debitAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
          _sum: { amount: '9999' },
        },
      ])
      .mockResolvedValueOnce([
        { creditAccountId: VAT_PAYABLE, _sum: { amount: '700' } },
      ]);
    prisma.salesOrder.aggregate.mockResolvedValue({
      _sum: { vatAmount: '700', totalAmount: '5700' },
      _count: 5,
    });

    const report = await service.getVatReport({
      from: '2026-09-01',
      to: '2026-09-30',
    });

    // المخرجات = 700 دائن − 200 مدين = 500؛ المدخلات = 100 مدين؛ الصافي 400.
    expect(report.outputVat).toBe(500);
    expect(report.inputVat).toBe(100);
    expect(report.netVat).toBe(400);
    expect(report.vatableSales).toBe(700);
    // المشتريات بلا ضريبة مسجلة في النظام الحالي — صفر موثق.
    expect(report.vatablePurchases).toBe(0);
    expect(report.salesOrders).toEqual({ count: 5, total: 5700 });
    // سلف العمال مستثنى من حسابات الضريبة رغم كود 1330.
    const detailIds = report.details.map(
      (d: { accountId: string }) => d.accountId,
    );
    expect(detailIds).toContain(VAT_PAYABLE);
    expect(detailIds).toContain('input-vat');
    expect(detailIds).not.toContain(CHART_OF_ACCOUNTS.WORKER_ADVANCES);
    // أوامر البيع: المؤكدة/المشحونة فقط (لا مسودات ولا ملغاة).
    const aggregateCalls = prisma.salesOrder.aggregate.mock
      .calls as unknown as Array<
      [{ where: { status: Record<string, unknown> } }]
    >;
    expect(aggregateCalls[0]?.[0]?.where.status).toEqual({
      in: ['CONFIRMED', 'SHIPPED'],
    });
  });

  // ----------------------------------------------------------------
  // أعمار الذمم
  // ----------------------------------------------------------------

  it('أعمار ذمم العملاء: توزيع الأرصدة على الدلاء حسب أقدم أمر مفتوح', async () => {
    prisma.customer.findMany.mockResolvedValue([
      { id: 'c1', name: 'شركة النور', balance: '1000.00' },
      { id: 'c2', name: 'مصنع الشرق', balance: '500.00' },
      { id: 'c3', name: 'بوتيك النيل', balance: '2000.00' },
      { id: 'c4', name: 'عميل تسوية', balance: '300.00' },
    ]);
    prisma.salesOrder.findMany.mockResolvedValue([
      // c1: أمر 10 أيام → 0-30 (باقٍ 1000 من 1500).
      {
        customerId: 'c1',
        dueDate: null,
        createdAt: new Date('2026-09-20'),
        totalAmount: '1500',
        paidAmount: '500',
      },
      // c2: مستحق منذ 45 يومًا → 31-60.
      {
        customerId: 'c2',
        dueDate: new Date('2026-08-16'),
        createdAt: new Date('2026-08-01'),
        totalAmount: '600',
        paidAmount: '100',
      },
      // c3: أمر 112 يومًا → 90+.
      {
        customerId: 'c3',
        dueDate: null,
        createdAt: new Date('2026-06-10'),
        totalAmount: '2500',
        paidAmount: '500',
      },
      // أمر مسدد بالكامل — لا يؤرخ ذمة.
      {
        customerId: 'c1',
        dueDate: new Date('2025-01-01'),
        createdAt: new Date('2025-01-01'),
        totalAmount: '100',
        paidAmount: '100',
      },
    ]);

    const report = (await service.getAging({ asOf: '2026-09-30' })) as {
      type: string;
      buckets: Record<string, number>;
      unallocated: number;
      total: number;
      customers: {
        id: string;
        name: string;
        balance: number;
        bucket: string | null;
      }[];
    };

    expect(report.type).toBe('AR');
    expect(report.buckets).toEqual({
      '0-30': 1000,
      '31-60': 500,
      '61-90': 0,
      '90+': 2000,
    });
    // رصيد بلا أمر مفتوح قابل للتأريخ → غير مخصص منفصلًا.
    expect(report.unallocated).toBe(300);
    expect(report.total).toBe(3800);
    expect(report.customers).toHaveLength(4);
    const c2 = report.customers.find((c) => c.id === 'c2');
    expect(c2).toMatchObject({ balance: 500, bucket: '31-60' });
    // المسدد بالكامل لا يؤرخ — أقدم مفتوح لـ c1 هو أمر 2026-09-20.
    const c1 = report.customers.find((c) => c.id === 'c1');
    expect(c1?.bucket).toBe('0-30');
  });

  it('أعمار الذمم: افتراضي AR، وtype=AP يقرأ الموردين وأوامر الشراء', async () => {
    prisma.supplier.findMany.mockResolvedValue([
      { id: 's1', name: 'مورد الخيامات', balance: '800.00' },
    ]);
    prisma.purchaseOrder.findMany.mockResolvedValue([
      {
        supplierId: 's1',
        dueDate: null,
        createdAt: new Date('2026-09-10'),
        totalAmount: '1200',
        paidAmount: '400',
      },
    ]);

    const report = (await service.getAging({
      asOf: '2026-09-30',
      type: 'AP',
    })) as {
      type: string;
      buckets: Record<string, number>;
      suppliers: {
        id: string;
        name: string;
        balance: number;
        bucket: string | null;
      }[];
    };
    expect(report.type).toBe('AP');
    expect(report.buckets['0-30']).toBe(800);
    expect(report.suppliers[0]).toMatchObject({
      name: 'مورد الخيامات',
      balance: 800,
      bucket: '0-30',
    });
    // أوامر الشراء المفتوحة: المعتمدة/المستلمة فقط.
    const orderCalls = prisma.purchaseOrder.findMany.mock
      .calls as unknown as Array<
      [{ where: { status: Record<string, unknown> } }]
    >;
    expect(orderCalls[0]?.[0]?.where.status).toEqual({
      in: ['APPROVED', 'RECEIVED'],
    });
  });

  // ----------------------------------------------------------------
  // الميزانيات
  // ----------------------------------------------------------------

  it('إنشاء ميزانية: تعارض الفترة (P2002) يُترجم لرسالة عربية', async () => {
    prisma.account.findUnique.mockResolvedValue({ id: 'a1', isGroup: false });
    prisma.budget.findFirst.mockResolvedValue(null);
    prisma.budget.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      service.createBudget({
        accountId: 'a1',
        fiscalYear: 2026,
        period: 'yearly',
        periodIndex: 1,
        amount: 50000,
      }),
    ).rejects.toThrow('ميزانية موجودة لهذا الحساب والفترة');
  });

  it('إنشاء ميزانية: الفحص المسبق يرفض التكرار قبل الوصول للقاعدة', async () => {
    prisma.account.findUnique.mockResolvedValue({ id: 'a1', isGroup: false });
    prisma.budget.findFirst.mockResolvedValue({ id: 'b-existing' });

    await expect(
      service.createBudget({
        accountId: 'a1',
        fiscalYear: 2026,
        period: 'monthly',
        periodIndex: 9,
        amount: 5000,
      }),
    ).rejects.toThrow('ميزانية موجودة لهذا الحساب والفترة');
    expect(prisma.budget.findFirst).toHaveBeenCalledWith({
      where: {
        accountId: 'a1',
        fiscalYear: 2026,
        period: 'monthly',
        periodIndex: 9,
      },
      select: { id: true },
    });
    expect(prisma.budget.create).not.toHaveBeenCalled();
  });

  it('إنشاء ميزانية: حدود رقم الفترة حسب نوعها + رفض الحساب التجميعي', async () => {
    await expect(
      service.createBudget({
        accountId: 'a1',
        fiscalYear: 2026,
        period: 'monthly',
        periodIndex: 13,
        amount: 1000,
      }),
    ).rejects.toThrow('رقم الشهر يجب أن يكون بين 1 و 12');

    await expect(
      service.createBudget({
        accountId: 'a1',
        fiscalYear: 2026,
        period: 'yearly',
        periodIndex: 2,
        amount: 1000,
      }),
    ).rejects.toThrow('ميزانية السنة تستخدم رقم فترة 1');

    prisma.account.findUnique.mockResolvedValue({ id: 'a1', isGroup: true });
    await expect(
      service.createBudget({
        accountId: 'a1',
        fiscalYear: 2026,
        period: 'yearly',
        periodIndex: 1,
        amount: 1000,
      }),
    ).rejects.toThrow('حساب الميزانية غير موجود أو حساب تجميعي');
  });

  it('تباين الميزانية: الفعلي من القيود باتجاه نوع الحساب والتباين = المخطط − الفعلي', async () => {
    prisma.budget.findMany.mockResolvedValue([
      {
        id: 'b1',
        accountId: 'e1',
        costCenterId: null,
        fiscalYear: 2026,
        period: 'yearly',
        periodIndex: 1,
        amount: '1000',
        account: {
          id: 'e1',
          code: '5200',
          name: 'مصروف رواتب',
          type: 'EXPENSE',
        },
      },
    ]);
    prisma.journalLine.groupBy
      .mockResolvedValueOnce([
        { debitAccountId: 'e1', _sum: { amount: '800' } },
      ])
      .mockResolvedValueOnce([]);

    const report = await service.getBudgetVariance(2026);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      accountCode: '5200',
      planned: 1000,
      actual: 800,
      variance: 200,
    });
    expect(report.totalPlanned).toBe(1000);
    expect(report.totalActual).toBe(800);
    expect(report.totalVariance).toBe(200);
    // نافذة السنة كاملة: 2026-01-01 → 2026-12-31 نهاية.
    const groupCalls = prisma.journalLine.groupBy.mock
      .calls as unknown as Array<
      [{ where: { journalEntry: { date: Record<string, unknown> } } }]
    >;
    expect(groupCalls[0]?.[0]?.where.journalEntry.date.gte).toEqual(
      new Date(Date.UTC(2026, 0, 1)),
    );
    expect(groupCalls[0]?.[0]?.where.journalEntry.date.lte).toEqual(
      new Date(Date.UTC(2027, 0, 1).valueOf() - 1),
    );
  });

  it('تباين الميزانية: حساب إيراد يقرأ الفعلي (دائن − مدين)', async () => {
    prisma.budget.findMany.mockResolvedValue([
      {
        id: 'b2',
        accountId: 'r1',
        costCenterId: null,
        fiscalYear: 2026,
        period: 'yearly',
        periodIndex: 1,
        amount: '2000',
        account: { id: 'r1', code: '4100', name: 'المبيعات', type: 'REVENUE' },
      },
    ]);
    prisma.journalLine.groupBy
      .mockResolvedValueOnce([
        { debitAccountId: 'r1', _sum: { amount: '100' } },
      ])
      .mockResolvedValueOnce([
        { creditAccountId: 'r1', _sum: { amount: '1800' } },
      ]);

    const report = await service.getBudgetVariance(2026);
    // إيراد فعلي = 1800 دائن − 100 مدين = 1700؛ التباين 300.
    expect(report.rows[0].actual).toBe(1700);
    expect(report.rows[0].variance).toBe(300);
  });
});
