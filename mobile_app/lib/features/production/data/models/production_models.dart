import '../../domain/entities/production_commands.dart';
import '../../domain/entities/stage_transition.dart';
import '../../domain/entities/work_order.dart';

class StageTransitionModel {
  const StageTransitionModel({
    required this.transitionId,
    required this.workOrderId,
    required this.fromStage,
    required this.toStage,
    required this.stageRunId,
    required this.stageVersion,
    required this.replayed,
  });

  factory StageTransitionModel.fromJson(Map<String, dynamic> json) {
    return StageTransitionModel(
      transitionId: _requiredString(json, 'transitionId'),
      workOrderId: _requiredString(json, 'workOrderId'),
      fromStage: parseProductionStage(json['fromStage'] as String?),
      toStage: parseProductionStage(_requiredString(json, 'toStage'))!,
      stageRunId: _requiredString(json, 'stageRunId'),
      stageVersion: _requiredInt(json, 'stageVersion'),
      replayed: json['replayed'] as bool? ?? false,
    );
  }

  final String transitionId;
  final String workOrderId;
  final ProductionStage? fromStage;
  final ProductionStage toStage;
  final String stageRunId;
  final int stageVersion;
  final bool replayed;

  StageTransition toEntity() => StageTransition(
        transitionId: transitionId,
        workOrderId: workOrderId,
        fromStage: fromStage,
        toStage: toStage,
        stageRunId: stageRunId,
        stageVersion: stageVersion,
        replayed: replayed,
      );
}

class StageOutputResultModel {
  const StageOutputResultModel({
    required this.workOrderId,
    required this.stage,
    required this.status,
  });

  factory StageOutputResultModel.fromJson(Map<String, dynamic> json) {
    return StageOutputResultModel(
      workOrderId: _requiredString(json, 'workOrderId'),
      stage: parseProductionStage(_requiredString(json, 'stage'))!,
      status: _requiredString(json, 'status'),
    );
  }

  final String workOrderId;
  final ProductionStage stage;
  final String status;

  StageOutputResult toEntity() => StageOutputResult(
        workOrderId: workOrderId,
        stage: stage,
        status: status,
      );
}

class MaterialConsumptionModel {
  const MaterialConsumptionModel({
    required this.consumptionId,
    required this.workOrderId,
    required this.stageRunId,
    required this.stockLedgerEntryId,
    required this.actualQuantity,
    required this.wasteQuantity,
    required this.unitCost,
    required this.totalCost,
    required this.wasteCost,
    required this.replayed,
  });

  factory MaterialConsumptionModel.fromJson(Map<String, dynamic> json) {
    return MaterialConsumptionModel(
      consumptionId: _requiredString(json, 'consumptionId'),
      workOrderId: _requiredString(json, 'workOrderId'),
      stageRunId: _requiredString(json, 'stageRunId'),
      stockLedgerEntryId: _requiredString(json, 'stockLedgerEntryId'),
      actualQuantity: _requiredDouble(json, 'actualQuantity'),
      wasteQuantity: _requiredDouble(json, 'wasteQuantity'),
      unitCost: _requiredDouble(json, 'unitCost'),
      totalCost: _requiredDouble(json, 'totalCost'),
      wasteCost: _requiredDouble(json, 'wasteCost'),
      replayed: json['replayed'] as bool? ?? false,
    );
  }

  final String consumptionId;
  final String workOrderId;
  final String stageRunId;
  final String stockLedgerEntryId;
  final double actualQuantity;
  final double wasteQuantity;
  final double unitCost;
  final double totalCost;
  final double wasteCost;
  final bool replayed;

  MaterialConsumption toEntity() => MaterialConsumption(
        consumptionId: consumptionId,
        workOrderId: workOrderId,
        stageRunId: stageRunId,
        stockLedgerEntryId: stockLedgerEntryId,
        actualQuantity: actualQuantity,
        wasteQuantity: wasteQuantity,
        unitCost: unitCost,
        totalCost: totalCost,
        wasteCost: wasteCost,
        replayed: replayed,
      );
}

class ProductionCostSnapshotModel {
  const ProductionCostSnapshotModel({
    required this.id,
    required this.workOrderId,
    required this.status,
    required this.materialCost,
    required this.wasteCost,
    required this.totalCost,
    required this.acceptedQty,
    required this.unitCost,
  });

  factory ProductionCostSnapshotModel.fromJson(Map<String, dynamic> json) {
    return ProductionCostSnapshotModel(
      id: _requiredString(json, 'id'),
      workOrderId: _requiredString(json, 'workOrderId'),
      status: _requiredString(json, 'status'),
      materialCost: _requiredDouble(json, 'materialCost'),
      wasteCost: _requiredDouble(json, 'wasteCost'),
      totalCost: _requiredDouble(json, 'totalCost'),
      acceptedQty: _requiredInt(json, 'acceptedQty'),
      unitCost: _nullableDouble(json['unitCost']),
    );
  }

  final String id;
  final String workOrderId;
  final String status;
  final double materialCost;
  final double wasteCost;
  final double totalCost;
  final int acceptedQty;
  final double? unitCost;

  ProductionCostSnapshot toEntity() => ProductionCostSnapshot(
        id: id,
        workOrderId: workOrderId,
        status: status,
        materialCost: materialCost,
        wasteCost: wasteCost,
        totalCost: totalCost,
        acceptedQty: acceptedQty,
        unitCost: unitCost,
      );
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('الحقل $key مفقود من استجابة الإنتاج');
}

int _requiredInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is num) return value.toInt();
  throw FormatException('الحقل $key غير صالح في استجابة الإنتاج');
}

double _requiredDouble(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is num) return value.toDouble();
  if (value is String) {
    final parsed = double.tryParse(value);
    if (parsed != null) return parsed;
  }
  throw FormatException('الحقل $key غير صالح في استجابة الإنتاج');
}

double? _nullableDouble(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  throw const FormatException('التكلفة الوحدية غير صالحة في استجابة الإنتاج');
}
