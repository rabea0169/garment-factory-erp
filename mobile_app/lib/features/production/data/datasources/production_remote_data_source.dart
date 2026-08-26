import 'package:dio/dio.dart';

class ProductionRemoteDataSource {
  const ProductionRemoteDataSource(this.dio);

  final Dio dio;

  Future<dynamic> getWorkOrders({
    required int page,
    required int limit,
  }) async {
    final response = await dio.get<dynamic>(
      '/production/work-orders',
      queryParameters: {'page': page, 'limit': limit},
    );
    return response.data;
  }

  /// Compatibility adapter for the current main API.
  ///
  /// The production workflow API is being delivered separately. Keeping the
  /// legacy endpoint here prevents the presentation layer from knowing which
  /// backend contract is currently deployed.
  Future<dynamic> updateLegacyStatus({
    required String workOrderId,
    required String status,
    required String idempotencyKey,
  }) async {
    final response = await dio.patch<dynamic>(
      '/production/work-orders/$workOrderId/status',
      data: {'status': status},
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return response.data;
  }
}
