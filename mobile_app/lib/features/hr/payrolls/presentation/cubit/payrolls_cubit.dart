import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_parsing.dart';
import 'payrolls_state.dart';

/// MOB-8: مرشح حالة كشوف الرواتب (PayrollStatus في الخادم: DRAFT/
/// APPROVED/PAID + الكل). القيمة الخام تُرسل كما هي في query string.
enum PayrollStatusFilter {
  all('الكل', null),
  draft('مسودة', 'DRAFT'),
  approved('معتمد', 'APPROVED'),
  paid('مدفوع', 'PAID');

  const PayrollStatusFilter(this.label, this.queryValue);

  /// التسمية العربية للشريحة في الواجهة.
  final String label;

  /// قيمة status للخادم — null يعني بلا مرشح.
  final String? queryValue;
}

/// MOB-8: كشوف الرواتب — يستهلك GET /hr/payrolls?status=&workerId=&page=&limit=
/// ويعيد { items: [...], total, page, limit } (لاحظ: المفتاح items لا data).
class PayrollsCubit extends Cubit<PayrollsState> {
  PayrollsCubit({Dio? dio, Uuid? uuid})
      : _injectedDio = dio,
        _uuid = uuid ?? const Uuid(),
        super(const PayrollsInitial(filter: PayrollStatusFilter.all));

  final Dio? _injectedDio;

  /// D2: مولد مفاتيح الاندماجية لأفعال الكشوف (create/approve/pay/cancel).
  final Uuid _uuid;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  PayrollStatusFilter _filter = PayrollStatusFilter.all;
  PayrollStatusFilter get filter => _filter;

  /// يجلب الكشوف بالمرشح الحالي (يُستخدم أيضًا للتحديث بالسحب).
  Future<void> fetchPayrolls({bool refreshing = false}) async {
    if (refreshing && state is PayrollsLoaded) {
      emit(PayrollsLoaded(
        payrolls: (state as PayrollsLoaded).payrolls,
        filter: _filter,
        isRefreshing: true,
      ));
    } else {
      emit(PayrollsLoading(filter: _filter));
    }
    try {
      final response = await _dio.get<dynamic>(
        '/hr/payrolls',
        queryParameters: <String, dynamic>{
          if (_filter.queryValue != null) 'status': _filter.queryValue,
          'page': 1,
          'limit': 50,
        },
      );
      final payrolls = _parseItems(response.data);
      emit(
        payrolls.isEmpty
            ? PayrollsEmpty(filter: _filter)
            : PayrollsLoaded(payrolls: payrolls, filter: _filter),
      );
    } catch (error) {
      emit(PayrollsError(
        message: ApiClient.instance.messageFor(error),
        filter: _filter,
      ));
    }
  }

  /// يضبط المرشح ويعيد الجلب.
  Future<void> setFilter(PayrollStatusFilter filter) async {
    if (filter == _filter) return;
    _filter = filter;
    await fetchPayrolls();
  }

  // ===================== إجراءات دورة الرواتب (GF-IMP-W3) =====================

