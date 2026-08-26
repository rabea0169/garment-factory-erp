import 'package:dio/dio.dart';

import '../../../../core/network/api_client.dart';
import '../../domain/entities/production_commands.dart';
import '../../domain/entities/stage_transition.dart';
import '../../domain/entities/work_order.dart';
import '../../domain/failures/production_failure.dart';
import '../../domain/repositories/production_repository.dart';
import '../datasources/production_remote_data_source.dart';
import '../models/production_models.dart';
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
      final payload = await remote.transitionStage(
        workOrderId: workOrderId,
        toStage: toStage.apiValue,
        reason: reason,
        idempotencyKey: idempotencyKey,
      );
      return StageTransitionModel.fromJson(_requiredMap(payload)).toEntity();
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
  Future<StageOutputResult> recordStageOutput(
    RecordStageOutputCommand command,
  ) async {
    try {
      final payload = await remote.recordStageOutput(
        workOrderId: command.workOrderId,
        stage: command.stage.apiValue,
        inputQty: command.inputQty,
        acceptedQty: command.acceptedQty,
        rejectedQty: command.rejectedQty,
        wasteQty: command.wasteQty,
        notes: command.notes,
      );
      return StageOutputResultModel.fromJson(_requiredMap(payload)).toEntity();
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
  Future<MaterialConsumption> consumeMaterial(
    ConsumeMaterialCommand command,
  ) async {
    try {
      final payload = await remote.consumeMaterial(
        workOrderId: command.workOrderId,
        stageRunId: command.stageRunId,
        rawMaterialId: command.rawMaterialId,
        warehouseId: command.warehouseId,
        plannedQuantity: command.plannedQuantity,
        actualQuantity: command.actualQuantity,
        wasteQuantity: command.wasteQuantity,
        unit: command.unit,
        idempotencyKey: command.idempotencyKey,
        wasteReason: command.wasteReason,
        reference: command.reference,
        notes: command.notes,
      );
      return MaterialConsumptionModel.fromJson(_requiredMap(payload)).toEntity();
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
  Future<ProductionCostSnapshot> finalizeCost({
    required String workOrderId,
  }) async {
    try {
      final payload = await remote.finalizeCost(workOrderId: workOrderId);
      return ProductionCostSnapshotModel.fromJson(_requiredMap(payload)).toEntity();
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
}

ProductionFailure mapProductionFailure(DioException error) {
  final status = error.response?.statusCode;
  if (status == 401) return const ProductionUnauthorizedFailure();
  if (status == 403) return const ProductionForbiddenFailure();
  if (status == 400 || status == 422) {
    return ProductionValidationFailure(
      _serverMessage(error) ?? 'بيانات الإنتاج غير صالحة',
    );
  }
  if (error.type == DioExceptionType.connectionError ||
      error.type == DioExceptionType.connectionTimeout ||
      error.type == DioExceptionType.sendTimeout ||
      error.type == DioExceptionType.receiveTimeout) {
    return const ProductionNetworkFailure();
  }
  return ProductionServerFailure(
    _serverMessage(error) ?? 'حدث خطأ في خدمة الإنتاج',
  );
}

String? _serverMessage(DioException error) {
  final data = error.response?.data;
  if (data is Map && data['message'] is String) return data['message'] as String;
  return null;
}

Map<String, dynamic> _requiredMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw const FormatException('استجابة الإنتاج فارغة أو غير صالحة');
}
