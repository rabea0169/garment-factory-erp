import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/accounting/presentation/cubit/accounting_cubit.dart';
import 'package:garment_factory_erp/features/accounting/presentation/screens/accounting_screen.dart';

class _FakeAccountingCubit extends AccountingCubit {
  _FakeAccountingCubit() {
    emit(
      AccountingLoaded(
        const [],
        const [],
        const [
          {'id': 'treasury-1', 'name': 'الخزينة الرئيسية', 'type': 'CASH'},
        ],
      ),
    );
  }

  int createCalls = 0;

  @override
  Future<void> createVoucher({
    required String type,
    required double amount,
    required String description,
    required String treasuryId,
    String? reference,
    String? counterpartyType,
    String? counterpartyId,
  }) async {
    createCalls++;
  }
}

void main() {
  testWidgets('validates required voucher fields before submitting',
      (tester) async {
    final cubit = _FakeAccountingCubit();
    await tester.pumpWidget(
      MaterialApp(home: AccountingScreen(cubit: cubit)),
    );
    await tester.pump();

    await tester.tap(find.text('سند جديد'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('أدخل مبلغًا موجبًا'), findsOneWidget);
    expect(find.text('الوصف مطلوب'), findsOneWidget);
    expect(find.text('اختر الخزينة'), findsOneWidget);
    expect(cubit.createCalls, 0);
  });
}
