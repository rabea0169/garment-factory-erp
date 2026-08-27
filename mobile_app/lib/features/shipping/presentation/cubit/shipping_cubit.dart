import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import 'shipping_state.dart';

class ShippingCubit extends Cubit<ShippingState> {
  ShippingCubit({Uuid? uuid})
      : _uuid = uuid ?? const Uuid(),
        super(ShippingInitial());

  final Uuid _uuid;

  Future<List<Map<String, dynamic>>> fetchConfirmedSalesOrders() async {
    final response = await ApiClient.instance.dio.get('/sales/orders');
    return ApiParsing.paginatedMaps(
      response.data,
      context: 'أوامر البيع',
    ).where((order) => order['status'] == 'CONFIRMED').toList();
  }

  Future<void> createShipment({
    required String salesOrderId,
    String? shippingCompanyId,
    double? shippingCost,
    String? trackingNumber,
    String? notes,
  }) async {
    await ApiClient.instance.dio.post(
      '/shipping',
      data: {
        'salesOrderId': salesOrderId,
        if (shippingCompanyId != null && shippingCompanyId.isNotEmpty)
          'shippingCompanyId': shippingCompanyId,
        if (shippingCost != null) 'shippingCost': shippingCost,
        if (trackingNumber != null && trackingNumber.isNotEmpty)
          'trackingNumber': trackingNumber,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
      options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
    );
    await fetchShipments();
  }

  Future<void> updateShipmentStatus({
    required String shipmentId,
    required String status,
    String? proofOfDelivery,
  }) async {
    await ApiClient.instance.dio.patch(
      '/shipping/$shipmentId/status',
      data: {
        'status': status,
        if (proofOfDelivery != null && proofOfDelivery.isNotEmpty)
          'proofOfDelivery': proofOfDelivery,
      },
      options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
    );
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
