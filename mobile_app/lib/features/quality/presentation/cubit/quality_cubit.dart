import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import 'quality_state.dart';

class QualityCubit extends Cubit<QualityState> {
  QualityCubit({Uuid? uuid})
      : _uuid = uuid ?? const Uuid(),
        super(QualityInitial());

  final Uuid _uuid;

  Future<void> fetchQualityChecks() async {
    emit(QualityLoading());
    try {
      final response = await ApiClient.instance.dio.get('/quality');
      emit(QualityLoaded(ApiClient.extractPaginatedData(response.data)));
    } catch (e) {
      emit(QualityError('فشل في تحميل بيانات الجودة'));
    }
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
    } catch (_) {
      emit(QualityError('فشل في تسجيل التقرير'));
      rethrow;
    }
  }
}
