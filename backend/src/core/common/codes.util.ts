import { randomBytes } from 'node:crypto';

/**
 * A7: مولّد أكواد المستندات — عشوائي مشفّر بدل Date.now() التقليدي.
 *
 * النمط: `{PREFIX}-{YYYYMMDD}-{XXXXXXXX}`
 *   - PREFIX:  ثابت لكل نوع مستند (SO/CUST/VCH/JE/SLE/WO/SHP/PO/...)
 *   - YYYYMMDD: تاريخ الإنشاء (للترتيب الزمني وسهولة الفحص البصري)
 *   - XXXXXXXX: 8 أحرف hex عشوائية من crypto.randomBytes (32 bits إنتروبيا)
 *
 * لماذا ليس Date.now()؟
 *   - Date.now() يصطدم عند إنشاء مستندين في نفس الميلي ثانية (NaN-N درجة سباق).
 *   - يكشف توقيت الإنشاء بدقة — معلومات لا حاجة لكشفها للعميل.
 *   - غير قابل للبحث عن النمط (كل الأكواد تبدو متشابهة من حيث الـ prefix فقط).
 *
 * 8 hex chars = 4 bytes = 2^32 = 4.3 مليار احتمال لكل يوم،
 * صعوبة الاصطدام: ~1 في 4.3 مليار لكل زوج مستندات في نفس اليوم.
 */
export function generateDocumentCode(prefix: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${today}-${random}`;
}

/**
 * قائمة الـ prefixes الموحدة عبر النظام — تُستخدم لتسهيل البحث وفلترة الـ logs.
 * لا تُستخدم إلزامياً (مجرد مرجع) لكن يُفضّل استخدامها لكل نوع مستند.
 */
export const DocumentCodePrefix = {
  SALES_ORDER: 'SO',
  CUSTOMER: 'CUST',
  VOUCHER: 'VCH',
  JOURNAL_ENTRY: 'JE',
  STOCK_LEDGER_ENTRY: 'SLE',
  WORK_ORDER: 'WO',
  SHIPMENT: 'SHP',
  PURCHASE_ORDER: 'PO',
  PURCHASE_RECEIPT: 'GRN',
  CUSTOMER_PAYMENT: 'CP',
  SUPPLIER_PAYMENT: 'SP',
  SALES_RETURN: 'SRET',
  SUPPLIER: 'SUP',
  WORKER: 'WRK',
  IDENTITY_DOC: 'ID',
} as const;
