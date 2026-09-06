import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:hive/hive.dart';
import 'package:uuid/uuid.dart';

import '../network/api_client.dart';

/// MOB-3: طابور كتابة صادر (Outbox) — عمليات POST معلّقة تُخزن في Hive
/// وتُرسل تسلسليًا (FIFO) عند عودة الاتصال.
///
/// خصائص العقد:
/// - كل عنصر يحمل `idempotencyKey` صدر وقت الإنشاء؛ عند الإرسال المتأخر
///   يُمرَّر نفس المفتاح في ترويسة `Idempotency-Key` — إعادة الإرسال
///   (replay) آمنة خادميًا: نفس المفتاح = نفس النتيجة المخزنة.
/// - الإرسال تسلسلي بالترتيب الزمني للإدراج؛ أول فشل يوقف الجولة
///   ويُبقي العنصر (سيعاد لاحقًا) ويحفظ ترتيب البقية.
/// - التغييرات (إدراج/حذف) تُعلن عبر [notifyListeners] — الشاشات تستمع
///   عبر ListenableBuilder لعرض شارة عدد العمليات المعلّقة.
class OutboxService extends ChangeNotifier {
  OutboxService({HiveInterface? hive, Dio? dio, Uuid? uuid})
      : _hive = hive ?? Hive,
        _injectedDio = dio,
        _uuid = uuid ?? const Uuid();

  /// الخدمة المشتركة للتطبيق — تُهيأ في main.dart بعد Hive.initFlutter.
  static final OutboxService instance = OutboxService();

  static const String boxName = 'gf_outbox';

  final HiveInterface _hive;
  final Dio? _injectedDio;
  final Uuid _uuid;
  Box? _box;
  bool _draining = false;
  StreamSubscription<bool>? _connectivitySubscription;

