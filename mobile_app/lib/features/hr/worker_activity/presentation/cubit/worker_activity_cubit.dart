import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../../core/network/api_client.dart';
import 'worker_activity_state.dart';

/// MOB-8: نشاط عامل واحد — آخر السلف (GET /hr/advances?workerId=) وآخر
/// إنتاج العامل (GET /hr/production?workerId=) في طلبين متوازيين.
///
/// أبسط تمثيل: قائمتان تسلسليتان داخل تبويبات شاشة العامل — بلا
/// تفاصيل أو إجراءات. الفشل يظهر كحالة خطأ عربية موحدة للشاشة.
class WorkerActivityCubit extends Cubit<WorkerActivityState> {
  WorkerActivityCubit(
      {required this.workerId, required this.workerName, Dio? dio})
      : _injectedDio = dio,
        super(WorkerActivityInitial());

  /// معرف العامل (مقيد بالمسار).
  final String workerId;

  /// اسم العامل للعرض في الترويسة (قد يكون فارغًا).
  final String workerName;

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  Future<void> fetchActivity() async {
    emit(WorkerActivityLoading());
    try {
      // طلبان متوازيان بنفس عقد items/total/page/limit المعلن للموارد
      // البشرية — أي فشل يرفع حالة الخطأ الموحدة.
      final results = await Future.wait<dynamic>([
        _dio.get<dynamic>(
          '/hr/advances',
          queryParameters: <String, dynamic>{'workerId': workerId},
        ),
        _dio.get<dynamic>(
          '/hr/production',
          queryParameters: <String, dynamic>{'workerId': workerId},
        ),
      ]);
      final advances = _parseItems(results[0].data, 'السلف');
      final production = _parseItems(results[1].data, 'الإنتاج');
      emit(WorkerActivityLoaded(
        advances: advances,
        production: production,
      ));
    } catch (error) {
      emit(WorkerActivityError(ApiClient.instance.messageFor(error)));
    }
  }

  /// يستخرج items من عقد pagination المعلن ({ items, total, page, limit }).
  static List<Map<String, dynamic>> _parseItems(
      Object? payload, String context) {
    if (payload is! Map) {
      throw FormatException('استجابة $context غير صالحة');
    }
    final items = payload['items'];
    if (items is! List) {
      throw FormatException('قائمة $context غير صالحة');
    }
    return items
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }
}
