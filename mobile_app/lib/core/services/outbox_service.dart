import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:hive/hive.dart';
import 'package:uuid/uuid.dart';

import '../network/api_client.dart';

/// SELIM-ERP W3 (نقل OfflineQueueStore من lib/offline-queue.ts في Selim):
/// حالة عنصر الطابور. المزامنة تلقائية للمعلّق فقط؛ «الفاشل» (رفض خادم
/// 4xx) يتطلب قرار المستخدم — لا كتابة صامتة فوق بيانات الخادم.
enum OutboxStatus { pending, failed }

/// MOB-3 + SELIM-ERP W3: طابور كتابة صادر (Outbox) — عمليات POST
/// معلّقة تُخزن في Hive وتُرسل تسلسليًا (FIFO) عند عودة الاتصال.
///
/// خصائص العقد:
/// - كل عنصر يحمل `idempotencyKey` صدر وقت الإنشاء؛ عند الإرسال المتأخر
///   يُمرَّر نفس المفتاح في ترويسة `Idempotency-Key` — إعادة الإرسال
///   (replay) آمنة خادميًا: نفس المفتاح = نفس النتيجة المخزنة.
/// - الإرسال تسلسلي بالترتيب الزمني للإدراج؛ أول **فشل شبكة** يوقف
///   الجولة ويُبقي العنصر (سيعاد لاحقًا) ويحفظ ترتيب البقية. أما **رفض
///   الخادم** (استجابة 4xx) فيعلّم العنصر failed برسالة الخطأ ويمرّ
///   للعنصر التالي — قرار المستخدم من لوحة الطابور (العمليات المالية
///   تطلب تأكيدًا صريحًا قبل إعادة المحاولة — قاعدة APP-1 في المرجع).
/// - حد المحاولات 5 (نفس DEFAULT_MAX_ATTEMPTS في المرجع).
/// - التغييرات (إدراج/حذف/تحديث حالة) تُعلن عبر [notifyListeners] —
///   الشاشات تستمع عبر ListenableBuilder.
/// نتيجة إرسال واحدة (مستوى أعلى — لا يسمح Dart بالتعداد داخل الأصناف).
enum _SendOutcome { sent, rejected, networkError }

class OutboxService extends ChangeNotifier {
  OutboxService({HiveInterface? hive, Dio? dio, Uuid? uuid})
      : _hive = hive ?? Hive,
        _injectedDio = dio,
        _uuid = uuid ?? const Uuid();

  /// الخدمة المشتركة للتطبيق — تُهيأ في main.dart بعد Hive.initFlutter.
  static final OutboxService instance = OutboxService();

  static const String boxName = 'gf_outbox';

  /// الحد الافتراضي لمحاولات العنصر — نفس DEFAULT_MAX_ATTEMPTS في Selim.
  static const int defaultMaxAttempts = 5;

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

  /// عدد العمليات كلها (معلّقة + فاشلة) — 0 إذا كان الطابور معطلًا.
  int get pendingCount {
    if (!_isReady) return 0;
    return _box!.length;
  }

