import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import '../../../../core/services/cache_service.dart';
import '../../../../core/services/outbox_service.dart';
import 'hr_state.dart';

/// MOB-3: نتيجة تسجيل الإنتاج اليومي — تميّز الإرسال الفوري عن الحفظ
/// في طابور الإرسال عند فقد الاتصال (لكل منهما رسالة مستخدم مختلفة).
enum RecordProductionOutcome {
  /// أُرسل للخادم ونجح.
  sent,

  /// لا اتصال — حُفظ محليًا في الطابور وسيرسل تلقائيًا عند عودة الاتصال.
  queued,

  /// فشل (خادم/تحقق) — يجب إظهار رسالة خطأ.
  failed,
}

/// MOB-3: نتيجة تسجيل الحضور — نفس دلالات [RecordProductionOutcome]
/// لمسار الحضور (POST /hr/attendance) عند فقد الاتصال.
enum RecordAttendanceOutcome {
  /// أُرسل للخادم ونجح.
  sent,

  /// لا اتصال — حُفظ محليًا في الطابور وسيرسل تلقائيًا عند عودة الاتصال.
  queued,

  /// فشل (خادم/تحقق) — يجب إظهار رسالة خطأ.
  failed,
}

class HrCubit extends Cubit<HrState> {
  HrCubit({
    Uuid? uuid,
    Dio? dio,
    CacheService? cache,
    OutboxService? outbox,
  })  : _uuid = uuid ?? const Uuid(),
        _injectedDio = dio,
        _cache = cache ?? CacheService.instance,
        _outbox = outbox ?? OutboxService.instance,
        super(HrInitial());

  final Uuid _uuid;
  final Dio? _injectedDio;

  /// MOB-3: كاش قراءة قائمة العمال (write-through بعد كل نجاح شبكة).
  final CacheService _cache;

  /// MOB-3: طابور كتابة الإنتاج اليومي والحضور عند فقد الاتصال.
  final OutboxService _outbox;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  static const String _workersCacheKey = 'hr_workers';

  Future<void> fetchWorkers() async {
    emit(HrLoading());
    try {
      final response = await _dio.get('/hr/workers');
      final workers = ApiParsing.paginatedMaps(
        response.data,
        context: 'العمال',
      );
      // MOB-3: آخر حالة ناجحة تُخزن فورًا لتُستخدم عند فقد الاتصال.
      await _cache.writeThrough(_workersCacheKey, workers);
      emit(HrLoaded(workers));
    } catch (error) {
      // MOB-3: انقطاع الشبكة → اعرض آخر حالة ناجحة من الكاش مع شارة
      // بيانات مخزنة؛ بلا كاش → حالة لا-اتصال صريحة.
      if (ApiClient.isNetworkError(error)) {
        final snapshot = await _cache.read(_workersCacheKey);
        if (snapshot != null) {
          final workers = _normalizeWorkers(snapshot.data);
          if (workers != null) {
            emit(HrLoaded(
              workers,
              fromCache: true,
              cachedAt: snapshot.cachedAt,
            ));
            return;
          }
        }
        emit(const HrOffline());
        return;
      }
      emit(HrError(ApiClient.instance.messageFor(error)));
    }
  }

  /// يطابق عاملًا من القائمة بمعرّف بطاقة NFC (MOB-4): يبحث في المفاتيح
  /// الشائعة (nfcId/nfcTagId/tagId) ثم يسقط إلى مطابقة كود العامل —
  /// يعيد null إن لم يُطابق أحد.
  Map<String, dynamic>? findWorkerByTagId(String tagId) {
    final state = this.state;
    if (state is! HrLoaded) return null;
    final normalized = tagId.trim().toUpperCase();
    for (final worker in state.workers) {
      if (worker is! Map) continue;
      for (final key in const ['nfcId', 'nfcTagId', 'tagId']) {
        final value = worker[key];
        if (value is String && value.trim().toUpperCase() == normalized) {
          return Map<String, dynamic>.from(worker);
        }
      }
      final code = worker['code'];
      if (code is String && code.trim().toUpperCase() == normalized) {
        return Map<String, dynamic>.from(worker);
      }
    }
    return null;
  }

