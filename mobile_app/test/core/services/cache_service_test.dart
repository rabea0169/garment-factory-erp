import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';

import 'package:garment_factory_erp/core/services/cache_service.dart';

/// MOB-3: CacheService فوق Hive — write/read/expiry. صندوق Hive حقيقي
/// في مجلد مؤقت (لا mock) كي تُغطى التسلسل/القراءة الفعليان.
void main() {
  late Directory tempDir;

  setUpAll(() async {
    tempDir = await Directory.systemTemp.createTemp('gf_cache_test_');
    Hive.init(tempDir.path);
  });

  tearDownAll(() async {
    await Hive.close();
    await tempDir.delete(recursive: true);
  });

  setUp(() async {
    // عزل بين الاختبارات: تفريغ الصندوق إن كان مفتوحًا من اختبار سابق.
    if (Hive.isBoxOpen(CacheService.boxName)) {
      await Hive.box(CacheService.boxName).clear();
    }
  });

  group('writeThrough / read', () {
    test('يعيد آخر قيمة كتبت مع طابع زمني حديث', () async {
      final cache = CacheService();
      expect(await cache.init(), isTrue);

      await cache.writeThrough('workers', [
        {'id': 'w-1', 'name': 'أحمد'},
        {'id': 'w-2', 'name': 'سعيد'},
      ]);

      final snapshot = await cache.read('workers');
      expect(snapshot, isNotNull);
      final data = snapshot!.data as List;
      expect(data.length, 2);
      // Hive يعيد الخرائط بروابط dynamic — الشكل محفوظ.
      expect(Map<String, dynamic>.from(data.first as Map)['name'], 'أحمد');
      expect(
        snapshot.cachedAt.difference(DateTime.now()).abs(),
        lessThan(const Duration(seconds: 5)),
      );
    });

    test('الكتابة الثانية تستبدل الأولى (write-through)', () async {
      final cache = CacheService();
      await cache.init();
      await cache.writeThrough('k', 'v1');
      await cache.writeThrough('k', 'v2');
      final snapshot = await cache.read('k');
      expect(snapshot?.data, 'v2');
    });

    test('مفتاح غائب → null', () async {
      final cache = CacheService();
      await cache.init();
      expect(await cache.read('missing'), isNull);
    });
  });

  group('انتهاء الصلاحية (maxAge)', () {
    test('إدخال أقدم من maxAge يُتجاهل ويُحذف', () async {
      final cache = CacheService();
      await cache.init();
      // كتابة إدخال قديم مباشرة في الصندوق (تجاوز writeThrough الذي
      // يختم بالوقت الحالي) لمحاكاة كاش متقادم.
      final box = Hive.box(CacheService.boxName);
      await box.put('old', <String, dynamic>{
        'cachedAt': DateTime.now()
            .subtract(const Duration(hours: 3))
            .millisecondsSinceEpoch,
        'data': 'stale',
      });

      final fresh = await cache.read('old', maxAge: const Duration(hours: 1));
      expect(fresh, isNull);
      // الإدخال المنتهي يُحذف من التخزين.
      expect(box.containsKey('old'), isFalse);
    });

    test('إدخال داخل maxAge يُعاد', () async {
      final cache = CacheService();
      await cache.init();
      await cache.writeThrough('fresh', 'value');
      final snapshot =
          await cache.read('fresh', maxAge: const Duration(hours: 1));
      expect(snapshot?.data, 'value');
    });

    test('العمر الافتراضي (24 ساعة) يعيد إدخال عمره ساعتان', () async {
      final cache = CacheService();
      await cache.init();
      final box = Hive.box(CacheService.boxName);
      await box.put('today', <String, dynamic>{
        'cachedAt': DateTime.now()
            .subtract(const Duration(hours: 2))
            .millisecondsSinceEpoch,
        'data': 42,
      });
      final snapshot = await cache.read('today');
      expect(snapshot?.data, 42);
    });
  });

  group('قيم تالفة', () {
    test('إدخال بلا cachedAt يُعامل كغائب (لا استثناء)', () async {
      final cache = CacheService();
      await cache.init();
      await Hive.box(CacheService.boxName).put('bad', <String, dynamic>{
        'data': 'x',
      });
      expect(await cache.read('bad'), isNull);
    });

    test('إدخال ليس Map يُعامل كغائب', () async {
      final cache = CacheService();
      await cache.init();
      await Hive.box(CacheService.boxName).put('bad2', 'plaintext');
      expect(await cache.read('bad2'), isNull);
    });
  });

  test('clear يفرغ الكاش كله', () async {
    final cache = CacheService();
    await cache.init();
    await cache.writeThrough('a', 1);
    await cache.writeThrough('b', 2);
    await cache.clear();
    expect(await cache.read('a'), isNull);
    expect(await cache.read('b'), isNull);
  });
}