  /// عدد العمليات الفاشلة (رفض خادم — تحتاج قرار المستخدم).
  int get failedCount {
    var count = 0;
    for (final entry in pendingEntries) {
      if (entry.status == OutboxStatus.failed) count++;
    }
    return count;
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
  ///
  /// SELIM-ERP W3: [isFinancial] تعلّم العمليات المالية — لوحة الطابور
  /// تطلب تأكيدًا صريحًا قبل إعادة إرسالها (لا إعادة إرسال مالية صامتة).
  /// [title]/[description]/[amount] بيانات عرض في اللوحة (نفس metadata
  /// في QueueItem عند المرجع).
  Future<OutboxEntry?> enqueue({
    required String method,
    required String path,
    required Map<String, dynamic> body,
    String? idempotencyKey,
    bool isFinancial = false,
    String? title,
    String? description,
    num? amount,
  }) async {
    if (!_isReady && !await init()) return null;
    final entry = OutboxEntry(
      id: _uuid.v4(),
      method: method,
      path: path,
      body: body,
      idempotencyKey: idempotencyKey ?? _uuid.v4(),
      createdAt: DateTime.now(),
      isFinancial: isFinancial,
      title: title,
      description: description,
      amount: amount,
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
  /// النجاح يحذف العنصر ويعلن [notifyListeners]؛ فشل الشبكة يوقف الجولة
  /// فورًا (العنصر يبقى معلّقًا — تُعاد المحاولة عند عودة الاتصال)؛
  /// رفض الخادم (4xx) يعلّم العنصر failed برسالة الخطأ ويمرّ للعنصر
  /// التالي (قرار المستخدم من اللوحة).
  Future<void> drain() async {
    if (!_isReady && !await init()) return;
    if (_draining) return;
    _draining = true;
    try {
      // لقطة ثابتة بترتيب المفاتيح (ترتيب الإدراج): الحذف/التحديث أثناء
      // المرور لا يكسر التكرار.
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
        // الفاشل لا يُعاد تلقائيًا — قرار المستخدم (retryOne).
        if (entry.status == OutboxStatus.failed) continue;
        final outcome = await _send(entry);
        if (outcome == _SendOutcome.sent) {
          await _box!.delete(storageKey);
          notifyListeners();
        } else if (outcome == _SendOutcome.rejected) {
          await _markFailed(storageKey, entry, _lastErrorMessage ?? 'رفض الخادم');
          notifyListeners();
        } else {
          // فشل شبكة — أوقف الجولة (ترتيب البقية محفوظ).
          break;
        }
      }
    } finally {
      _draining = false;
    }
  }

  String? _lastErrorMessage;

  /// يرسل عنصرًا واحدًا ويعيد نتيجته (يحدّث _lastErrorMessage عند الرفض).
  Future<_SendOutcome> _send(OutboxEntry entry) async {
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
      return _SendOutcome.sent;
    } on DioException catch (error) {
      final response = error.response;
      if (response != null && response.statusCode != null) {
        final status = response.statusCode!;
        if (status >= 400 && status < 500) {
          _lastErrorMessage =
              ApiClient.instance.messageFor(error).trim().isNotEmpty
                  ? ApiClient.instance.messageFor(error)
                  : 'رفض الخادم (HTTP $status)';
          return _SendOutcome.rejected;
        }
        // 5xx: خطأ خادم عابر — يعاد لاحقًا كالمعلّق.
        return _SendOutcome.networkError;
      }
      return _SendOutcome.networkError;
    } catch (error) {
      debugPrint(
        'OutboxService: فشل إرسال ${entry.method} ${entry.path} '
        '(سيُعاد لاحقًا): $error',
      );
      return _SendOutcome.networkError;
    }
  }

  /// يعيّن حالة العنصر إلى فاشل + رسالة الخطأ + عدد المحاولات.
  Future<void> _markFailed(
    dynamic storageKey,
    OutboxEntry entry,
    String message,
  ) async {
    final updated = entry.copyWith(
      status: OutboxStatus.failed,
      attempts: entry.attempts + 1,
      lastError: message,
      lastAttemptAt: DateTime.now(),
    );
    try {
      await _box!.put(storageKey, updated.toJson());
    } catch (error) {
      debugPrint('OutboxService: فشل تحديث حالة العنصر: $error');
    }
  }

  /// SELIM-ERP W3: إعادة محاولة عنصر واحد (يدويًا من لوحة الطابور —
  /// التأكيد للعمليات المالية مسؤولية الواجهة).
  ///
  /// يرجع true عند النجاح (العنصر يُحذف)؛ false عند بقاء الفشل.
  Future<bool> retryOne(String entryId) async {
    if (!_isReady && !await init()) return false;
    final storageKey = _keyOf(entryId);
    if (storageKey == null) return false;
    final raw = _box!.get(storageKey);
    if (raw is! Map) return false;
    final OutboxEntry entry;
    try {
      entry = OutboxEntry.fromJson(Map<String, dynamic>.from(raw));
    } catch (_) {
      await _box!.delete(storageKey);
      notifyListeners();
      return false;
    }
    final outcome = await _send(entry);
    if (outcome == _SendOutcome.sent) {
      await _box!.delete(storageKey);
      notifyListeners();
      return true;
    }
    await _markFailed(
      storageKey,
      entry,
      _lastErrorMessage ?? 'فشل غير معروف',
    );
    notifyListeners();
    return false;
  }

  /// SELIM-ERP W3: حذف عنصر واحد (تخلٍّ صريح عن العملية).
  Future<bool> deleteOne(String entryId) async {
    if (!_isReady && !await init()) return false;
    final storageKey = _keyOf(entryId);
    if (storageKey == null) return false;
    await _box!.delete(storageKey);
    notifyListeners();
    return true;
  }

  /// SELIM-ERP W3: مسح كل العناصر الفاشلة (زر «إزالة الفاشلة»).
  Future<int> clearFailed() async {
    if (!_isReady && !await init()) return 0;
    var removed = 0;
    final snapshot = _box!.toMap();
    for (final storageKey in snapshot.keys.toList()) {
      final raw = snapshot[storageKey];
      if (raw is! Map) continue;
      try {
        final entry =
            OutboxEntry.fromJson(Map<String, dynamic>.from(raw));
        if (entry.status == OutboxStatus.failed) {
          await _box!.delete(storageKey);
          removed++;
        }
      } catch (_) {
        // إدخال تالف — تُمسح أيضًا ضمن التنظيف.
        await _box!.delete(storageKey);
        removed++;
      }
    }
    if (removed > 0) notifyListeners();
    return removed;
  }

  /// مفتاح التخزين للعنصر ذي المعرف المحدد (null إن لم يوجد).
  dynamic _keyOf(String entryId) {
    for (final key in _box!.keys) {
      final raw = _box!.get(key);
      if (raw is Map) {
        try {
          final entry =
              OutboxEntry.fromJson(Map<String, dynamic>.from(raw));
          if (entry.id == entryId) return key;
        } catch (_) {
          // إدخال تالف — تجاهل.
        }
      }
    }
    return null;
  }

  /// يربط الطابور بمراقبة الاتصال: عند عودة الاتصال تُرسل العمليات
  /// المعلّقة، وعند الربط وهي متصلة (إقلاع التطبيق مثلًا) أيضًا.
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
///
/// SELIM-ERP W3: حقول الحالة/المحاولات/العرض تُقرأ من التخزين القديم
/// بقيم افتراضية (توافق خلفي مع إدخالات ما قبل الترقية).
@immutable
class OutboxEntry {
  const OutboxEntry({
    required this.id,
    required this.method,
    required this.path,
    required this.body,
    required this.idempotencyKey,
    required this.createdAt,
    this.status = OutboxStatus.pending,
    this.attempts = 0,
    this.maxAttempts = OutboxService.defaultMaxAttempts,
    this.isFinancial = false,
    this.title,
    this.description,
    this.amount,
    this.lastError,
    this.lastAttemptAt,
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
      status: json['status'] == 'failed'
          ? OutboxStatus.failed
          : OutboxStatus.pending,
      attempts: (json['attempts'] as num?)?.toInt() ?? 0,
      maxAttempts: (json['maxAttempts'] as num?)?.toInt() ??
          OutboxService.defaultMaxAttempts,
      isFinancial: json['isFinancial'] == true,
      title: json['title'] as String?,
      description: json['description'] as String?,
      amount: json['amount'] as num?,
      lastError: json['lastError'] as String?,
      lastAttemptAt: json['lastAttemptAt'] is String
          ? DateTime.parse(json['lastAttemptAt'] as String)
          : null,
    );
  }

  OutboxEntry copyWith({
    OutboxStatus? status,
    int? attempts,
    String? lastError,
    DateTime? lastAttemptAt,
  }) {
    return OutboxEntry(
      id: id,
      method: method,
      path: path,
      body: body,
      idempotencyKey: idempotencyKey,
      createdAt: createdAt,
      status: status ?? this.status,
      attempts: attempts ?? this.attempts,
      maxAttempts: maxAttempts,
      isFinancial: isFinancial,
      title: title,
      description: description,
      amount: amount,
      lastError: lastError,
      lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
    );
  }

  /// معرف فريد للعنصر (مفتاح البحث في اللوحة).
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

  /// الحالة: معلّق (مزامنة تلقائية) أو فاشل (قرار مستخدم).
  final OutboxStatus status;

  /// عدد محاولات الإرسال حتى الآن.
  final int attempts;

  /// الحد الأقصى للمحاولات (5 — نفس المرجع).
  final int maxAttempts;

  /// عملية مالية — إعادة الإرسال تتطلب تأكيدًا صريحًا من المستخدم.
  final bool isFinancial;

  /// عنوان العرض في لوحة الطابور (مثل «بيع نقطة بيع»).
  final String? title;

  /// وصف العرض (مثل «فاتورة POS-0005 — 3 بنود»).
  final String? description;

  /// المبلغ (للعمليات المالية — يظهر بتنسيق العملة).
  final num? amount;

  /// رسالة الخطأ من آخر محاولة.
  final String? lastError;

  /// لحظة آخر محاولة.
  final DateTime? lastAttemptAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'method': method,
        'path': path,
        'body': body,
        'idempotencyKey': idempotencyKey,
        'createdAt': createdAt.toIso8601String(),
        'status': status.name,
        'attempts': attempts,
        'maxAttempts': maxAttempts,
        'isFinancial': isFinancial,
        if (title != null) 'title': title,
        if (description != null) 'description': description,
        if (amount != null) 'amount': amount,
        if (lastError != null) 'lastError': lastError,
        if (lastAttemptAt != null)
          'lastAttemptAt': lastAttemptAt!.toIso8601String(),
      };
}
