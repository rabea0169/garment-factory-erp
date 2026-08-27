import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/quality/presentation/cubit/quality_cubit.dart';
import 'package:garment_factory_erp/features/quality/presentation/cubit/quality_state.dart';
import 'package:garment_factory_erp/features/quality/presentation/screens/quality_screen.dart';

class _FakeQualityCubit extends QualityCubit {
  _FakeQualityCubit() {
    emit(QualityLoaded(const []));
  }

  int submitCalls = 0;

  @override
  Future<void> submitQualityCheck({
    required String workOrderId,
    required String stageRunId,
    required String stage,
    required int checkedQty,
    required int passedQty,
    required int rejectedQty,
    required int wasteQty,
    String? rejectionReason,
    String? wasteReason,
    String? notes,
  }) async {
    submitCalls++;
  }
}

Future<void> _pump(WidgetTester tester, _FakeQualityCubit cubit) async {
  await tester.pumpWidget(MaterialApp(home: QualityScreen(cubit: cubit)));
  await tester.pump();
}

void main() {
  testWidgets('validates work order and stage run ids', (tester) async {
    final cubit = _FakeQualityCubit();
    await _pump(tester, cubit);

    await tester.tap(find.text('تقرير جديد'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('هذا الحقل مطلوب'), findsNWidgets(2));
    expect(cubit.submitCalls, 0);
  });

  testWidgets('rejects a non-conserving quantity breakdown', (tester) async {
    final cubit = _FakeQualityCubit();
    await _pump(tester, cubit);

    await tester.tap(find.text('تقرير جديد'));
    await tester.pumpAndSettle();
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'work-order-1');
    await tester.enterText(fields.at(1), 'stage-run-1');
    await tester.enterText(fields.at(2), '10');
    await tester.enterText(fields.at(3), '8');
    await tester.enterText(fields.at(4), '1');
    await tester.enterText(fields.at(5), '0');
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(
      find.text('يجب أن يساوي المفحوص مجموع السليم والمرفوض والهالك'),
      findsOneWidget,
    );
    expect(cubit.submitCalls, 0);
  });
}
