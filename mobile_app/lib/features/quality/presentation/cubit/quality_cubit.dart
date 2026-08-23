import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'quality_state.dart';

class QualityCubit extends Cubit<QualityState> {
  QualityCubit() : super(QualityInitial());

  Future<void> fetchQualityChecks() async {
    emit(QualityLoading());
    try {
      final response = await ApiClient.instance.dio.get('/quality');
      emit(QualityLoaded(response.data));
    } catch (e) {
      emit(QualityError('فشل في تحميل بيانات الجودة'));
    }
  }

  Future<void> submitQualityCheck({
    required String workOrderId,
    required String stage,
    required int checkedQty,
    required int passedQty,
    required int rejectedQty,
    String? rejectionReason,
    String? notes,
  }) async {
    try {
      await ApiClient.instance.dio.post('/quality', data: {
        'workOrderId': workOrderId,
        'stage': stage,
        'checkedQty': checkedQty,
        'passedQty': passedQty,
        'rejectedQty': rejectedQty,
        'rejectionReason': rejectionReason,
        'notes': notes,
      });
      fetchQualityChecks(); // تحديث القائمة
    } catch (e) {
      emit(QualityError('فشل في تسجيل التقرير'));
    }
  }
}
