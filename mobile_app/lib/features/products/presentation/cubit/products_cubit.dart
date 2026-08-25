import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'products_state.dart';

class ProductsCubit extends Cubit<ProductsState> {
  ProductsCubit() : super(ProductsInitial());

  Future<void> fetchProducts() async {
    emit(ProductsLoading());
    try {
      final dio = ApiClient.instance.dio;
      final response = await dio.get('/products');
      emit(ProductsLoaded(response.data));
    } catch (e) {
      emit(ProductsError('حدث خطأ أثناء تحميل المنتجات: $e'));
    }
  }

  Future<void> createFullProduct({
    required Map<String, dynamic> productData,
    required List<Map<String, dynamic>> variants,
    required List<Map<String, dynamic>> bomItems,
  }) async {
    try {
      final dio = ApiClient.instance.dio;
      // 1. Create Product
      final pRes = await dio.post('/products', data: productData);
      final productId = pRes.data['id'];

      // 2. Create Variants
      for (var v in variants) {
        await dio.post('/products/$productId/variants', data: v);
      }

      // 3. Add BOM Items
      for (var b in bomItems) {
        await dio.post('/products/$productId/bom', data: b);
      }

      // Refresh list
      fetchProducts();
    } catch (e) {
      emit(ProductsError('فشل في إضافة المنتج وتفاصيله'));
    }
  }
}
