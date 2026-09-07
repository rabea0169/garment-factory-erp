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
    // FINISHING قيمة legacy خادمية (تنظيم/تجهيز نهائي بعد الكي قبل التعبئة)
    // — تُترجم إلى ironing لأنها أقرب مرحلة معروضة، صف قديم واحد كان يكسر
    // قائمة الإنتاج كلها عبر FormatException (audit-FE2 P2).
    case 'FINISHING':
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
      // تسامح بدل الرمي: أي قيمة مستقبلية غير معروفة تُعرض كـ inProgress
      // بدل إسقاط القائمة كاملة — الترقية الخادمية يجب أن ترافقها ترجمة هنا.
      return WorkOrderStatus.inProgress;
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

/// MOB-3: ترميز أمر تشغيل لذاكرة Hive (شكل مسطح مستقل عن استجابة
/// الخادم المتداخلة) — يستخدمه ProductionCubit لتخزين آخر حالة ناجحة.
Map<String, dynamic> workOrderToCacheJson(WorkOrder order) => <String, dynamic>{
      'id': order.id,
      'code': order.code,
      'quantity': order.quantity,
      'status': order.status.apiValue,
      'stage': order.currentStage?.apiValue,
      'productName': order.productName,
      'variantSize': order.variantSize,
      'createdAt': order.createdAt.toIso8601String(),
    };

/// فك ترميز أمر تشغيل من ذاكرة Hive — يرمي FormatException عند أي حقل
/// تالف (يُعامل كـ "لا كاش" ولا يكسر الشاشة).
WorkOrder workOrderFromCacheJson(Map<String, dynamic> json) {
  final stageRaw = json['stage'];
  return WorkOrder(
    id: _requiredCacheString(json, 'id'),
    code: _requiredCacheString(json, 'code'),
    quantity: _requiredCacheInt(json, 'quantity'),
    status: parseWorkOrderStatus(_requiredCacheString(json, 'status')),
    currentStage: parseProductionStage(stageRaw is String ? stageRaw : null),
    productName: _requiredCacheString(json, 'productName'),
    variantSize: _requiredCacheString(json, 'variantSize'),
    createdAt: DateTime.parse(_requiredCacheString(json, 'createdAt')),
  );
}

String _requiredCacheString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('الحقل $key مفقود من كاش أمر التشغيل');
}

int _requiredCacheInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is num) return value.toInt();
  throw FormatException('الحقل $key غير صالح في كاش أمر التشغيل');
}
