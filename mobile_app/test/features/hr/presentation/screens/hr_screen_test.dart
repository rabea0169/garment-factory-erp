import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/hr/presentation/cubit/hr_cubit.dart';
import 'package:garment_factory_erp/features/hr/presentation/cubit/hr_state.dart';
import 'package:garment_factory_erp/features/hr/presentation/screens/hr_screen.dart';

/// COMM-F05: ربط زر "تسجيل سلفة" في شريط شاشة HR — يفتح الحوار ثم
/// يعرض snackbar النجاح بعد الحفظ (إعادة الجلب تتم داخل recordAdvance).
void main() {
  final workers = <Map<String, dynamic>>[
    {'id': 'w-1', 'name': 'أحمد محمود', 'code': 'W-001', 'specialty': 'SEWING'},
  ];

  testWidgets('زر "تسجيل سلفة" يفتح الحوار والحفظ يعرض snackbar النجاح',
      (tester) async {
    final cubit = _StaticHrCubit(HrLoaded(workers))
      ..treasuriesResult = const [];
    await tester.pumpWidget(
      MaterialApp(home: HrScreen(cubit: cubit)),
    );
    await tester.pumpAndSettle();

    expect(find.text('أحمد محمود'), findsOneWidget);

    await tester.tap(find.byTooltip('تسجيل سلفة'));
    await tester.pumpAndSettle();

    expect(find.text('تسجيل سلفة'), findsOneWidget);

    await tester.enterText(
        find.widgetWithText(TextFormField, 'مبلغ السلفة (ج.م) *'), '150');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'سبب السلفة *'), 'سلفة عاجلة');
    await tester.tap(find.text('حفظ السلفة'));
    await tester.pumpAndSettle();

    expect(cubit.recordAdvanceCalls, hasLength(1));
    expect(find.text('تم تسجيل السلفة بنجاح'), findsOneWidget);
  });
}

/// cubit وهمي يصدر حالة واحدة ويسجل نداءات السلفة (نمط المستودع).
class _StaticHrCubit extends HrCubit {
  _StaticHrCubit(HrState state) : super() {
    emit(state);
  }

  final List<Map<String, dynamic>> recordAdvanceCalls =
      <Map<String, dynamic>>[];
  List<Map<String, dynamic>> treasuriesResult = const [];

  @override
  Future<List<Map<String, dynamic>>> fetchTreasuries() async =>
      treasuriesResult;

  @override
  Future<String?> recordAdvance({
    required String workerId,
    required double amount,
    required String reason,
    String? treasuryId,
  }) async {
    recordAdvanceCalls.add({
      'workerId': workerId,
      'amount': amount,
      'reason': reason,
      'treasuryId': treasuryId,
    });
    return null;
  }
}