  /// إنشاء كشف راتب (POST /hr/payrolls) — DRAFT محسوب خادميًا.
  ///
  /// عقد CreatePayrollDto الحرفي: {workerId, periodStart, periodEnd,
  /// notes?} — الخادم يحسب grossAmount من الإنتاج وadvanceDeduct من
  /// السلف بنفسه (ADR-0015) ولا يقبل أي حقل مبالغ من العميل
  /// (ValidationPipe forbidNonWhitelisted يرفضه بـ 400). لذلك تُدمج
  /// [bonus]/[deductions] الاختياريان في ملاحظات الكشف كنص مقروء —
  /// بلا ضياع بيانات وبلا 400. الفترة الاختيارية: الافتراضي الشهر
  /// الحالي كاملًا. يُعيد رسالة خطأ نصية أو null عند النجاح.
  Future<String?> createPayroll({
    required String workerId,
    DateTime? from,
    DateTime? to,
    double? bonus,
    double? deductions,
    String? notes,
  }) async {
    final now = DateTime.now();
    final periodStart = from ?? DateTime(now.year, now.month, 1);
    final periodEnd = to ?? DateTime(now.year, now.month + 1, 0);
    try {
      await _dio.post(
        '/hr/payrolls',
        data: <String, dynamic>{
          'workerId': workerId,
          'periodStart': periodStart.toIso8601String(),
          'periodEnd': periodEnd.toIso8601String(),
          if (_composeNotes(notes, bonus, deductions) case final composed?)
            'notes': composed,
        },
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchPayrolls();
      return null;
    } catch (error) {
      return ApiClient.instance.messageFor(error);
    }
  }

  /// اعتماد كشف راتب مسودة (POST /hr/payrolls/:id/approve) — دون دفع
  /// أو ترحيل مالي. يُعيد رسالة خطأ نصية أو null عند النجاح.
  Future<String?> approvePayroll(String id) =>
      _runPayrollAction('/hr/payrolls/$id/approve');

  /// إبطال كشف راتب مسودة (POST /hr/payrolls/:id/cancel) — إزالة
  /// المسودة خادميًا بـ CAS وتدقيق كامل. يُعيد رسالة خطأ نصية أو null.
  Future<String?> cancelPayroll(String id) =>
      _runPayrollAction('/hr/payrolls/$id/cancel');

  /// دفع كشف راتب معتمد (POST /hr/payrolls/:id/pay) — يُرحَّل الصافي
  /// من الخزينة (فصل الواجبات: الدافع ≠ المُعتمد خادميًا).
  /// [treasuryId] اختياري خادميًا عند صافٍ = صفر (HR-4)؛ الصافي
  /// الموجب بدونه يُرفض 400 برسالة عربية. يُعيد رسالة خطأ أو null.
  Future<String?> payPayroll(String id, {String? treasuryId}) async {
    try {
      await _dio.post(
        '/hr/payrolls/$id/pay',
        data: <String, dynamic>{
          if (treasuryId != null && treasuryId.isNotEmpty)
            'treasuryId': treasuryId,
        },
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchPayrolls();
      return null;
    } catch (error) {
      return ApiClient.instance.messageFor(error);
    }
  }

  /// تنفيذ فعل بلا جسم (approve/cancel) بمفتاح اندماجية + إعادة جلب.
  Future<String?> _runPayrollAction(String path) async {
    try {
      await _dio.post(
        path,
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchPayrolls();
      return null;
    } catch (error) {
      return ApiClient.instance.messageFor(error);
    }
  }

  /// يجلب قائمة العمال (GET /hr/workers — عقد data[]) لحوار "كشف
  /// جديد". الفشل (صلاحية/شبكة) يُعاد كقائمة فارغة — الحوار يعطّل
  /// الحفظ مع تلميح "لا يوجد عمال".
  Future<List<Map<String, dynamic>>> fetchWorkers() async {
    try {
      final response = await _dio.get<dynamic>('/hr/workers');
      return ApiParsing.paginatedMaps(response.data, context: 'العمال');
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  /// يجلب الخزائن النشطة (GET /accounting/treasuries — عقد data[])
  /// لحوار دفع كشف راتب. الفشل يعيد قائمة فارغة (الحوار يعرض تلميح
  /// "لا توجد خزائن" — الدفع يظل ممكنًا لحالة صافٍ = صفر).
  Future<List<Map<String, dynamic>>> fetchTreasuries() async {
    try {
      final response = await _dio.get<dynamic>(
        '/accounting/treasuries',
        queryParameters: <String, dynamic>{'page': 1, 'limit': 100},
      );
      return ApiParsing.paginatedMaps(response.data, context: 'الخزائن');
    } catch (_) {
      return const <Map<String, dynamic>>[];
    }
  }

  /// يدمج الملاحظات مع المكافأة/الخصم الاختياريين في نص ملاحظات واحد
  /// (العقد لا يقبل حقول مبالغ إضافية — انظر createPayroll).
  static String? _composeNotes(
    String? notes,
    double? bonus,
    double? deductions,
  ) {
    final parts = <String>[
      if (notes != null && notes.trim().isNotEmpty) notes.trim(),
      if (bonus != null && bonus > 0)
        'مكافأة إضافية: ${bonus.toStringAsFixed(2)}',
      if (deductions != null && deductions > 0)
        'خصم إضافي: ${deductions.toStringAsFixed(2)}',
    ];
    return parts.isEmpty ? null : parts.join(' | ');
  }

  /// يستخرج قائمة الكشوف من عقد pagination المعلن للموارد البشرية
  /// ({ items: [...], total, page, limit }).
  static List<Map<String, dynamic>> _parseItems(Object? payload) {
    if (payload is! Map) {
      throw const FormatException('استجابة كشوف الرواتب غير صالحة');
    }
    final items = payload['items'];
    if (items is! List) {
      throw const FormatException('قائمة كشوف الرواتب غير صالحة');
    }
    return items
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }
}
