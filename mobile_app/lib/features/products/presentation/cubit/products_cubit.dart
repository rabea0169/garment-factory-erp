import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import 'products_state.dart';

class ProductsCubit extends Cubit<ProductsState> {
  ProductsCubit() : super(ProductsInitial());

  Future<void> fetchProducts() async {
    emit(ProductsLoading());
    try {
      final dio = ApiClient.instance.dio;
      final response = await dio.get('/products');
      emit(
        ProductsLoaded(
          ApiParsing.paginatedMaps(
            response.data,
            context: 'المنتجات',
          ),
        ),
      );
    } catch (error) {
      emit(ProductsError(ApiClient.instance.messageFor(error)));
    }
  }

  Future<void> createFullProduct({
    required Map<String, dynamic> productData,
    required List<Map<String, dynamic>> variants,
    required List<Map<String, dynamic>> bomItems,
  }) async {
    emit(ProductsSaving());
    try {
      final payload = <String, dynamic>{
        ...productData,
        'variants': variants,
        'bomItems': bomItems,
      };
      await ApiClient.instance.dio.post('/products/full', data: payload);
      await fetchProducts();
    } catch (error) {
      emit(ProductsError(ApiClient.instance.messageFor(error)));
      rethrow;
    }
  }
}
