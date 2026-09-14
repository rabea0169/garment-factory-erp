import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/utils/file_name_sanitizer.dart';

/// SELIM-ERP W3 — اختبارات تنقية أسماء ملفات التصدير (رموز النظام
/// والمسارات والطول) — نفس عائلة safeReceiptFilename في المرجع.
void main() {
  group('sanitizeFileName', () {
    test('يزيل رموز نظام الملفات المحظورة', () {
      expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
    });

    test('يستبدل الفراغات بشرطة سفلية', () {
      expect(sanitizeFileName('كشف حساب عميل'), 'كشف_حساب_عميل');
    });

    test('يقصّ الأسماء الأطول من 60 حرفًا', () {
      final long = 'x' * 80;
      expect(sanitizeFileName(long).length, 60);
    });

    test('اسم فارغ/رموز فقط → file', () {
      expect(sanitizeFileName(''), 'file');
      expect(sanitizeFileName('???'), 'file');
    });

    test('يبقي الأحرف العربية والإنجليزية والأرقام كما هي', () {
      expect(sanitizeFileName('statement_C1-2026.pdf'),
          'statement_C1-2026.pdf');
    });
  });
}
