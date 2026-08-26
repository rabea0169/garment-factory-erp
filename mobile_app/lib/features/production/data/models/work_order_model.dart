import '../../domain/entities/work_order.dart';

class WorkOrderModel {
  const WorkOrderModel({
    required this.id,
    required this.code,
    required this.quantity,
    required this.status,
    required this.currentStage,
    required this.productName,
    required this.variantSize,
    required this.createdAt,
  });

  factory WorkOrderModel.fromJson(Map<String, dynamic> json) {
    final variant = _asMap(json['productVariant'] ?? json['variant']);
    final product = _asMap(variant['product']);

    return WorkOrderModel(
      id: _requiredString(json, 'id'),
      code: _requiredString(json, 'code'),
      quantity: _requiredInt(json, 'quantity'),
      status: parseWorkOrderStatus(json['status'] as String?),
      currentStage: parseProductionStage(json['currentStage'] as String?),
      productName: product['name'] as String? ?? 'غير معروف',
      variantSize: variant['size']?.toString() ?? 'غير محدد',
      createdAt: DateTime.parse(_requiredString(json, 'createdAt')),
    );
  }

  final String id;
  final String code;
  final int quantity;
  final WorkOrderStatus status;
  final ProductionStage? currentStage;
  final String productName;
  final String variantSize;
  final DateTime createdAt;

  WorkOrder toEntity() => WorkOrder(
        id: id,
        code: code,
        quantity: quantity,
        status: status,
        currentStage: currentStage,
        productName: productName,
        variantSize: variantSize,
        createdAt: createdAt,
      );
}

Map<String, dynamic> _asMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('الحقل $key مفقود من أمر التشغيل');
}

int _requiredInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is num) return value.toInt();
  throw FormatException('الحقل $key غير صالح في أمر التشغيل');
}
