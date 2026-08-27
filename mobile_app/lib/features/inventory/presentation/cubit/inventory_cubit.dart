import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'inventory_state.dart';

class InventoryCubit extends Cubit<InventoryState> {
  InventoryCubit() : super(InventoryInitial());

  Future<void> fetchRawMaterials() => fetchInventoryData();

  Future<void> fetchInventoryData() async {
    emit(InventoryLoading());
    try {
      final dio = ApiClient.instance.dio;

      // جلب البيانات من الـ API بشكل متوازي
      final responses = await Future.wait([
        dio.get('/inventory/raw-materials'),
        dio.get('/inventory/finished-goods'),
        dio.get('/inventory/raw-materials/low-stock'),
      ]);

      emit(InventoryLoaded(
        rawMaterials: ApiClient.extractPaginatedData(responses[0].data),
        finishedGoods: ApiClient.extractPaginatedData(responses[1].data),
        lowStockMaterials: ApiClient.extractPaginatedData(responses[2].data),
      ));
    } catch (e) {
      emit(InventoryError('حدث خطأ أثناء تحميل بيانات المخزون: $e'));
    }
  }

  Future<void> addRawMaterialStock(
      String id, double quantity, double cost) async {
    try {
      final dio = ApiClient.instance.dio;
      await dio.post('/inventory/raw-materials/$id/add-stock', data: {
        'quantity': quantity,
        'costPerUnit': cost,
      });
      // تحديث البيانات بعد الإضافة
      await fetchInventoryData();
    } catch (e) {
      emit(InventoryError('فشل في إضافة المخزون: $e'));
      rethrow;
    }
  }
}
