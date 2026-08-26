import 'package:dio/dio.dart';

import '../../../../core/network/api_client.dart';
import '../../domain/entities/stage_transition.dart';
import '../../domain/entities/work_order.dart';
import '../../domain/failures/production_failure.dart';
import '../../domain/repositories/production_repository.dart';
import '../datasources/production_remote_data_source.dart';
import '../models/work_order_model.dart';

class ProductionRepositoryImpl implements ProductionRepository {
  const ProductionRepositoryImpl(this.remote);

  final ProductionRemoteDataSource remote;

  @override
  Future<List<WorkOrder>> getWorkOrders({
    required int page,
    required int limit,
  }) async {
    try {
      final payload = await remote.getWorkOrders(page: page, limit: limit);
      final items = ApiClient.extractPaginatedData(payload);
      return items
          .map((item) => WorkOrderModel.fromJson(
                Map<String, dynamic>.from(item as Map),
              ).toEntity())
          .toList(growable: false);
    } on DioException catch (error) {
      throw mapProductionFailure(error);
    } on FormatException catch (error) {
      throw ProductionMappingFailure(error.message);
    } on ProductionFailure {
      rethrow;
    } catch (_) {
      throw const ProductionServerFailure();
    }
  }

  @override
  Future<StageTransition> transitionStage({
    required String workOrderId,
    required ProductionStage toStage,
    String? reason,
    required String idempotencyKey,
  }) async {
    try {
      // Temporary adapter for main's PATCH status endpoint. Once the
      // production workflow API is merged, only this datasource mapping
      // changes; Domain and Presentation remain stable.
      final payload = await remote.updateLegacyStatus(
        workOrderId: workOrderId,
        status: _legacyStatusFor(toStage),
        idempotencyKey: idempotencyKey,
      );
      final json = _requiredMap(payload);
      return StageTransition(
        transitionId: json['transitionId']?.toString() ?? json['id']?.toString() ?? workOrderId,
        workOrderId: json['workOrderId']?.toString() ?? workOrderId,
        fromStage: parseProductionStage(json['currentStage'] as String?),
        toStage: toStage,
        stageVersion: (json['stageVersion'] as num?)?.toInt() ?? 0,
        replayed: json['replayed'] as bool? ?? false,
      );
    } on DioException catch (error) {
      throw mapProductionFailure(error);
    } on FormatException catch (error) {
      throw ProductionMappingFailure(error.message);
    } on ProductionFailure {
      rethrow;
    } catch (_) {
      throw const ProductionServerFailure();
    }
  }

  String _legacyStatusFor(ProductionStage stage) {
    // The current main contract uses PACKAGING; the newer workflow contract
    // uses PACKING. This translation belongs in Data, never in the screen.
    return stage == ProductionStage.packing ? 'PACKAGING' : stage.apiValue;
  }
}

ProductionFailure mapProductionFailure(DioException error) {
  final status = error.response?.statusCode;
  if (status == 401) return const ProductionUnauthorizedFailure();
  if (status == 403) return const ProductionForbiddenFailure();
  if (status == 400 || status == 422) {
    return ProductionValidationFailure(_serverMessage(error) ?? 'بيانات الإنتاج غير صالحة');
  }
  if (error.type == DioExceptionType.connectionError ||
      error.type == DioExceptionType.connectionTimeout ||
      error.type == DioExceptionType.sendTimeout ||
      error.type == DioExceptionType.receiveTimeout) {
    return const ProductionNetworkFailure();
  }
  return ProductionServerFailure(_serverMessage(error) ?? 'حدث خطأ في خدمة الإنتاج');
}

String? _serverMessage(DioException error) {
  final data = error.response?.data;
  if (data is Map && data['message'] is String) return data['message'] as String;
  return null;
}

Map<String, dynamic> _requiredMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw const FormatException('استجابة انتقال مرحلة الإنتاج فارغة');
}
