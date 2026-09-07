import 'package:garment_factory_erp/core/services/cache_service.dart';

/// كاش فعلي في الذاكرة — نفس عقد [CacheService] (write-through/read) بلا
/// Hive: لاختبارات الـ widget التي تحتاج سجل مرحلات التشغيل المحلي.
class FakeCacheService extends CacheService {
  final Map<String, CachedSnapshot> _store = {};

  @override
  Future<void> writeThrough(String key, Object? data) async {
    _store[key] = CachedSnapshot(data: data, cachedAt: DateTime.now());
  }

  @override
  Future<CachedSnapshot?> read(String key, {Duration? maxAge}) async =>
      _store[key];
}
