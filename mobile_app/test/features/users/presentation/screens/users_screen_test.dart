import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/widgets/app_feedback.dart';
import 'package:garment_factory_erp/features/users/presentation/cubit/users_cubit.dart';
import 'package:garment_factory_erp/features/users/presentation/cubit/users_state.dart';
import 'package:garment_factory_erp/features/users/presentation/screens/users_screen.dart';

/// CC-9: شاشة المستخدمين — حالات الواجهة (تحميل/قائمة/فراغ/خطأ)، بطاقات
/// بالدور العربي وشارة النشاط، وأزرار تغيير الدور/تعطيل/تنشيط + FAB.
void main() {
  final users = <Map<String, dynamic>>[
    {
      'id': 'u-1',
      'name': 'مدير النظام',
      'email': 'admin@factory.com',
      'role': 'SUPER_ADMIN',
      'isActive': true,
      'createdAt': '2026-09-01T10:00:00.000Z',
    },
    {
      'id': 'u-2',
      'name': 'سارة المحاسبة',
      'email': 'sara@factory.com',
      'role': 'ACCOUNTANT',
      'isActive': false,
      'createdAt': '2026-09-01T10:00:00.000Z',
    },
  ];

  testWidgets('تحميل → AppLoadingView برسالة المستخدمين', (tester) async {
    await _pump(tester, const UsersLoading());
    expect(find.byType(AppLoadingView), findsOneWidget);
    expect(find.text('جاري تحميل المستخدمين...'), findsOneWidget);
  });

  testWidgets('قائمة → بطاقات بالاسم/البريد/الدور العربي وشارة النشاط',
      (tester) async {
    await _pump(tester, UsersLoaded(users));

    expect(find.text('مدير النظام'), findsOneWidget);
    expect(find.textContaining('sara@factory.com'), findsOneWidget);
    // الدور العربي من user_roles (جزء من سطر البريد/الدور).
    expect(find.textContaining('الدور: مدير النظام'), findsOneWidget);
    expect(find.textContaining('الدور: محاسب'), findsOneWidget);
    // شارات النشاط.
    expect(find.text('نشط'), findsOneWidget);
    expect(find.text('معطّل'), findsOneWidget);
    // أزرار الإجراءات.
    expect(find.widgetWithText(FilledButton, 'تغيير الدور'), findsNWidgets(2));
    expect(find.text('تنشيط'), findsOneWidget);
    // FAB.
    expect(find.widgetWithText(FloatingActionButton, 'مستخدم جديد'), findsOneWidget);
  });

  testWidgets('فراغ → AppEmptyView', (tester) async {
    await _pump(tester, UsersLoaded(const []));
    expect(find.byType(AppEmptyView), findsOneWidget);
    expect(find.text('لا يوجد مستخدمون'), findsOneWidget);
  });

  testWidgets('خطأ → AppErrorView بالرسالة', (tester) async {
    await _pump(tester, UsersError('ليس لديك صلاحية لتنفيذ هذا الإجراء'));
    expect(find.byType(AppErrorView), findsOneWidget);
    expect(find.text('ليس لديك صلاحية لتنفيذ هذا الإجراء'), findsOneWidget);
  });

  testWidgets('تعطيل مستخدم نشط → تأكيد ثم setUserActive(false)', (tester) async {
    final cubit = _TrackingUsersCubit(UsersLoaded(users));
    await _pump(tester, null, cubit: cubit);

    // تعطيل المستخدم النشط (u-1) — يتطلب تأكيدًا.
    await tester.tap(find.text('تعطيل'));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.tap(find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text('تعطيل'),
    ));
    await tester.pumpAndSettle();

    expect(cubit.setUserActiveCalls, [('u-1', false)]);
    expect(find.text('تم تعطيل المستخدم'), findsOneWidget);
  });

  testWidgets('تنشيط مستخدم معطل → setUserActive(true) بلا تأكيد',
      (tester) async {
    final cubit = _TrackingUsersCubit(UsersLoaded(users));
    await _pump(tester, null, cubit: cubit);

    await tester.tap(find.text('تنشيط'));
    await tester.pumpAndSettle();

    expect(cubit.setUserActiveCalls, [('u-2', true)]);
    expect(find.text('تم تنشيط المستخدم'), findsOneWidget);
  });

  testWidgets('تغيير الدور يفتح الحوار بالدور الحالي', (tester) async {
    final cubit = _TrackingUsersCubit(UsersLoaded(users));
    await _pump(tester, null, cubit: cubit);

    await tester.tap(find.widgetWithText(FilledButton, 'تغيير الدور').first);
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsOneWidget);
    expect(find.textContaining('الدور الحالي: مدير النظام'), findsOneWidget);
    expect(cubit.changeRoleCalls, isEmpty);
  });

  testWidgets('FAB يفتح حوار إنشاء مستخدم', (tester) async {
    final cubit = _TrackingUsersCubit(UsersLoaded(users));
    await _pump(tester, null, cubit: cubit);

    await tester.tap(find.widgetWithText(FloatingActionButton, 'مستخدم جديد'));
    await tester.pumpAndSettle();

    expect(find.text('مستخدم جديد'), findsAtLeast(1));
    expect(find.text('الاسم *'), findsOneWidget);
    expect(find.text('البريد الإلكتروني *'), findsOneWidget);
    expect(find.text('كلمة المرور *'), findsOneWidget);
    expect(cubit.createUserCalls, isEmpty);
  });
}

Future<void> _pump(
  WidgetTester tester,
  UsersState? state, {
  UsersCubit? cubit,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: UsersScreen(cubit: cubit ?? _StaticUsersCubit(state!)),
    ),
  );
  await tester.pump();
  await tester.pump();
}

/// cubit وهمي يصدر حالة واحدة (نمط المستودع).
class _StaticUsersCubit extends UsersCubit {
  _StaticUsersCubit(UsersState state) : super() {
    emit(state);
  }

  @override
  Future<void> fetchUsers() async {}
}

class _TrackingUsersCubit extends _StaticUsersCubit {
  _TrackingUsersCubit(super.state);

  final List<(String, bool)> setUserActiveCalls = <(String, bool)>[];
  final List<(String, String)> changeRoleCalls = <(String, String)>[];
  final List<Map<String, dynamic>> createUserCalls = <Map<String, dynamic>>[];

  @override
  Future<String?> setUserActive({
    required String userId,
    required bool active,
  }) async {
    setUserActiveCalls.add((userId, active));
    return null;
  }

  @override
  Future<String?> changeRole({
    required String userId,
    required String role,
  }) async {
    changeRoleCalls.add((userId, role));
    return null;
  }

  @override
  Future<String?> createUser({
    required String name,
    required String email,
    required String password,
    required String role,
  }) async {
    createUserCalls.add({
      'name': name,
      'email': email,
      'password': password,
      'role': role,
    });
    return null;
  }
}
