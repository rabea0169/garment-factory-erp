import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/users/presentation/cubit/users_cubit.dart';
import 'package:garment_factory_erp/features/users/presentation/widgets/change_role_dialog.dart';

/// CC-9: حوار تغيير الدور — يعرض الدور الحالي عربيًا، لا يرسل طلبًا عند
/// عدم التغيير، ويمرر الدور الجديد إلى UsersCubit.changeRole.
void main() {
  testWidgets('يعرض الدور الحالي عربيًا وبلا تغيير لا طلب شبكة', (tester) async {
    final cubit = _FakeUsersCubit();
    await _pumpDialog(tester, cubit);

    expect(find.textContaining('الدور الحالي: محاسب'), findsOneWidget);

    await tester.tap(find.text('حفظ الدور'));
    await tester.pumpAndSettle();

    expect(cubit.changeRoleCalls, isEmpty);
    // الحوار أُغلق بلا استدعاء.
    expect(find.text('تغيير دور سارة'), findsNothing);
  });

  testWidgets('اختيار دور جديد → changeRole بالدور الخام', (tester) async {
    final cubit = _FakeUsersCubit();
    await _pumpDialog(tester, cubit);

    // فتح القائمة واختيار "أمين صندوق".
    await tester.tap(find.text('محاسب').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('أمين صندوق').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('حفظ الدور'));
    await tester.pumpAndSettle();

    expect(cubit.changeRoleCalls, [('u-2', 'CASHIER')]);
  });

  testWidgets('خطأ الخادم (تغيير دورك) → الحوار يبقى بالرسالة', (tester) async {
    final cubit = _FakeUsersCubit()
      ..roleError = 'لا يمكنك تغيير دورك الخاص — اطلب ذلك من مدير أعلى';
    await _pumpDialog(tester, cubit);

    await tester.tap(find.text('محاسب').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('مدير عام').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('حفظ الدور'));
    await tester.pumpAndSettle();

    expect(cubit.changeRoleCalls, hasLength(1));
    expect(
      find.text('لا يمكنك تغيير دورك الخاص — اطلب ذلك من مدير أعلى'),
      findsOneWidget,
    );
    expect(find.textContaining('الدور الحالي:'), findsOneWidget);
  });
}

Future<void> _pumpDialog(WidgetTester tester, UsersCubit cubit) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ChangeUserRoleDialog(
          cubit: cubit,
          userId: 'u-2',
          currentRole: 'ACCOUNTANT',
          userName: 'سارة',
        ),
      ),
    ),
  );
  await tester.pump();
}

class _FakeUsersCubit extends UsersCubit {
  final List<(String, String)> changeRoleCalls = <(String, String)>[];
  String? roleError;

  @override
  Future<String?> changeRole({
    required String userId,
    required String role,
  }) async {
    changeRoleCalls.add((userId, role));
    return roleError;
  }
}