  /// MOBILE-F07 fix: إضافة Idempotency-Key + معالجة موحّدة للأخطاء عبر
  /// messageFor. رسالة النجاح تظهر فقط بعد نجاح فعلي للـ await.
  Future<void> createWorker({
    required String name,
    String? phone,
    String? nationalId,
    required String specialty,
    double? pieceRate,
    DateTime? hireDate,
  }) async {
    try {
      await _dio.post(
        '/hr/workers',
        data: {
          'name': name,
          if (phone != null && phone.isNotEmpty) 'phone': phone,
          if (nationalId != null && nationalId.isNotEmpty)
            'nationalId': nationalId,
          'specialty': specialty,
          if (pieceRate != null) 'pieceRate': pieceRate,
          if (hireDate != null) 'hireDate': hireDate.toIso8601String(),
        },
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchWorkers();
    } catch (error) {
      emit(HrError(ApiClient.instance.messageFor(error)));
      rethrow;
    }
  }

  /// تسجيل حضور عامل (POST /hr/attendance).
  ///
  /// MOB-3: عند فقد الاتصال يُدرج في طابور الإرسال بنفس مفتاح
  /// الاندماجية ويعاد تأكيد "حُفظ محليًا وسيرسل عند عودة الاتصال"
  /// (نتيجة [RecordAttendanceOutcome.queued]). الجسم حرفيًا بعقد
  /// CreateAttendanceDto: {workerId, date, isPresent, notes?}.
  Future<RecordAttendanceOutcome> recordAttendance({
    required String workerId,
    required bool isPresent,
    String? notes,
    DateTime? date,
  }) async {
    final effectiveDate = date ?? DateTime.now();
    final body = <String, dynamic>{
      'workerId': workerId,
      'date': effectiveDate.toIso8601String(),
      'isPresent': isPresent,
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
    };
    // المفتاح يصدر مرة واحدة: إن أُدرجنا في الطابور سيستخدمه الإرسال
    // المتأخر كما هو — لا يمكن أن يُنشأ مفتاح ثانٍ لنفس العملية.
    final idempotencyKey = _uuid.v4();
    try {
      await _dio.post(
        '/hr/attendance',
        data: body,
        options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      );
      return RecordAttendanceOutcome.sent;
    } catch (error) {
      if (ApiClient.isNetworkError(error)) {
        final queued = await _outbox.enqueue(
          method: 'POST',
          path: '/hr/attendance',
          body: body,
          idempotencyKey: idempotencyKey,
        );
        if (queued != null) {
          return RecordAttendanceOutcome.queued;
        }
        // تعطل الطابور (تخزين) → سقط إلى إظهار خطأ الشبكة الأصلي.
      }
      emit(HrError(ApiClient.instance.messageFor(error)));
      return RecordAttendanceOutcome.failed;
    }
  }

  /// تسجيل الإنتاج اليومي (recordDailyProduction).
  ///
  /// MOB-3: عند فقد الاتصال لا يفشل التسجيل — يُدرج في طابور الإرسال
  /// بنفس مفتاح الاندماجية ويُعاد تأكيد "حُفظ محليًا وسيرسل عند عودة
  /// الاتصال" (نتيجة [RecordProductionOutcome.queued]). الإرسال المتأخر
  /// آمن خادميًا (نفس Idempotency-Key = نفس النتيجة).
  Future<RecordProductionOutcome> recordProduction({
    required String workerId,
    required int piecesCount,
  }) async {
    final body = <String, dynamic>{
      'workerId': workerId,
      'piecesCount': piecesCount,
      'date': DateTime.now().toIso8601String(),
    };
    // المفتاح يصدر مرة واحدة: إن أُدرجنا في الطابور سيستخدمه الإرسال
    // المتأخر كما هو — لا يمكن أن يُنشأ مفتاح ثانٍ لنفس العملية.
    final idempotencyKey = _uuid.v4();
    try {
      await _dio.post(
        '/hr/production',
        data: body,
        options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      );
      await fetchWorkers();
      return RecordProductionOutcome.sent;
    } catch (error) {
      if (ApiClient.isNetworkError(error)) {
        final queued = await _outbox.enqueue(
          method: 'POST',
          path: '/hr/production',
          body: body,
          idempotencyKey: idempotencyKey,
        );
        if (queued != null) {
          return RecordProductionOutcome.queued;
        }
        // تعطل الطابور (تخزين) → سقط إلى إظهار خطأ الشبكة الأصلي.
      }
      emit(HrError(ApiClient.instance.messageFor(error)));
      return RecordProductionOutcome.failed;
    }
  }
}

/// يحوّل قيمة الكاش (Map/List بروابط dynamic من Hive) إلى قائمة خرائط
/// موحّدة — يعيد null إن كان الشكل غير صالح.
List<Map<String, dynamic>>? _normalizeWorkers(Object? data) {
  if (data is! List) return null;
  final workers = <Map<String, dynamic>>[];
  for (final item in data) {
    if (item is! Map) return null;
    workers.add(Map<String, dynamic>.from(item));
  }
  return workers;
}
