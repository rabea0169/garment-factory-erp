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
}
