import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/production/data/models/work_order_model.dart';
import 'package:garment_factory_erp/features/production/domain/entities/work_order.dart';

void main() {
  group('WorkOrderModel', () {
    test('maps nested API response to a typed entity', () {
      final model = WorkOrderModel.fromJson({
        'id': 'wo-1',
        'code': 'WO-0001',
        'quantity': 120,
        'status': 'SEWING',
        'currentStage': 'SEWING',
        'createdAt': '2026-08-26T08:30:00.000Z',
        'productVariant': {
          'size': 'L',
          'product': {'name': 'قميص قطني'},
        },
      });

      final entity = model.toEntity();
      expect(entity.id, 'wo-1');
      expect(entity.code, 'WO-0001');
      expect(entity.quantity, 120);
      expect(entity.status, WorkOrderStatus.sewing);
      expect(entity.currentStage, ProductionStage.sewing);
      expect(entity.productName, 'قميص قطني');
      expect(entity.variantSize, 'L');
    });

    test('rejects an unknown status instead of leaking dynamic data', () {
      expect(
        () => WorkOrderModel.fromJson({
          'id': 'wo-1',
          'code': 'WO-0001',
          'quantity': 1,
          'status': 'UNKNOWN',
          'createdAt': '2026-08-26T08:30:00.000Z',
        }),
        throwsFormatException,
      );
    });
  });
}
