import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/services/cache_service.dart';
import '../../../production/stage_run_registry.dart';
import 'quality_state.dart';

class QualityCubit extends Cubit<QualityState> {
  QualityCubit({Uuid? uuid, CacheService? cache})
      : _uuid = uuid ?? const Uuid(),
        _cache = cache ?? CacheService.instance,
        super(QualityInitial());

  final Uuid _uuid;

  /// DEV-PQ3: سجل مرحلات التشغيل المشترك مع الإنتاج — يقرأه حوار التسجيل
  /// ليستنتج stageRunId بدل إدخاله يدويًا (لا يوجد مسار خادمي لجلب
  /// stageRuns لأمر تشغيل).
  final CacheService _cache;

  Future<void> fetchQualityChecks() async {
    emit(QualityLoading());
    try {
      final response = await ApiClient.instance.dio.get(
        '/quality',
        queryParameters: {'limit': 100},
      );
      emit(QualityLoaded(ApiClient.extractPaginatedData(response.data)));
    } catch (e) {
      emit(QualityError(
          'فشل في تحميل بيانات الجودة: ${ApiClient.instance.messageFor(e)}'));
    }
  }

  /// DEV-PQ3 + audit-FE2 (P1): يعيد معرف تشغيل المرحلة لأمر/مرحلة (قيم
  /// المرحلة بأحرف الخادم: CUTTING/SEWING/IRONING/PACKING) بمسارين:
  /// المحلي أولًا ثم الخادم (GET /production/work-orders/:id/stage-runs)
  /// عند غيابه محليًا — تعدد الأجهزة (جهاز الفحص ≠ جهاز الانتقال) —
  /// أو null عند فشل الخطين؛ الحوار يعرض حينها تلميحًا إرشاديًا.
  Future<String?> resolveStageRunId(
    String workOrderId,
    String stageApiValue,
  ) {
    return resolveStageRunIdFromRegistry(
      _cache,
      workOrderId: workOrderId,
      stageApiValue: stageApiValue,
      fetchStageRuns: _fetchStageRunsFromServer,
    );
  }

  /// audit-FE2 (P1): جلب تشغيلات مراحل أمر من الخادم — { stageRuns: [...] }.
  Future<List<Map<String, dynamic>>> _fetchStageRunsFromServer(
    String workOrderId,
  ) async {
    final response = await ApiClient.instance.dio
        .get('/production/work-orders/$workOrderId/stage-runs');
    final data = response.data;
    if (data is Map<String, dynamic>) {
      final runs = data['stageRuns'];
      if (runs is List) {
        return runs.whereType<Map<String, dynamic>>().toList();
      }
    }
    return <Map<String, dynamic>>[];
  }

  Future<void> submitQualityCheck({
    required String workOrderId,
    required String stageRunId,
    required String stage,
    required int checkedQty,
    required int passedQty,
    required int rejectedQty,
    required int wasteQty,
    String? rejectionReason,
    String? wasteReason,
    String? notes,
  }) async {
    try {
      await ApiClient.instance.dio.post(
        '/quality',
        data: {
          'workOrderId': workOrderId,
          'stageRunId': stageRunId,
          'stage': stage,
          'checkedQty': checkedQty,
          'passedQty': passedQty,
          'rejectedQty': rejectedQty,
          'wasteQty': wasteQty,
          if (rejectionReason != null && rejectionReason.isNotEmpty)
            'rejectionReason': rejectionReason,
          if (wasteReason != null && wasteReason.isNotEmpty)
            'wasteReason': wasteReason,
          if (notes != null && notes.isNotEmpty) 'notes': notes,
        },
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchQualityChecks();
    } catch (error) {
      // UAT-FIX: فشل التسجيل لا يمسح قائمة الفحوص خلف الحوار —
      // الحوار يعرض رسالة الخادم الفعلية (مثل «سبب الهالك غير صالح»).
      if (state is! QualityLoaded) {
        emit(QualityError(
            'فشل في تسجيل التقرير: ${ApiClient.instance.messageFor(error)}'));
      }
      rethrow;
    }
  }
}
