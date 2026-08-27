import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/shipping/presentation/cubit/shipping_cubit.dart';
import 'package:garment_factory_erp/features/shipping/presentation/cubit/shipping_state.dart';
import 'package:garment_factory_erp/features/shipping/presentation/screens/shipping_screen.dart';

class _FakeShippingCubit extends ShippingCubit {
  _FakeShippingCubit(List<dynamic> shipments) {
    emit(ShippingLoaded(shipments));
  }

  int createCalls = 0;
  int updateCalls = 0;

  @override
  Future<List<Map<String, dynamic>>> fetchConfirmedSalesOrders() async {
    return [
      {'id': 'order-1', 'code': 'SO-1', 'status': 'CONFIRMED'},
    ];
  }

  @override
  Future<void> createShipment({
    required String salesOrderId,
    String? shippingCompanyId,
    double? shippingCost,
    String? trackingNumber,
    String? notes,
  }) async {
    createCalls++;
  }

  @override
  Future<void> updateShipmentStatus({
    required String shipmentId,
    required String status,
    String? proofOfDelivery,
  }) async {
    updateCalls++;
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FakeShippingCubit cubit,
) async {
  await tester.pumpWidget(
    MaterialApp(home: ShippingScreen(cubit: cubit)),
  );
  await tester.pump();
}

void main() {
  testWidgets(
      'requires selecting a confirmed sales order before creating a shipment', (
    tester,
  ) async {
    final cubit = _FakeShippingCubit(const [
      {'id': 'order-1', 'code': 'SO-1', 'status': 'CONFIRMED'},
    ]);
    await _pump(tester, cubit);

    await tester.tap(find.text('شحنة جديدة'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('اختر أمر البيع'), findsOneWidget);
    expect(cubit.createCalls, 0);
  });

  testWidgets('requires proof of delivery for delivered status',
      (tester) async {
    final cubit = _FakeShippingCubit([
      {
        'id': 'shipment-1',
        'code': 'SHP-1',
        'status': 'IN_TRANSIT',
        'salesOrder': {'code': 'SO-1'},
        'createdAt': '2026-08-27T10:00:00.000Z',
      },
    ]);
    await _pump(tester, cubit);

    await tester.tap(find.byTooltip('تحديث الحالة'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('تم التسليم').last);
    await tester.pump();
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('إثبات التسليم مطلوب'), findsOneWidget);
    expect(cubit.updateCalls, 0);
  });
}
