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

  Future<dynamic> transitionStage({
    required String workOrderId,
    required String toStage,
    String? reason,
    required String idempotencyKey,
  }) async {
    final response = await dio.post<dynamic>(
      '/production/work-orders/$workOrderId/stage-transitions',
      data: {
        'toStage': toStage,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return response.data;
  }

  Future<dynamic> recordStageOutput({
    required String workOrderId,
    required String stage,
    required int inputQty,
    required int acceptedQty,
    required int rejectedQty,
    required int wasteQty,
    String? notes,
  }) async {
    final response = await dio.post<dynamic>(
      '/production/work-orders/$workOrderId/stage-output',
      data: {
        'stage': stage,
        'inputQty': inputQty,
        'acceptedQty': acceptedQty,
        'rejectedQty': rejectedQty,
        'wasteQty': wasteQty,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    );
    return response.data;
  }

  Future<dynamic> consumeMaterial({
    required String workOrderId,
    required String stageRunId,
    required String rawMaterialId,
    required String warehouseId,
    required double plannedQuantity,
    required double actualQuantity,
    required double wasteQuantity,
    required String unit,
    required String idempotencyKey,
    String? wasteReason,
    String? reference,
    String? notes,
  }) async {
    final response = await dio.post<dynamic>(
      '/production/work-orders/$workOrderId/material-consumptions',
      data: {
        'stageRunId': stageRunId,
        'rawMaterialId': rawMaterialId,
        'warehouseId': warehouseId,
        'plannedQuantity': plannedQuantity,
        'actualQuantity': actualQuantity,
        'wasteQuantity': wasteQuantity,
        'unit': unit,
        if (wasteReason != null) 'wasteReason': wasteReason,
        if (reference != null && reference.isNotEmpty) 'reference': reference,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return response.data;
  }

  Future<dynamic> finalizeCost({required String workOrderId}) async {
    final response = await dio.post<dynamic>(
      '/production/work-orders/$workOrderId/cost/finalize',
      data: <String, dynamic>{},
    );
    return response.data;
  }
}
