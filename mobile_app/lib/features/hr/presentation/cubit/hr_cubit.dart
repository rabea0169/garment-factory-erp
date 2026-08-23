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
      emit(HrLoaded(response.data));
    } catch (e) {
      emit(HrError('حدث خطأ أثناء تحميل بيانات العمال: $e'));
    }
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
      // يمكن عرض إشعار بنجاح التسجيل هنا
    } catch (e) {
      emit(HrError('خطأ في تسجيل الإنتاج: $e'));
      await fetchWorkers(); // تحديث القائمة
    }
  }
}
