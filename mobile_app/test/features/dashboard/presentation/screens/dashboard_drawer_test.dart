import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/widgets/selim/selim_more_sheet.dart';
import 'package:garment_factory_erp/features/auth/presentation/cubit/auth_cubit.dart';
import 'package:garment_factory_erp/features/dashboard/presentation/screens/dashboard_screen.dart';

/// SELIM-ERP W1: استبدل درج لوحة التحكم القديم بالهيكل التكيفي —
/// القسم «المزيد» في الشريط السفلي يفتح درج «كل الأقسام» الذي يصفي
/// الأقسام حسب الدور عبر RouteAccess (نفس مرآة سياسات @Roles).
/// هذه الاختبارات تحافظ على عقود الرؤية الأصلية (CC-9) على الواجهة
/// الجديدة: «المستخدمون» لـ SUPER_ADMIN فقط و«الحسابات» للمالية.
void main() {
  Future<void> pumpWithRole(WidgetTester tester, String role) async {
    // نافذة أطول من الافتراضية (600px) — عناصر الدرج الأخيرة تُبنى
    // كسولًا في ListView داخل DraggableScrollableSheet.
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
    // فتح درج «كل الأقسام» مباشرة (نفس ما يفعله زر المزيد في الشريط).
    // لا ننتظر مستقبل الدرج — لا يكتمل إلا عند الإغلاق.
    // ignore: unawaited_futures
    showSelimMoreSheet(
      tester.element(find.byType(Scaffold).first),
      role: role,
    );
    await tester.pumpAndSettle();
  }

  testWidgets('SUPER_ADMIN يرى «المستخدمون» و«الحسابات والقيود» في درج الأقسام',
      (tester) async {
    await pumpWithRole(tester, 'SUPER_ADMIN');

    expect(find.text('المستخدمون'), findsOneWidget);
    expect(find.text('الحسابات والقيود'), findsOneWidget);
    // أقسام Selim الجديدة تظهر كاملة للسوبر أدمن.
    expect(find.text('عروض الأسعار'), findsOneWidget);
    expect(find.text('تسويات الجرد'), findsOneWidget);
    expect(find.text('مركز الطباعة'), findsOneWidget);
  });

  testWidgets('GENERAL_MANAGER يرى «الحسابات والقيود» ولا يرى «المستخدمون»',
      (tester) async {
    await pumpWithRole(tester, 'GENERAL_MANAGER');

    expect(find.text('المستخدمون'), findsNothing);
    expect(find.text('الحسابات والقيود'), findsOneWidget);
    // المدير العام يرى كل الأقسام المالية والإنتاجية.
    expect(find.text('الخزينة'), findsOneWidget);
    expect(find.text('القص والتعبئة'), findsOneWidget);
  });

  testWidgets('HR_MANAGER لا يرى «المستخدمون» ولا «الحسابات»',
      (tester) async {
    await pumpWithRole(tester, 'HR_MANAGER');

    expect(find.text('المستخدمون'), findsNothing);
    expect(find.text('الحسابات والقيود'), findsNothing);
    // لكن يرى أقسام الموارد البشرية المخصصة له.
    expect(find.text('العمالة والأجور'), findsOneWidget);
    expect(find.text('كشوف الرواتب المجمدة'), findsOneWidget);
  });
}
