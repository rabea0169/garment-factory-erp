import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حالات شاشة كشوف الرواتب المجمدة (SELIM-ERP W1).
abstract class PayrollStatementsState {}

class PayrollStatementsInitial extends PayrollStatementsState {}

class PayrollStatementsLoading extends PayrollStatementsState {}

class PayrollStatementsLoaded extends PayrollStatementsState {
  /// الكشوف المجمدة داخل المرشح (صفحة واحدة حتى 100 كشف). كل صف يحمل
  /// لقطة JSON كاملة: lines (صفوف العمال) وtotals (المجاميع) وworkerCount.
  final List<Map<String, dynamic>> statements;

  /// إجمالي الكشوف داخل المرشح (total من الاستجابة).
  final int total;

  PayrollStatementsLoaded(this.statements, {this.total = 0});

  /// عدد الكشوف في حالة معينة داخل القائمة المحمّلة (عدادات الشرائح).
  int countOf(String status) => statements
      .where((s) => s['status']?.toString() == status)
      .length;

  /// قراءة مجاميع اللقطة JSON بأمان — الحقول مسؤولية وحدتنا الخادمية.
  Map<String, dynamic> totalsOf(Map<String, dynamic> statement) {
    final raw = statement['totals'];
    if (raw is Map) return Map<String, dynamic>.from(raw);
    return const {};
  }

  /// صفوف العمال من اللقطة JSON (workerName + net لكل صف).
  List<Map<String, dynamic>> linesOf(Map<String, dynamic> statement) {
    final raw = statement['lines'];
    if (raw is List) {
      return raw
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList(growable: false);
    }
    return const [];
  }
}

class PayrollStatementsError extends PayrollStatementsState {
  final String message;
  PayrollStatementsError(this.message);
}

/// Cubit كشوف الرواتب المجمدة — يستدعي وحدة /payroll-statements الخادمية.
///
/// دورة الحياة (نفس Selim): DRAFT → POSTED. التوليد يجمّد لقطة JSON من
/// كشوف الفترة المعتمدة غير المدفوعة، والترحيل (post) يُرحّل قيد رواتب
/// واحدًا ويعلّم الكشوف المرتبطة مُدفوعة (الترحيل = الدفع كما في Selim).
class PayrollStatementsCubit extends Cubit<PayrollStatementsState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  PayrollStatementsCubit({Dio? dio})
      : _injectedDio = dio,
        super(PayrollStatementsInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  String _statusFilter = '';

  /// آخر خطأ إجراء (توليد/ترحيل/حذف) — تقرأه الشاشة عند فشل العملية
  /// ليعرض رسالة الخادم الدقيقة (لا توجد كشوف معتمدة في الفترة مثلًا).
  String? lastActionError;

  /// جلب الكشوف المجمدة بمرشح الحالة + تداخل الفترة.
  Future<void> fetch({String? status}) async {
    if (status != null) _statusFilter = status;
    emit(PayrollStatementsLoading());
    try {
      final params = <String, dynamic>{'limit': 100};
      if (_statusFilter.isNotEmpty && _statusFilter != 'ALL') {
        params['status'] = _statusFilter;
      }
      final response = await _dio.get(
        '/payroll-statements',
        queryParameters: params,
      );
      final payload = response.data is Map
          ? Map<String, dynamic>.from(response.data as Map)
          : const <String, dynamic>{};
      emit(
        PayrollStatementsLoaded(
          _rowsOf(response.data, 'كشوف الرواتب المجمدة'),
          total: _intOf(payload['total']),
        ),
      );
    } catch (error) {
      emit(PayrollStatementsError(_message(error)));
    }
  }

  /// توليد كشف مجمع من كشوف الفترة (periodFrom/periodTo بصيغة ISO).
  /// يُرفض خلو الفترة من الكشوف القابلة للتجميع (400 برسالة عربية).
  Future<bool> generate({
    required String periodFrom,
    required String periodTo,
    String? notes,
  }) async {
    lastActionError = null;
    try {
      await _dio.post('/payroll-statements/generate', data: {
        'periodFrom': periodFrom,
        'periodTo': periodTo,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      });
      await fetch();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// ترحيل الكشف المجمع (مسودة فقط): قيد رواتب واحد + تعليم الكشوف
  /// المرتبطة مُدفوعة داخل معاملة واحدة — إجراء لا رجعة فيه.
  Future<bool> post(String id) async {
    lastActionError = null;
    try {
      await _dio.post('/payroll-statements/$id/post');
      await fetch();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// حذف كشف مجمع — مسودة فقط، ويفك ربط الكشوف فتعود متاحة للتجميع.
  Future<bool> delete(String id) async {
    lastActionError = null;
    try {
      await _dio.delete('/payroll-statements/$id');
      await fetch();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// استخراج صفوف القائمة — وحدات Selim تعيد {items, ...}.
  List<Map<String, dynamic>> _rowsOf(dynamic payload, String context) {
    final rows = payload is Map ? (payload['items'] ?? payload['data']) : payload;
    return ApiParsing.mapList(rows, context: context);
  }

  int _intOf(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  String _message(Object error) => ApiClient.instance.messageFor(error);
}
