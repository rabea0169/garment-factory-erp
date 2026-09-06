import { Prisma } from '@prisma/client';
import { round2, round4, toDecimal } from './money.util';

/**
 * GF-IMP-W2 / CC-3: مواصفة أداة المال الموحدة — تثبت سلوك التقريب عند
 * الحواف وتمنع انحراف النسخ المحلية المستقبلية عن السياسة المركزية.
 */
describe('money.util (CC-3)', () => {
  describe('round2 — مبالغ Decimal(10,2)', () => {
    it('يقرب نصف القرش لأعلى (نفس سلوك النسخ المكررة القائمة)', () => {
      expect(round2(1.005)).toBe(1.01);
      expect(round2(2.675)).toBe(2.68);
    });

    it('يحسم التمثيل العائم قبل التقريب (0.1 + 0.2)', () => {
      expect(round2(0.1 + 0.2)).toBe(0.3);
    });

    it('يبقي القيم السليمة كما هي (والسالب نصف-لأعلى نحو +∞ دلالة JS)', () => {
      expect(round2(46.25)).toBe(46.25);
      expect(round2(0)).toBe(0);
      // Math.round في JS تقرب نصف القيمة نحو +∞: -555.5 → -555 لا -556.
      // التوثيق مهم: القيم السالبة تعتمد السلوك القياسي للمنصة.
      expect(round2(-5.555)).toBe(-5.55);
    });
  });

  describe('round4 — كميات Decimal(10,4)', () => {
    it('يقرب إلى أربع منازل', () => {
      expect(round4(2.55555)).toBe(2.5556);
      expect(round4(2.55554)).toBe(2.5555);
    });

    it('يحسم 0.1 + 0.2 عند حدود أربع منازل (PUR-2)', () => {
      expect(round4(0.1 + 0.2)).toBe(0.3);
    });
  });

  describe('toDecimal — انتقال آمن إلى Decimal', () => {
    it('يمرر Prisma.Decimal كما هو بلا أي تحويل', () => {
      const original = new Prisma.Decimal('46.24815');
      const result = toDecimal(original);
      expect(result).toBe(original);
      expect(result.toString()).toBe('46.24815');
    });

    it('يبني Decimal من number بدقة القيمة الأصلية', () => {
      const result = toDecimal(46.25);
      expect(result.toString()).toBe('46.25');
    });
  });
});
