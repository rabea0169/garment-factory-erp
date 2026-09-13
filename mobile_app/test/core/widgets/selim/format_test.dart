import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/widgets/selim/format.dart';

/// أدوات التنسيق العربي الموحدة (selim/format.dart) — حالات الحدود:
/// فواصل الآلاف، قص المنازل العشرية الزائدة، التواريخ الفارغة/غير الصالحة،
/// والقراءة الآمنة للأرقام من JSON (Decimal يصل كنص من الخادم).
void main() {
  group('money — مبلغ مالي بمنزلتين وفواصل آلاف', () {
    test('فواصل الآلاف مع المنزلتين', () {
      expect(money(1234.5), '1,234.50 ج.م');
      expect(money(1234567.891), '1,234,567.89 ج.م');
      expect(money(1000), '1,000.00 ج.م');
    });

    test('الصفر والقيم الصغيرة', () {
      expect(money(0), '0.00 ج.م');
      expect(money(7), '7.00 ج.م');
      expect(money(0.5), '0.50 ج.م');
    });

    test('السالب يبقي الإشارة قبل فاصل الآلاف', () {
      expect(money(-42), '-42.00 ج.م');
      expect(money(-1234567.89), '-1,234,567.89 ج.م');
    });

    test('لاحقة عملة بديلة', () {
      expect(money(5, suffix: 'ر.س'), '5.00 ر.س');
    });
  });

  group('qty — كمية بحد أقصى 3 منازل مع قص الأصفار', () {
    test('قص الأصفار الزائدة (سلاسل قصيرة بلا تجميع)', () {
      expect(qty(2.5), '2.5');
      expect(qty(2.0), '2');
      expect(qty(0.0), '0');
      expect(qty(0.5), '0.5');
      expect(qty(-5.5), '-5.5');
    });

    test('الأعداد الصحيحة تجمع بفواصل الآلاف', () {
      expect(qty(1234), '1,234');
      expect(qty(12), '12');
      expect(qty(0), '0');
    });

    test('الكميات: تجميع الجزء الصحيح فقط والكسر يبقى سليمًا (إصلاح SELIM)', () {
      expect(qty(1234.5678), '1,234.568');
      expect(qty(98.5), '98.5');
      expect(qty(10.12), '10.12');
      expect(qty(-1234.5), '-1,234.5');
      expect(qty(1234567.25), '1,234,567.25');
      expect(qty(50), '50');
      expect(qty(0), '0');
    });
  });

  group('count — عدد صحيح بفواصل آلاف', () {
    test('التقريب للصحيح', () {
      expect(count(1234.6), '1,235');
      expect(count(1234.4), '1,234');
      expect(count(0), '0');
      expect(count(1250000), '1,250,000');
    });
  });

  group('date — تواريخ dd/mm/yyyy مع حالات الحدود', () {
    test('null → شرطة', () {
      expect(date(null), '—');
    });

    test('نص غير صالح → شرطة', () {
      expect(date('not-a-date'), '—');
      expect(date(''), '—');
    });

    test('نص ISO و DateTime بنفس الصيغة', () {
      expect(date('2026-09-13T10:30:00Z'), '13/09/2026');
      expect(date('2026-09-13'), '13/09/2026');
      expect(date(DateTime(2026, 9, 13)), '13/09/2026');
    });

    test('أيام وأشهر بلا صفر بادئ داخل المصدر', () {
      expect(date(DateTime(2026, 1, 5)), '05/01/2026');
      expect(date(DateTime(2026, 12, 31)), '31/12/2026');
    });
  });

  group('dateTime — تاريخ ووقت بفترة ص/م', () {
    test('فترة صباحية', () {
      expect(dateTime('2026-09-13T02:30:00Z'), '13/09/2026 · 2:30 ص');
    });

    test('فترة مسائية والزوال 12', () {
      expect(dateTime('2026-09-13T14:30:00Z'), '13/09/2026 · 2:30 م');
      expect(dateTime(DateTime(2026, 9, 13, 12, 0)), '13/09/2026 · 12:00 م');
      expect(dateTime(DateTime(2026, 9, 13, 0, 5)), '13/09/2026 · 12:05 ص');
    });

    test('null وغير الصالح → شرطة', () {
      expect(dateTime(null), '—');
      expect(dateTime('bad'), '—');
    });
  });

  group('asNum — قراءة رقم آمنة من JSON', () {
    test('null يرجع البديل', () {
      expect(asNum(null), 0);
      expect(asNum(null, 9), 9);
    });

    test('num يمر كما هو', () {
      expect(asNum(12.5), 12.5);
      expect(asNum(7), 7);
    });

    test('نص رقمي (Decimal من الخادم) يُحلّل', () {
      expect(asNum('1250.50'), 1250.5);
      expect(asNum('42'), 42);
    });

    test('نص غير رقمي يرجع البديل', () {
      expect(asNum('abc'), 0);
      expect(asNum('abc', 3), 3);
      expect(asNum(''), 0);
    });
  });
}
