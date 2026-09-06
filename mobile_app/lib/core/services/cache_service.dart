import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:hive/hive.dart';

/// MOB-3: قراءة ذاكرة Hive للموارد المقروءة (Read-through cache).
///
/// الغرض: عند فتح شاشة بلا اتصال تُعرض آخر حالة ناجحة من الشبكة مع شارة
/// "بيانات مخزنة" (انظر [AppCachedDataBanner] في core/widgets/app_feedback.dart).
/// عند نجاح الاتصال تُحدَّث القيمة عبر [writeThrough] في نفس لحظة النجاح.
///
/// عقود الاستخدام:
/// - `writeThrough(key, data)` — يخزن/يستبدل القيمة مع طابع زمني. فشل
///   التخزين يُبتلع بصمت (الكاش أفضل-جهد ولا يُفشل الشاشة أبدًا).
/// - `read(key, maxAge: ...)` — يعيد [CachedSnapshot] أو null عند الغياب،
///   أو عند تجاوز العمر الأقصى (عندها يُحذف الإدخال المُنتهي أيضًا).
///
/// القيم المخزنة يجب أن تكون أنواع Hive الأولية (نتائج decode لـ JSON)
/// — لا DateTime مباشرة؛ الطابع الزمني مخزن كأجزاء-من-الثانية.
class CacheService {
  CacheService({HiveInterface? hive}) : _hive = hive ?? Hive;

  /// الخدمة المشتركة للتطبيق — تُهيأ في main.dart بعد Hive.initFlutter.
  static final CacheService instance = CacheService();

  static const String boxName = 'gf_read_cache';

  /// العمر الافتراضي للقراءات المخزنة — كافٍ ليوم عمل كامل دون اتصال.
  static const Duration defaultMaxAge = Duration(hours: 24);

  final HiveInterface _hive;
  Box? _box;

  /// يفتح الصندوق مرة واحدة. أي فشل (Hive غير مُهيأ — كما في بعض
  /// الاختبارات) يجعل الخدمة معطلة بصمت: كل قراءة null وكل كتابة no-op.
  Future<bool> init() async {
    if (_box != null && _box!.isOpen) return true;
    Box? opened;
    Object? failure;
    // ملحوظة تقنية: عند فشل openBox يُكمل Hive مُكملًا داخليًا
    // (_openingBoxes) بالخطأ دون مستمعين — يظهر كـ unhandled async
    // error في الاختبارات حتى مع try/catch عندنا. ننتظر openBox داخل
    // zone مُحرس كي يُبتلع ذلك الخطأ الداخلي، ونتعامل مع الفشل
    // الفعلي عبر المتغيرات أعلاه فقط.
    await runZonedGuarded(() async {
      try {
        opened = await _hive.openBox(boxName);
      } catch (error) {
        failure = error;
      }
    }, (Object error, StackTrace stack) {
      // يُبتلع عمدًا — انظر التعليق أعلاه.
    });
    if (opened == null) {
      debugPrint('CacheService: تعذر فتح صندوق الكاش: $failure');
      _box = null;
      return false;
    }
    _box = opened;
    return true;
  }

  bool get _isReady => _box != null && _box!.isOpen;

  /// يكتب آخر حالة ناجحة للمفتاح (write-through بعد نجاح الشبكة).
  Future<void> writeThrough(String key, Object? data) async {
    if (!_isReady && !await init()) return;
    try {
      await _box!.put(key, <String, dynamic>{
        'cachedAt': DateTime.now().millisecondsSinceEpoch,
        'data': data,
      });
    } catch (error) {
      // أفضل-جهد: فشل الكتابة لا يُفشل العملية الأصلية الناجحة.
      debugPrint('CacheService: فشل تخزين الكاش للمفتاح $key: $error');
    }
  }

  /// يقرأ آخر حالة ناجحة للمفتاح، أو null عند الغياب/انتهاء الصلاحية/
  /// تعطل التخزين. الإدخال المنتهي يُحذف أثناء القراءة (نظافة).
  Future<CachedSnapshot?> read(String key, {Duration? maxAge}) async {
    if (!_isReady && !await init()) return null;
    try {
      final raw = _box!.get(key);
      if (raw is! Map) return null;
      final entry = Map<String, dynamic>.from(raw);
      final cachedAtMillis = entry['cachedAt'];
      if (cachedAtMillis is! int) return null;
      final cachedAt = DateTime.fromMillisecondsSinceEpoch(cachedAtMillis);
      final limit = maxAge ?? defaultMaxAge;
      final age = DateTime.now().difference(cachedAt);
      if (age > limit) {
        await _box!.delete(key);
        return null;
      }
      return CachedSnapshot(data: entry['data'], cachedAt: cachedAt);
    } catch (error) {
      debugPrint('CacheService: فشل قراءة الكاش للمفتاح $key: $error');
      return null;
    }
  }

  /// يفرغ الكاش كله (لإعادة الضبط/الاختبارات).
  Future<void> clear() async {
    if (!_isReady) return;
    try {
      await _box!.clear();
    } catch (_) {
      // أفضل-جهد.
    }
  }
}

/// لقطة قيمة مخزنة مع طابع وقت تخزينها.
@immutable
class CachedSnapshot {
  const CachedSnapshot({required this.data, required this.cachedAt});

  /// القيمة كما خزنت بعد آخر نجاح شبكة.
  final Object? data;

  /// لحظة التخزين (وقت الجهاز).
  final DateTime cachedAt;
}
