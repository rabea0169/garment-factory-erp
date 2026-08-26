enum WorkOrderStatus {
  planned,
  cutting,
  sewing,
  ironing,
  packing,
  inProgress,
  completed,
  cancelled,
}

enum ProductionStage { cutting, sewing, ironing, packing }

class WorkOrder {
  const WorkOrder({
    required this.id,
    required this.code,
    required this.quantity,
    required this.status,
    required this.currentStage,
    required this.productName,
    required this.variantSize,
    required this.createdAt,
  });

  final String id;
  final String code;
  final int quantity;
  final WorkOrderStatus status;
  final ProductionStage? currentStage;
  final String productName;
  final String variantSize;
  final DateTime createdAt;
}

extension WorkOrderStatusApiValue on WorkOrderStatus {
  String get apiValue {
    switch (this) {
      case WorkOrderStatus.planned:
        return 'PLANNED';
      case WorkOrderStatus.cutting:
        return 'CUTTING';
      case WorkOrderStatus.sewing:
        return 'SEWING';
      case WorkOrderStatus.ironing:
        return 'IRONING';
      case WorkOrderStatus.packing:
        return 'PACKAGING';
      case WorkOrderStatus.inProgress:
        return 'IN_PROGRESS';
      case WorkOrderStatus.completed:
        return 'COMPLETED';
      case WorkOrderStatus.cancelled:
        return 'CANCELLED';
    }
  }
}

extension ProductionStageApiValue on ProductionStage {
  String get apiValue {
    switch (this) {
      case ProductionStage.cutting:
        return 'CUTTING';
      case ProductionStage.sewing:
        return 'SEWING';
      case ProductionStage.ironing:
        return 'IRONING';
      case ProductionStage.packing:
        return 'PACKING';
    }
  }
}

WorkOrderStatus parseWorkOrderStatus(String? value) {
  switch (value?.toUpperCase()) {
    case 'PLANNED':
      return WorkOrderStatus.planned;
    case 'CUTTING':
      return WorkOrderStatus.cutting;
    case 'SEWING':
      return WorkOrderStatus.sewing;
    case 'IRONING':
      return WorkOrderStatus.ironing;
    case 'PACKAGING':
    case 'PACKING':
      return WorkOrderStatus.packing;
    case 'IN_PROGRESS':
      return WorkOrderStatus.inProgress;
    case 'COMPLETED':
      return WorkOrderStatus.completed;
    case 'CANCELLED':
      return WorkOrderStatus.cancelled;
    default:
      throw FormatException('حالة أمر التشغيل غير معروفة: $value');
  }
}

ProductionStage? parseProductionStage(String? value) {
  switch (value?.toUpperCase()) {
    case 'CUTTING':
      return ProductionStage.cutting;
    case 'SEWING':
      return ProductionStage.sewing;
    case 'IRONING':
      return ProductionStage.ironing;
    case 'PACKING':
    case 'PACKAGING':
      return ProductionStage.packing;
    case null:
      return null;
    default:
      throw FormatException('مرحلة الإنتاج غير معروفة: $value');
  }
}
