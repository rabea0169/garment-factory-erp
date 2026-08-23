import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';

abstract class SalesState {}

class SalesInitial extends SalesState {}
class SalesLoading extends SalesState {}
class SalesLoaded extends SalesState {
  final List<dynamic> orders;
  SalesLoaded(this.orders);
}
class SalesError extends SalesState {
  final String message;
  SalesError(this.message);
}

class SalesCubit extends Cubit<SalesState> {
  SalesCubit() : super(SalesInitial());

  Future<void> fetchOrders() async {
    emit(SalesLoading());
    try {
      final dio = ApiClient.instance.dio;
      final response = await dio.get('/sales/orders');
      emit(SalesLoaded(response.data));
    } catch (e) {
      emit(SalesError('حدث خطأ أثناء تحميل المبيعات: $e'));
    }
  }
}
