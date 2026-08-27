import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'hr_state.dart';

class HrCubit extends Cubit<HrState> {
  HrCubit() : super(HrInitial());

  Future<void> fetchWorkers() async {
    emit(HrLoading());
    try {
      final dio = ApiClient.instance.dio;
      final response = await dio.get('/hr/workers');
      emit(HrLoaded(ApiClient.extractPaginatedData(response.data)));
    } catch (e) {
      emit(HrError('حدث خطأ أثناء تحميل بيانات العمال: $e'));
    }
  }

  Future<void> createWorker({
    required String name,
    String? phone,
    String? nationalId,
    required String specialty,
    double? pieceRate,
    DateTime? hireDate,
  }) async {
    final dio = ApiClient.instance.dio;
    await dio.post('/hr/workers', data: {
      'name': name,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (nationalId != null && nationalId.isNotEmpty) 'nationalId': nationalId,
      'specialty': specialty,
      if (pieceRate != null) 'pieceRate': pieceRate,
      if (hireDate != null) 'hireDate': hireDate.toIso8601String(),
    });
    await fetchWorkers();
  }

  Future<void> recordProduction({
    required String workerId,
    required int piecesCount,
  }) async {
    try {
      final dio = ApiClient.instance.dio;
      await dio.post('/hr/production', data: {
        'workerId': workerId,
        'piecesCount': piecesCount,
        'date': DateTime.now().toIso8601String(),
      });
      await fetchWorkers();
    } catch (e) {
      emit(HrError('خطأ في تسجيل الإنتاج: $e'));
      rethrow;
    }
  }
}
