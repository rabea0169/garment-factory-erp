/**
 * GF-IMP-W2 / CC-3: أداة المال الموحدة — حد واحد لقاعدة الانتقال من
 * العائم إلى Decimal في كل النظام.
 *
 * قبل هذه الأداة كانت دالة round2 منسوخة محليًا في موديولين على الأقل
 * (sales.service وinventory.service) وكل موديول يقرر لنفسه سلوك التقريب،
 * فتتوالد انحرافات القروش بين المسارات. الأداة تفرض سياسة واحدة موثقة:
 *
 * - المبالغ المالية (أعمدة Decimal(10,2)): تقريب منزلتين نصف-لأعلى عبر
 *   round2 (مع Number.EPSILON لمعالجة العائم الثنائي) — سلوك نسخة sales
 *   الأدق؛ نسخة inventory القديمة كانت تفقد نصف-القرش في الحواف.
 * - الكميات (أعمدة Decimal(10,4)): تقريب أربع منازل عبر round4.
 * - toDecimal: تحويل آمن إلى Prisma.Decimal بلا مرور بـ number إضافي —
 *   للقيم العددية الموجودة أصلًا؛ القيمة Decimal تُمرَّر كما هي.
 *
 * الحدود الموثقة: الأداة لا تحل مشكلة ضرب العائم أصلًا (مثل 0.1+0.2) —
 * هي تحدد نقطة الانتقال النهائية إلى Decimal فقط. المسارات الحساسة
 * (ترحيل القيود) تمرر Prisma.Decimal كما هو منذ PRD-5.
 */
import { Prisma } from '@prisma/client';

/** تقريب مبلغ مالي إلى منزلتين — لأعمدة Decimal(10,2). */
export function round2(value: number): number {
  // Number.EPSILON يعالج تمثيل العائم الثنائي (1.005 مخزنة 1.00499...)
  // فيتيح تقريب نصف-القرش لأعلى — المعيار المحاسبي. هذا سلوك نسخة sales
  // الأدق من نسخة inventory القديمة (بلا EPSILON) — التوحيد على الأصح.
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** تقريب كمية إلى أربع منازل — لأعمدة Decimal(10,4). */
export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/**
 * تحويل قيمة إلى Prisma.Decimal بأقل تحلل ممكن:
 * - Decimal يُعاد كما هو (بلا تحويل عبر number).
 * - number يُمرَّر إلى Decimal مباشرة (بناء Decimal من number أصدق من
 *   fromString(number.toString()) في Prisma — كلاهما مقبول هنا).
 */
export function toDecimal(value: number | Prisma.Decimal): Prisma.Decimal {
  if (Prisma.Decimal.isDecimal(value)) {
    return value;
  }
  return new Prisma.Decimal(value);
}