  /// عميل الإرسال: يُحقن في الاختبارات؛ الافتراضي عميل التطبيق المشترك
  /// (مع مصادقة + retry + مفتاح الاندماجية إن لم نمرره).
  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// يفتح صندوق الطابور مرة واحدة. الفشل (Hive غير مُهيأ) يعطّل الخدمة
  /// بصمت: الإدراج يفشل بوضوح والعدد يبقى 0.
  Future<bool> init() async {
    if (_box != null && _box!.isOpen) return true;
    Box? opened;
    Object? failure;
    // ملحوظة تقنية: عند فشل openBox يُكمل Hive مُكملًا داخليًا بلا
    // مستمعين (unhandled async error في الاختبارات) — ننتظر openBox
    // داخل zone مُحرس كي يُبتلع، والفشل الفعلي عبر المتغيرات أعلاه.
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
      debugPrint('OutboxService: تعذر فتح صندوق الطابور: $failure');
      _box = null;
      return false;
    }
    _box = opened;
    return true;
  }

  bool get _isReady => _box != null && _box!.isOpen;

  /// عدد العمليات المعلّقة (0 إذا كان الطابور معطلًا/غير مفتوح).
  int get pendingCount {
    if (!_isReady) return 0;
    return _box!.length;
  }

  /// لقطة العمليات المعلّقة بترتيب الإدراج (FIFO).
  ///
  /// ملحوظة: مفاتيح الصندوق أعداد صاعدة (box.add) وHive يرتبها رقميًا —
  /// فترتيب القيم = ترتيب الإدراج حتى بعد إعادة تشغيل التطبيق.
  List<OutboxEntry> get pendingEntries {
    if (!_isReady) return const <OutboxEntry>[];
    final entries = <OutboxEntry>[];
    for (final raw in _box!.values) {
      if (raw is Map) {
        try {
          entries.add(OutboxEntry.fromJson(Map<String, dynamic>.from(raw)));
        } catch (_) {
          // إدخال تالف يُتخطى — لا يوقف عرض البقية.
        }
      }
    }
    return List.unmodifiable(entries);
  }

  /// يدرج عملية كتابة معلّقة ويعيد العنصر (أو null عند تعطل التخزين —
  /// عندها على المستدعي إظهار الخطأ الأصلي بدل تأكيد الحفظ المحلي).
  Future<OutboxEntry?> enqueue({
    required String method,
    required String path,
    required Map<String, dynamic> body,
    String? idempotencyKey,
  }) async {
    if (!_isReady && !await init()) return null;
    final entry = OutboxEntry(
      id: _uuid.v4(),
      method: method,
      path: path,
      body: body,
      idempotencyKey: idempotencyKey ?? _uuid.v4(),
      createdAt: DateTime.now(),
    );
    try {
      // مفتاح int صاعد (auto-increment) — يضمن ترتيب FIFO عبر
      // إعادة التشغيل لأن Hive يرتب مفاتيح int رقميًا.
      await _box!.add(entry.toJson());
    } catch (error) {
      debugPrint('OutboxService: فشل إدراج العملية: $error');
      return null;
    }
    notifyListeners();
    return entry;
  }

  /// يرسل كل العمليات المعلّقة تسلسليًا (FIFO) عبر [Dio] المحقون أو
  /// عميل التطبيق.
  ///
  /// النجاح يحذف العنصر ويعلن [notifyListeners]؛ الفشل (شبكة/خادم) يوقف
  /// الجولة فورًا ويُبقي العنصر فما بعده — تُعاد المحاولة عند عودة
  /// الاتصال أو نداء drain لاحقًا.
  Future<void> drain() async {
    if (!_isReady && !await init()) return;
    if (_draining) return;
    _draining = true;
    try {
      // لقطة ثابتة بترتيب المفاتيح (ترتيب الإدراج): الحذف أثناء المرور
      // لا يكسر التكرار.
      final snapshot = _box!.toMap();
      for (final storageKey in snapshot.keys.toList()) {
        final raw = snapshot[storageKey];
        if (raw is! Map) continue;
        OutboxEntry entry;
        try {
          entry = OutboxEntry.fromJson(Map<String, dynamic>.from(raw));
        } catch (_) {
          // إدخال تالف يُحذف حتى لا يعيق الطابور للأبد.
          await _box!.delete(storageKey);
          notifyListeners();
          continue;
        }
        try {
          await _dio.request<dynamic>(
            entry.path,
            data: entry.body,
            options: Options(
              method: entry.method,
              headers: <String, dynamic>{
                'Idempotency-Key': entry.idempotencyKey,
              },
            ),
          );
          await _box!.delete(storageKey);
          notifyListeners();
        } catch (error) {
          debugPrint(
            'OutboxService: فشل إرسال ${entry.method} ${entry.path} '
            '(سيُعاد لاحقًا): $error',
          );
          break;
        }
      }
    } finally {
      _draining = false;
    }
  }

  /// يربط الطابور بمراقبة الاتصال: عند عودة الاتصال تُرسل العمليات
  /// المعلّقة، وعند الربط وهي متصلة (إقلاع التطبيق مثلاً) أيضًا.
  void bindConnectivity(Stream<bool> onlineStream, {bool isOnlineNow = true}) {
    _connectivitySubscription?.cancel();
    _connectivitySubscription = onlineStream.listen((online) {
      if (online) unawaited(drain());
    });
    if (isOnlineNow) unawaited(drain());
  }

  @override
  void dispose() {
    _connectivitySubscription?.cancel();
    super.dispose();
  }
}

/// عنصر طابور — عملية كتابة HTTP واحدة معلّقة.
@immutable
class OutboxEntry {
  const OutboxEntry({
    required this.id,
    required this.method,
    required this.path,
    required this.body,
    required this.idempotencyKey,
    required this.createdAt,
  });

  factory OutboxEntry.fromJson(Map<String, dynamic> json) {
    final createdAtRaw = json['createdAt'];
    if (createdAtRaw is! String) {
      throw const FormatException('createdAt مفقود من عنصر الطابور');
    }
    return OutboxEntry(
      id: json['id'] as String,
      method: json['method'] as String,
      path: json['path'] as String,
      body: Map<String, dynamic>.from(json['body'] as Map),
      idempotencyKey: json['idempotencyKey'] as String,
      createdAt: DateTime.parse(createdAtRaw),
    );
  }

  /// معرف فريد للعنصر (مفتاح الصندوق).
  final String id;

  /// فعل HTTP (POST اليوم).
  final String method;

  /// مسار الخادم (مثل /hr/production).
  final String path;

  /// جسم الطلب كما بُني وقت الإنشاء.
  final Map<String, dynamic> body;

  /// مفتاح الاندماجية — نفس المفتاح يُرسل دائمًا عند كل محاولة.
  final String idempotencyKey;

  /// لحظة الإدراج في الطابور.
  final DateTime createdAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'method': method,
        'path': path,
        'body': body,
        'idempotencyKey': idempotencyKey,
        'createdAt': createdAt.toIso8601String(),
      };
}
