import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'production_state.dart';

class ProductionCubit extends Cubit<ProductionState> {
  ProductionCubit() : super(ProductionInitial());

  Future<void> fetchWorkOrders() async {
    emit(ProductionLoading());
    try {
      final dio = ApiClient.instance.dio;
      final response = await dio.get('/production/work-orders');
      emit(ProductionLoaded(response.data));
    } catch (e) {
      emit(ProductionError('حدث خطأ أثناء تحميل أوامر التشغيل: $e'));
    }
  }

  Future<void> updateOrderStatus(String id, String newStatus) async {
    try {
      final dio = ApiClient.instance.dio;
      await dio.patch('/production/work-orders/$id/status', data: {
        'status': newStatus,
      });
      // جلب البيانات مجدداً بعد التحديث
      await fetchWorkOrders();
    } catch (e) {
      emit(ProductionError('فشل في تحديث حالة الأمر: $e'));
    }
  }
}
