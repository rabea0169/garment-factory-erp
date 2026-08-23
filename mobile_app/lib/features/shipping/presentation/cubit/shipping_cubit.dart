import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'shipping_state.dart';

class ShippingCubit extends Cubit<ShippingState> {
  ShippingCubit() : super(ShippingInitial());

  Future<void> fetchShipments() async {
    emit(ShippingLoading());
    try {
      final response = await ApiClient.instance.dio.get('/shipping');
      emit(ShippingLoaded(response.data));
    } catch (e) {
      emit(ShippingError('فشل في تحميل بيانات الشحن'));
    }
  }
}
