/**
 * A1/A2/A3: دفتر الحسابات الافتراضي (Chart of Accounts).
 *
 * هذه معرفات ثابتة (seeds) للحسابات الأساسية في النظام، يستوردها كل
 * موديول يحتاج قيدًا مزدوجًا دون أن يضطر للبحث بالـ code في كل مرة. تُنشأ
 * في prisma/seed.ts ويُعتمد عليها عبر كل الـ migrations اللاحقة (لا تُحذف).
 *
 * النمط: ضع الحسابات النظامية هنا (مخزون، عملاء، موردون، نقدية، إيراد،
 * ضريبة، مصروف)، واترك الحسابات التحليلية لمستخدم الـ ACCOUNTANT ينشئها
 * عبر POST /accounting/accounts.
 *
 * التوافق المحاسبي المصري (A10 — VAT 14%):
 *   - 1000 الأصول
 *   - 1100 النقدية والبنوك
 *   - 1200 العملاء (ذمم مدينة)
 *   - 1300 المخزون
 *   - 2000 المطلوبات
 *   - 2200 الموردون (ذمم دائنة)
 *   - 2300 الضريبة المستحقة (VAT payable)
 *   - 3000 حقوق الملكية
 *   - 4000 الإيرادات
 *   - 4100 مبيعات
 *   - 5000 المصروفات
 */

export const CHART_OF_ACCOUNTS = {
  // 1100 — النقدية والبنوك. كل خزينة في Treasury model تُمثل خزينة فيزيائية،
  // لكن القيود المالية تتطلب حسابًا محاسبيًا مرتبطًا. هذا الحساب الافتراضي
  // يُمثل "النقدية بالصندوق"؛ يمكن إضافة حسابات بنكية لاحقًا.
  CASH: '10000000-0000-0000-0000-000000000011',
  BANK: '10000000-0000-0000-0000-000000000012',

  // 1200 — العملاء (A/R control account).
  ACCOUNTS_RECEIVABLE: '10000000-0000-0000-0000-000000000021',

  // 1300 — المخزون (الخامات + التام).
  INVENTORY: '10000000-0000-0000-0000-000000000031',

  // 1310 — المخزون: المنتج التام (Finished Goods). يحمل رصيد المنتج التام
  // المُرحَّل من WIP عند إكمال أمر التشغيل (ACC-F01 / OPS-F01).
  FINISHED_GOOD_STOCK: '10000000-0000-0000-0000-000000000032',

  // 1320 — المخزون: تحت التشغيل (Work-in-Process / WIP). يحمل قيمة الخامات
  // المُستهلكة في الإنتاج قبل ترحيلها إلى المنتج التام (ACC-F01).
  WIP: '10000000-0000-0000-0000-000000000033',

  // 1330 — سلف العمال (Worker Advances). أصل قابل للاسترداد من الأجر؛
  // يُقيد عند صرف سلفة عامل ويُخصم عند تسوية المرتب (Wave2: HR/Payroll GL posting).
  WORKER_ADVANCES: '10000000-0000-0000-0000-000000000051',

  // 2200 — الموردون (A/P control account).
  ACCOUNTS_PAYABLE: '20000000-0000-0000-0000-000000000021',

  // 2300 — ضريبة القيمة المضافة المستحقة (VAT payable).
  VAT_PAYABLE: '20000000-0000-0000-0000-000000000031',

  // 2400 — الأجور المستحقة (Salaries Payable). التزام يُقيد عند إقفال الفترة
  // بقيمة المرتب الصافي المستحق قبل الصرف (Wave2: payroll GL posting).
  SALARIES_PAYABLE: '20000000-0000-0000-0000-000000000041',

  // 3000 — حقوق الملكية.
  OWNERS_EQUITY: '30000000-0000-0000-0000-000000000001',

  // 4100 — إيرادات المبيعات.
  SALES_REVENUE: '40000000-0000-0000-0000-000000000011',

  // 4200 — إيراد تسوية الجرد الموجبة (Inventory Adjustment Income).
  // يُقيد عند زيادة المخزون الفعلي عن الدفتري (OPS-F01 / ADJUSTMENT موجبة).
  INVENTORY_ADJUSTMENT_INCOME: '40000000-0000-0000-0000-000000000021',

  // 5100 — تكلفة البضاعة المباعة.
  COST_OF_GOODS_SOLD: '50000000-0000-0000-0000-000000000021',

  // 5000 — المصروفات (مصروف عام للسندات النثرية).
  GENERAL_EXPENSE: '50000000-0000-0000-0000-000000000011',

  // 5300 — مصروف الهدر (Waste Expense). يُقيد بقيمة الخامات المُتلَفة
  // عند استدعاء inventory.waste() (OPS-F01 / OPS-F11).
  WASTE_EXPENSE: '50000000-0000-0000-0000-000000000031',

  // 5400 — مصروف تسوية الجرد السالبة (Inventory Adjustment Expense).
  // يُقيد عند نقص المخزون الفعلي عن الدفتري (OPS-F01 / ADJUSTMENT سالبة).
  INVENTORY_ADJUSTMENT_EXPENSE: '50000000-0000-0000-0000-000000000041',

  // 5500 — مصروف الأجور (Salaries Expense). يُقيد بقيمة المرتب المُستحق
  // على الفترة عند إقفالها (Wave2: payroll GL posting — يقابله SALARIES_PAYABLE).
  SALARIES_EXPENSE: '50000000-0000-0000-0000-000000000051',

  // 5600 — مصروف الشحن (Shipping Expense). يُقيد بقيمة الشحن على أمر
  // البيع عند تأكيده (Wave2: shipment costing GL posting).
  SHIPPING_EXPENSE: '50000000-0000-0000-0000-000000000061',
} as const;

