import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/services/cache_service.dart';
import 'package:garment_factory_erp/core/services/outbox_service.dart';

/// MOB-3: مسار "Hive غير مُهيأ" (مثل اختبارات واجهة لا تفتح Hive) —
/// الخدمتان تتعطلان بصمت: لا كاش ولا طابور ولا استثناءات غير معالجة،
/// ويعمل باقي التطبيق كالمعتاد متصلًا.
///
/// ملف منفصل عمدًا: Hive يُهيأ مرة واحدة لكل process اختبار — هذا
/// الملف لا يستدعي Hive.init إطلاقًا.
void main() {
  group('CacheService بلا تهيئة Hive', () {
    test('init يفشل بهدوء ويبطل الخدمة', () async {
      final cache = CacheService();
      expect(await cache.init(), isFalse);
      expect(await cache.read('any'), isNull);
      // no-op — لا استثناء.
      await cache.writeThrough('any', {'x': 1});
      expect(await cache.read('any'), isNull);
      await cache.clear();
    });
  });

  group('OutboxService بلا تهيئة Hive', () {
    test('الإدراج يفشل بوضوح (null) والعدد يبقى 0', () async {
      final outbox = OutboxService(dio: Dio());
      expect(await outbox.init(), isFalse);
      final entry = await outbox.enqueue(
        method: 'POST',
        path: '/hr/production',
        body: {'workerId': 'w-1', 'piecesCount': 3},
      );
      expect(entry, isNull);
      expect(outbox.pendingCount, 0);
      // drain no-op (لا إرسال ولا استثناء).
      await outbox.drain();
    });
  });
}
