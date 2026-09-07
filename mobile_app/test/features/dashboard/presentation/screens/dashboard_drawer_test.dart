import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/auth/presentation/cubit/auth_cubit.dart';
import 'package:garment_factory_erp/features/dashboard/presentation/screens/dashboard_screen.dart';

/// CC-9: عنصر «المستخدمون» في درو لوحة التحكم — يظهر لـ SUPER_ADMIN فقط
/// (نفس نمط تقييد «الحسابات» عبر _canViewAccounting). جسم الشاشة يعرض
/// AppErrorView لأن ApiClient غير مهيأ في بيئة الاختبار — لا تأثير له
/// على فحص الدرو نفسه.
void main() {
  Future<void> pumpWithRole(WidgetTester tester, String role) async {
    // نافذة أطول من الافتراضية (600px) — عناصر الدرو الأخيرة («الحسابات»
    // و«المستخدمون») تُبنى كسولًا في ListView.builder فتخرج عن نطاق
    // العرض الافتراضي.
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final authCubit = AuthCubit()
      ..emit(AuthAuthenticated(<String, dynamic>{
        'id': 'u-1',
        'name': 'مستخدم تجريبي',
        'email': 'user@factory.com',
        'role': role,
      }));
    addTearDown(authCubit.close);
    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<AuthCubit>.value(
          value: authCubit,
          child: const DashboardScreen(),
        ),
      ),
    );
    await tester.pump();
    final scaffold = tester.state<ScaffoldState>(find.byType(Scaffold).first);
    scaffold.openDrawer();
    await tester.pumpAndSettle();
  }

  testWidgets('SUPER_ADMIN يرى عنصري «الحسابات» و«المستخدمون» في الدرو',
      (tester) async {
    await pumpWithRole(tester, 'SUPER_ADMIN');

    expect(find.text('المستخدمون'), findsOneWidget);
    expect(find.text('الحسابات'), findsOneWidget);
    // شارة الدور العربية للـ SUPER_ADMIN.
    expect(find.text('مدير النظام'), findsOneWidget);
  });

  testWidgets('GENERAL_MANAGER يرى «الحسابات» ولا يرى «المستخدمون»',
      (tester) async {
    await pumpWithRole(tester, 'GENERAL_MANAGER');

    expect(find.text('المستخدمون'), findsNothing);
    expect(find.text('الحسابات'), findsOneWidget);
  });

  testWidgets('HR_MANAGER لا يرى «المستخدمون» ولا «الحسابات»',
      (tester) async {
    await pumpWithRole(tester, 'HR_MANAGER');

    expect(find.text('المستخدمون'), findsNothing);
    expect(find.text('الحسابات'), findsNothing);
  });
}
