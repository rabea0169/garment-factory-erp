import 'work_order.dart';

class CreateWorkOrderCommand {
  const CreateWorkOrderCommand({
    required this.productVariantId,
    required this.bomVersionId,
    required this.quantity,
  });

  final String productVariantId;
  final String bomVersionId;
  final int quantity;
}

class RecordStageOutputCommand {
  const RecordStageOutputCommand({
    required this.workOrderId,
    required this.stage,
    required this.inputQty,
    required this.acceptedQty,
    required this.rejectedQty,
    required this.wasteQty,
    required this.idempotencyKey,
    this.notes,
  });

  final String workOrderId;
  final ProductionStage stage;
  final int inputQty;
  final int acceptedQty;
  final int rejectedQty;
  final int wasteQty;
  final String idempotencyKey;
  final String? notes;
}

class ConsumeMaterialCommand {
  const ConsumeMaterialCommand({
    required this.workOrderId,
    required this.stageRunId,
    required this.rawMaterialId,
    required this.warehouseId,
    required this.plannedQuantity,
    required this.actualQuantity,
    required this.wasteQuantity,
    required this.unit,
    required this.idempotencyKey,
    this.wasteReason,
    this.reference,
    this.notes,
  });

  final String workOrderId;
  final String stageRunId;
  final String rawMaterialId;
  final String warehouseId;
  final double plannedQuantity;
  final double actualQuantity;
  final double wasteQuantity;
  final String unit;
  final String idempotencyKey;
  final String? wasteReason;
  final String? reference;
  final String? notes;
}

class StageOutputResult {
  const StageOutputResult({
    required this.workOrderId,
    required this.stage,
    required this.status,
  });

  final String workOrderId;
  final ProductionStage stage;
  final String status;
}

class MaterialConsumption {
  const MaterialConsumption({
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
}

class ProductionCostSnapshot {
  const ProductionCostSnapshot({
    required this.id,
    required this.workOrderId,
    required this.status,
    required this.materialCost,
    required this.wasteCost,
    required this.totalCost,
    required this.acceptedQty,
    this.unitCost,
  });

  final String id;
  final String workOrderId;
  final String status;
  final double materialCost;
  final double wasteCost;
  final double totalCost;
  final int acceptedQty;
  final double? unitCost;
}