export type ChartOfAccountKey = keyof typeof CHART_OF_ACCOUNTS;

/**
 * E5: معرفات العملات الافتراضية (Currencies).
 *
 * تُستخدم من الخدمات التي تنشئ قيودًا متعددة العملات. تُنشأ في prisma/seed.ts
 * وفي الـ migration نفسه (لضمان وجودها على DB نظيف قبل تشغيل أي seed).
 *
 * EGP هي عملة النظام الافتراضية — كل قيد بلا currencyId يُعتبر EGP بـ rate=1.0.
 * USD عملة مرجعية لميزات FX المستقبلية.
 */
export const CURRENCIES = {
  EGP: '00000000-0000-0000-0000-000000000101',
  USD: '00000000-0000-0000-0000-000000000102',
} as const;

export type CurrencyKey = keyof typeof CURRENCIES;

/**
 * A10: معدل ضريبة القيمة المضافة المصري (14% اعتبارًا من 2015-07-01).
 *
 * المصدر: قانون الضرائب المصري رقم 67 لسنة 2016 — جدول معدلات الضريبة.
 * النسبة تُطبَّق على المبلغ الخاضع للضريبة (subtotal − discount).
 *
 * لا تجعلها قابلة للضبط عبر env في هذه المرحلة — معدل الـ VAT يتطلب قرارًا
 * تنظيميًا + مراجعة محاسبية، وليس متغيرًا تشغيليًا. إذا تغير المعدل مستقبلًا،
 * يُعدَّل هذا الثابت + يُهاجر إلى نمط تاريخي (effective-from/to).
 */
export const EGYPT_VAT_RATE = 0.14;

/**
 * حساب الـ VAT على أمر بيع.
 *
 * @param subtotal  مجموع بنود الأمر قبل الخصم (sum of unitPrice × quantity).
 * @param discount  الخصم الإجمالي على الأمر.
 * @returns `{ taxableBase, vatAmount, totalAmount }`:
 *   - taxableBase: المبلغ الخاضع للضريبة (subtotal − discount، لا يقل عن 0).
 *   - vatAmount: taxableBase × EGYPT_VAT_RATE.
 *   - totalAmount: taxableBase + vatAmount.
 */
export function computeVat(
  subtotal: number,
  discount: number,
): {
  taxableBase: number;
  vatAmount: number;
  totalAmount: number;
} {
  // الـ discount لا يمكن أن يجعل taxableBase سالبًا — نُحدّده عند 0.
  const taxableBase = Math.max(0, subtotal - discount);
  const vatAmount = Math.round(taxableBase * EGYPT_VAT_RATE * 100) / 100;
  const totalAmount = Math.round((taxableBase + vatAmount) * 100) / 100;
  return { taxableBase, vatAmount, totalAmount };
}
