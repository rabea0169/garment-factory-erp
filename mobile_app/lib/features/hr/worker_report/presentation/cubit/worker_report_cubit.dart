import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../../core/network/api_client.dart';
import 'worker_report_state.dart';

/// SELIM-ERP W5 — cubit تقرير العامل المجمّع: جلب GET
/// /hr/workers/:id/report بنطاق تاريخ. الافتراضي عند الإنشاء: بداية
/// الشهر الحالي حتى اليوم (نفس افتراضي WorkerReportModal بالمرجع)،
/// ويُحدَّث عند تغيير المنتقي.
class WorkerReportCubit extends Cubit<WorkerReportState> {
  WorkerReportCubit({
    required this.workerId,
    DateTime? initialFrom,
    DateTime? initialTo,
    Dio? dio,
  })  : _injectedDio = dio,
        super(const WorkerReportInitial());

  /// معرف العامل (مقيد بالمسار).
  final String workerId;

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// بداية الشهر الحالي (افتراضي «من» كما بالمرجع).
  static DateTime defaultFrom(DateTime now) =>
      DateTime(now.year, now.month, 1);

  /// اليوم (افتراضي «إلى»).
  static DateTime defaultTo(DateTime now) =>
      DateTime(now.year, now.month, now.day);

  static String _isoDate(DateTime date) {
    final padded =
        '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    return padded;
  }

  /// جلب التقرير للنطاق المعطى (أو الافتراضي عند غيابه).
  Future<void> fetchReport({DateTime? from, DateTime? to}) async {
    final fromBound = from ?? defaultFrom(DateTime.now());
    final toBound = to ?? defaultTo(DateTime.now());
    emit(const WorkerReportLoading());
    try {
      final response = await _dio.get<dynamic>(
        '/hr/workers/$workerId/report',
        queryParameters: <String, dynamic>{
          'from': _isoDate(fromBound),
          'to': _isoDate(toBound),
        },
      );
      final payload = response.data;
      if (payload is! Map) {
        throw const FormatException('استجابة تقرير العامل غير صالحة');
      }
      if (payload['worker'] is! Map || payload['summary'] is! Map) {
        throw const FormatException('تقرير العامل ناقص الحقول الأساسية');
      }
      emit(
        WorkerReportLoaded(
          report: Map<String, dynamic>.from(payload),
          from: fromBound,
          to: toBound,
        ),
      );
    } catch (error) {
      emit(WorkerReportError(ApiClient.instance.messageFor(error)));
    }
  }
}
