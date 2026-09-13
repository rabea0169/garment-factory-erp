import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/utils/arabic_text.dart';

/// SELIM-ERP W3 — اختبارات تطبيع النص العربي (نفس حالات T57/T62 في
/// المرجع — سلوك موحد بين الجهاز والخادم).
void main() {
  group('normalizeArabicText', () {
    test('يوحّد الهمزات (أ/إ/آ/ٱ → ا)', () {
      expect(normalizeArabicText('أحمد'), 'احمد');
      expect(normalizeArabicText('إبراهيم'), 'ابراهيم');
      expect(normalizeArabicText('آمنة'), 'امنه');
    });

    test('يوحّد ى/ئ → ي و ة → ه و ؤ → و', () {
      expect(normalizeArabicText('عليى'), 'عليي');
      expect(normalizeArabicText('حمزة'), 'حمزه');
      expect(normalizeArabicText('ؤ'), 'و');
    });

    test('يزيل التشكيل والتطويل ويضغط الفراغات', () {
      expect(normalizeArabicText('مُحَمَّد'), 'محمد');
      expect(normalizeArabicText('تيــشيرت'), 'تيشيرت');
      expect(normalizeArabicText('محمد   احمد'), 'محمد احمد');
    });

    test('يحوّل الأرقام الهندية/الفارسية لغربية ويصغّر الإنجليزية', () {
      expect(normalizeArabicText('٠١٢٣'), '0123');
      expect(normalizeArabicText('۹۸'), '98');
      expect(normalizeArabicText('T-Shirt'), 't-shirt');
    });

    test('null يُعالج بأمان', () {
      expect(normalizeArabicText(null), '');
    });
  });

  group('startsWithAr / wordStartsAr / containsAr', () {
    test('startsWithAr: بداية النص بعد التطبيع', () {
      expect(startsWithAr('مح', 'محمد احمد'), isTrue);
      expect(startsWithAr('مح', 'أحمد محمد'), isFalse);
    });

    test('wordStartsAr: حدود الكلمة الحقيقية', () {
      expect(wordStartsAr('احمد', 'أ/احمد الغمراوي'), isTrue);
      expect(wordStartsAr('احمد', 'محمد احمد'), isTrue);
      expect(wordStartsAr('احمد', 'محمد-احمد'), isTrue);
      expect(wordStartsAr('ابو', 'احمد (ابو محمد)'), isTrue);
      // منتصف الكلمة ليس بداية كلمة.
      expect(wordStartsAr('لا', 'اسلام'), isFalse);
      // الأرقام بعد فاصل بداية كلمة.
      expect(wordStartsAr('20', 'سوستة 20 سم'), isTrue);
    });

    test('containsAr: يحتوي بعد التطبيع', () {
      expect(containsAr('012', '٠١٢٣٤٥٦٧٨٩'), isTrue);
      expect(containsAr('حمد', 'أحمد'), isTrue);
    });

    test('الاستعلام الفارغ يطابق الكل', () {
      expect(startsWithAr('', 'أي نص'), isTrue);
      expect(wordStartsAr('', 'أي نص'), isTrue);
      expect(containsAr('', 'أي نص'), isTrue);
    });
  });
}
