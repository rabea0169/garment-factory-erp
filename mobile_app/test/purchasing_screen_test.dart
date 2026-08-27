import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/purchasing/presentation/cubit/purchasing_cubit.dart';
import 'package:garment_factory_erp/features/purchasing/presentation/screens/purchasing_screen.dart';

class _FakePurchasingCubit extends PurchasingCubit {
  _FakePurchasingCubit({
    required List<dynamic> orders,
    List<dynamic> suppliers = const [
      {'id': 'supplier-1', 'name': 'مورد تجريبي'},
    ],
    List<dynamic> rawMaterials = const [
      {'id': 'material-1', 'name': 'قماش'},
    ],
  }) {
    emit(
      PurchasingLoaded(
        orders: orders,
        suppliers: suppliers,
        rawMaterials: rawMaterials,
      ),
    );
  }

  int createCalls = 0;
  int receiveCalls = 0;

  @override
  Future<void> createPurchaseOrder({
    required String supplierId,
    required String paymentType,
    DateTime? dueDate,
    String? notes,
    required List<Map<String, dynamic>> items,
  }) async {
    createCalls++;
  }

  @override
  Future<void> receivePurchaseOrder({
    required String purchaseOrderId,
    required List<Map<String, dynamic>> items,
    String? notes,
  }) async {
    receiveCalls++;
  }
}

Future<void> _pump(WidgetTester tester, _FakePurchasingCubit cubit) async {
  await tester.pumpWidget(
    MaterialApp(home: PurchasingScreen(cubit: cubit)),
  );
  await tester.pump();
}

void main() {
  testWidgets('validates supplier and material before creating purchase order',
      (tester) async {
    final cubit = _FakePurchasingCubit(orders: const []);
    await _pump(tester, cubit);

    await tester.tap(find.text('أمر شراء جديد'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('اختر المورد'), findsOneWidget);
    expect(find.text('اختر الخامة'), findsOneWidget);
    expect(cubit.createCalls, 0);
  });

  testWidgets('validates receipt item before recording receipt',
      (tester) async {
    final cubit = _FakePurchasingCubit(
      orders: [
        {
          'id': 'po-1',
          'code': 'PO-1',
          'status': 'PENDING',
          'supplier': {'name': 'مورد تجريبي'},
          'items': [
            {'id': 'poi-1', 'rawMaterialId': 'material-1', 'quantity': 5},
          ],
        },
      ],
    );
    await _pump(tester, cubit);

    await tester.tap(find.text('PO-1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('تسجيل استلام'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('اختر بندًا'), findsOneWidget);
    expect(cubit.receiveCalls, 0);
  });
}
