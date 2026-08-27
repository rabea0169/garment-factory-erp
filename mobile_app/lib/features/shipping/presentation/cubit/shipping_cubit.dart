import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'shipping_state.dart';

class ShippingCubit extends Cubit<ShippingState> {
  ShippingCubit() : super(ShippingInitial());

  Future<void> createShipment({
    required String salesOrderId,
    String? shippingCompanyId,
    double? shippingCost,
    String? trackingNumber,
    String? notes,
  }) async {
    await ApiClient.instance.dio.post('/shipping', data: {
      'salesOrderId': salesOrderId,
      if (shippingCompanyId != null && shippingCompanyId.isNotEmpty)
        'shippingCompanyId': shippingCompanyId,
      if (shippingCost != null) 'shippingCost': shippingCost,
      if (trackingNumber != null && trackingNumber.isNotEmpty)
        'trackingNumber': trackingNumber,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    });
    await fetchShipments();
  }

  Future<void> updateShipmentStatus({
    required String shipmentId,
    required String status,
    String? proofOfDelivery,
  }) async {
    await ApiClient.instance.dio.patch('/shipping/$shipmentId/status', data: {
      'status': status,
      if (proofOfDelivery != null && proofOfDelivery.isNotEmpty)
        'proofOfDelivery': proofOfDelivery,
    });
    await fetchShipments();
  }

  Future<void> fetchShipments() async {
    emit(ShippingLoading());
    try {
      final response = await ApiClient.instance.dio.get('/shipping');
      emit(ShippingLoaded(ApiClient.extractPaginatedData(response.data)));
    } catch (e) {
      emit(ShippingError('فشل في تحميل بيانات الشحن'));
    }
  }
}
