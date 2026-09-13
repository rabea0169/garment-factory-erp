/**
 * SELIM-ERP W2 — QR إيصار نقطة البيع بترميز TLV (ETA).
 *
 * **ترميز محلي فقط** — لا تكامل خارجي: طُلب استثناء تكاملات الفاتورة
 * الإلكترونية (تقديم/توقيع/إرسال للضرائب) وبقي ترميز QR المحلي الذي
 * يطبع على الإيصار. حقل 6 (UUID) وحقل 9 (توقيع ETA) لا يُشفران لأنهما
 * من مخرجات التكامل المستثنى — يشمل الوسم 1-5 عند توفر بيانات التسجيل.
 *
 * Tags (ETA spec):
 *   1 = اسم البائع · 2 = رقم التسجيل الضريبي · 3 = طابع زمني ISO
 *   4 = إجمالي الفاتورة · 5 = إجمالي الضريبة
 *
 * عند غياب COMPANY_VAT_NUMBER من env (بيئة UAT مثلًا) نرجع نصًا عاديًا
 * (كود الفاتورة + الإجمالي + التاريخ) — نفس سقوط Selim للـ QR النصي.
 */

/** قيمة وسوم TLV — سلسلة نصية أو رقم عشري بنصّه. */
type TlvValue = string;

function encodeTlv(tag: number, value: TlvValue): Buffer {
  const valueBytes = Buffer.from(value, 'utf8');
  // Header: tag (1B) + length (1B) + value — قيم الوسوم قصيرة دائمًا.
  return Buffer.concat([Buffer.from([tag, valueBytes.length]), valueBytes]);
}

/** هل بيانات التسجيل الضريبي مهيأة (TLV ممكن)؟ */
export function isEtaQrConfigured(): boolean {
  const vat = (process.env.COMPANY_VAT_NUMBER ?? '').trim();
  return vat.length > 0;
}

export interface ReceiptQrInput {
  code: string;
  total: number;
  vatAmount: number;
  createdAt: Date;
  /**
   * SELIM-ERP W3: بيانات التسجيل من إعدادات المصنع (الأسبقية على env) —
   * يمررها PosService من FactorySettings. undefined = env فقط.
   * enableInvoiceQr=false من الإعدادات يعطّل QR كليًا (نص فارغ).
   */
  sellerName?: string;
  vatNumber?: string;
  enableInvoiceQr?: boolean;
}

/**
 * حِمل QR للإيصار — TLV base64 عند التهيئة، وإلا نص عادي.
 */
export function buildReceiptQrPayload(input: ReceiptQrInput): string {
  // W3: الإعدادات تعطّل QR للفواتير كليًا.
  if (input.enableInvoiceQr === false) return '';
  const settingsVat = (input.vatNumber ?? '').trim();
  const envVat = (process.env.COMPANY_VAT_NUMBER ?? '').trim();
  if (settingsVat.length > 0 || isEtaQrConfigured()) {
    const sellerName = (
      input.sellerName ??
      process.env.COMPANY_NAME ??
      'شركة غير مسماة'
    ).trim();
    const vatNumber = settingsVat.length > 0 ? settingsVat : envVat;
    const timestamp = input.createdAt.toISOString();
    const total = input.total.toFixed(2);
    const vat = input.vatAmount.toFixed(2);
    const tlv = Buffer.concat([
      encodeTlv(1, sellerName),
      encodeTlv(2, vatNumber),
      encodeTlv(3, timestamp),
      encodeTlv(4, total),
      encodeTlv(5, vat),
    ]);
    return tlv.toString('base64');
  }
  return `فاتورة ${input.code} | إجمالي ${input.total.toFixed(2)} ج.م | ${input.createdAt.toLocaleDateString('ar-EG')}`;
}
