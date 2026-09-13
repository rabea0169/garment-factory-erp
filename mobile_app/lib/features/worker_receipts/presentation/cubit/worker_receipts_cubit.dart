import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حالات شاشة سندات قبض العمال (SELIM-ERP W1).
abstract class WorkerReceiptsState {}

class WorkerReceiptsInitial extends WorkerReceiptsState {}

class WorkerReceiptsLoading extends WorkerReceiptsState {}

class WorkerReceiptsLoaded extends WorkerReceiptsState {
  /// سندات القبض داخل المرشحات (صفحة واحدة حتى 100 سند).
  final List<Map<String, dynamic>> receipts;

  /// العمال النشطون (للقائمة المنسدلة) — فشل جلبهم صامت (قائمة فارغة).
  final List<Map<String, dynamic>> workers;

  /// إجمالي السندات داخل المرشحات (total من الاستجابة).
  final int total;

  /// مجاميع لكل عامل داخل نفس المرشحات (workerTotals من الاستجابة):
  /// {workerId, count, total} — تقرير متابعة تسويات العمال.
  final List<Map<String, dynamic>> workerTotals;

  WorkerReceiptsLoaded(
    this.receipts, {
    this.workers = const [],
    this.total = 0,
    this.workerTotals = const [],
  });

  /// مجموع المقبوض لعامل داخل المرشحات الحالية (0 إن غاب).
  num totalFor(String workerId) {
    for (final row in workerTotals) {
      if (row['workerId']?.toString() == workerId) {
        final value = row['total'];
        if (value is num) return value;
        return num.tryParse(value?.toString() ?? '') ?? 0;
      }
    }
    return 0;
  }
}

class WorkerReceiptsError extends WorkerReceiptsState {
  final String message;
  WorkerReceiptsError(this.message);
}

/// Cubit سندات قبض العمال — يستدعي وحدة /worker-receipts الخادمية.
///
/// السند = مبلغ يُقبض من العامل (تسوية سلفة/مديونية): ترقيم WRC-0001،
/// وحرس رصيد الخزينة (إن ذُكرت) وقيد مدين نقدية/دائن سلف العمال كلها
/// في معاملة واحدة على الخادم — الحذف يعكس القيد ويعيد الرصيد.
class WorkerReceiptsCubit extends Cubit<WorkerReceiptsState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  WorkerReceiptsCubit({Dio? dio})
      : _injectedDio = dio,
        super(WorkerReceiptsInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  String? _workerId;
  String? _from;
  String? _to;

  /// آخر خطأ إجراء (إنشاء/حذف) — تقرأه الشاشة عند فشل العملية ليعرض
  /// رسالة الخادم الدقيقة (رصيد الخزينة لا يكفي مثلًا).
  String? lastActionError;

  /// جلب السندات + العمال (قائمة الاختيار) بمرشحات العامل/النطاق الزمني.
  Future<void> fetch({String? workerId, String? from, String? to}) async {
    if (workerId != null) _workerId = workerId;
    if (from != null) _from = from;
    if (to != null) _to = to;
    emit(WorkerReceiptsLoading());
    try {
      final params = <String, dynamic>{'limit': 100};
      if (_workerId != null && _workerId!.isNotEmpty) {
        params['workerId'] = _workerId;
      }
      if (_from != null && _from!.isNotEmpty) params['from'] = _from;
      if (_to != null && _to!.isNotEmpty) params['to'] = _to;
      final response = await _dio.get(
        '/worker-receipts',
        queryParameters: params,
      );
      final payload = response.data is Map
          ? Map<String, dynamic>.from(response.data as Map)
          : const <String, dynamic>{};
      // العمال لقائمة الاختيار — فشلهم صامت (الاسم الحر ليس مسارًا هنا
      // لأن السند يلزمه workerId صالح، فتظهر قائمة فارغة قابلة لإعادة
      // المحاولة بالسحب للتحديث).
      List<Map<String, dynamic>> workers = const [];
      try {
        final workersResponse = await _dio.get(
          '/hr/workers',
          queryParameters: {'limit': 100},
        );
        workers = ApiParsing.paginatedMaps(
          workersResponse.data,
          context: 'العمال',
        );
      } catch (_) {}
      final totals = payload['workerTotals'];
      emit(
        WorkerReceiptsLoaded(
          _rowsOf(response.data, 'سندات قبض العمال'),
          workers: workers,
          total: _intOf(payload['total']),
          workerTotals: totals is List
              ? totals
                  .whereType<Map>()
                  .map((row) => Map<String, dynamic>.from(row))
                  .toList(growable: false)
              : const [],
        ),
      );
    } catch (error) {
      emit(WorkerReceiptsError(_message(error)));
    }
  }

  /// إنشاء سند قبض عامل — حرس الخزينة والقيد داخل معاملة واحدة خادميًا.
  Future<bool> create({
    required String workerId,
    required double amount,
    String? date,
    String? notes,
    String? treasuryId,
  }) async {
    lastActionError = null;
    try {
      await _dio.post('/worker-receipts', data: {
        'workerId': workerId,
        'amount': amount,
        if (date != null && date.isNotEmpty) 'date': date,
        if (treasuryId != null && treasuryId.isNotEmpty) 'treasuryId': treasuryId,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      });
      await fetch();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// حذف سند — عكس القيد وإعادة رصيد الخزينة في معاملة واحدة.
  Future<bool> delete(String id) async {
    lastActionError = null;
    try {
      await _dio.delete('/worker-receipts/$id');
      await fetch();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// الخزائن النشطة لقائمة اختيار السند — تُطلب عند فتح حوار الإنشاء
  /// فقط (لا تثقل تحميل الشاشة). الفشل يرفع الاستثناء ليقرأه الحوار.
  Future<List<Map<String, dynamic>>> fetchTreasuries() async {
    final response = await _dio.get(
      '/accounting/treasuries',
      queryParameters: {'limit': 100},
    );
    return ApiParsing.paginatedMaps(response.data, context: 'الخزائن');
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
