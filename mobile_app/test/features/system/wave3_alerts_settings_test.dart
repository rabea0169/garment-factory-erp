import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/system/presentation/cubit/alerts_cubit.dart';
import 'package:garment_factory_erp/features/system/presentation/screens/factory_settings_screen.dart';

/// SELIM-ERP W3 — اختبارات منطق الجرس والإعدادات: تحويل درجة خطورة
/// التنبيه من نوعه النصي + مساعدي الشعار (data-URL وحد الحجم).
void main() {
  group('SmartAlert.severity (نفس خريطة المرجع)', () {
    SmartAlert alertOf(String type) => SmartAlert(
          id: 'x',
          type: type,
          title: 't',
          message: 'm',
          icon: '🔔',
        );

    test('danger/success/info تحليل مباشر', () {
      expect(alertOf('danger').severity, AlertSeverity.danger);
      expect(alertOf('success').severity, AlertSeverity.success);
      expect(alertOf('info').severity, AlertSeverity.info);
    });

    test('الأنواع غير المعروفة تُعامل تحذيرًا (افتراض آمن)', () {
      expect(alertOf('whatever').severity, AlertSeverity.warning);
      expect(alertOf('').severity, AlertSeverity.warning);
    });

    test('fromJson: القيم الافتراضية عند نقص الحقول', () {
      final alert = SmartAlert.fromJson(const {
        'id': 'a1',
        'type': 'info',
      });
      expect(alert.title, '');
      expect(alert.icon, '🔔');
      expect(alert.actionLabel, isNull);
      expect(alert.actionRoute, isNull);
    });

    test('fromJson: actionRoute يمر كما هو (مسارات التطبيق الفعلية)', () {
      final alert = SmartAlert.fromJson(const {
        'id': 'a2',
        'type': 'danger',
        'actionLabel': 'نسخ احتياطي',
        'actionRoute': '/backup',
      });
      expect(alert.actionRoute, '/backup');
      expect(alert.severity, AlertSeverity.danger);
    });
  });

  group('logoDataUrlFromBytes', () {
    test('PNG صالح → data-URL بـ base64', () {
      final url = logoDataUrlFromBytes([1, 2, 3], 'image/png');
      expect(url, 'data:image/png;base64,AQID');
    });

    test('image/jpg يُطبَّع إلى image/jpeg', () {
      final url = logoDataUrlFromBytes([1], 'image/jpg');
      expect(url, startsWith('data:image/jpeg;base64,'));
    });

    test('null mime → png افتراضيًا', () {
      expect(logoDataUrlFromBytes([1], null),
          'data:image/png;base64,AQ==');
    });

    test('نوع غير صورة → null (يمنع svg/نص ضار)', () {
      expect(logoDataUrlFromBytes([1], 'image/svg+xml'), isNull);
      expect(logoDataUrlFromBytes([1], 'text/html'), isNull);
    });

    test('بايتات فارغة → null', () {
      expect(logoDataUrlFromBytes(const [], 'image/png'), isNull);
    });
  });

  group('isLogoSizeAllowed (حد 512KB كالخادم)', () {
    test('صفر بايت مرفوض (ليس صورة)', () {
      expect(isLogoSizeAllowed(0), isFalse);
    });

    test('ضمن الحد مقبول — والحد نفسه مقبول (بلا سقف أقل)', () {
      expect(isLogoSizeAllowed(1), isTrue);
      expect(isLogoSizeAllowed(512 * 1024), isTrue);
    });

    test('فوق الحد مرفوض', () {
      expect(isLogoSizeAllowed(512 * 1024 + 1), isFalse);
    });
  });
}
