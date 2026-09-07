import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/users/presentation/cubit/users_cubit.dart';
import 'package:garment_factory_erp/features/users/presentation/widgets/create_user_dialog.dart';

/// CC-9: حوار إنشاء مستخدم — تحقق الحقول، الأدوار الثمانية الفعلية،
/// وإرسال الوسائط الصحيحة إلى UsersCubit.createUser (الـ cubit يُمرَّر
/// عبر constructor).
void main() {
  testWidgets('حقول ناقصة → رسائل تحقق ولا استدعاء للـ cubit', (tester) async {
    final cubit = _FakeUsersCubit();
    await _pumpDialog(tester, cubit);

    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('الاسم مطلوب'), findsOneWidget);
    expect(find.text('البريد الإلكتروني مطلوب'), findsOneWidget);
    expect(find.text('كلمة المرور 8 أحرف على الأقل'), findsOneWidget);
    expect(cubit.createUserCalls, isEmpty);
  });

  testWidgets('بريد غير صالح → رسالة تحقق', (tester) async {
    final cubit = _FakeUsersCubit();
    await _pumpDialog(tester, cubit);

    await tester.enterText(
        find.widgetWithText(TextFormField, 'الاسم *'), 'سارة أحمد');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'البريد الإلكتروني *'), 'not-an-email');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'كلمة المرور *'), 'Pass@1234');
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('أدخل بريدًا إلكترونيًا صالحًا'), findsOneWidget);
    expect(cubit.createUserCalls, isEmpty);
  });

  testWidgets('الأدوار الثمانية الفعلية في القائمة المنسدلة', (tester) async {
    final cubit = _FakeUsersCubit();
    await _pumpDialog(tester, cubit);

    await tester.tap(find.text('مشاهد')); // القيمة الافتراضية VIEWER.
    await tester.pumpAndSettle();

    for (final label in [
      'مدير النظام',
      'مدير عام',
      'مدير الإنتاج',
      'مدير المخزون',
      'محاسب',
      'أمين صندوق',
      'مدير الموارد البشرية',
    ]) {
      expect(find.text(label), findsOneWidget);
    }
  });

  testWidgets('الحفظ الناجح → يمرر الوسائط ويغلق الحوار', (tester) async {
    final cubit = _FakeUsersCubit();
    await _pumpDialog(tester, cubit);

    await tester.enterText(
        find.widgetWithText(TextFormField, 'الاسم *'), 'سارة أحمد');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'البريد الإلكتروني *'), 'sara@factory.com');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'كلمة المرور *'), 'Pass@1234');

    // اختيار دور مختلف من القائمة.
    await tester.tap(find.text('مشاهد'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('محاسب').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();

    expect(cubit.createUserCalls, hasLength(1));
    final call = cubit.createUserCalls.single;
    expect(call['name'], 'سارة أحمد');
    expect(call['email'], 'sara@factory.com');
    expect(call['password'], 'Pass@1234');
    expect(call['role'], 'ACCOUNTANT');
  });

  testWidgets('خطأ من الخادم (بريد مكرر) → الحوار يبقى بالرسالة', (tester) async {
    final cubit = _FakeUsersCubit()
      ..createError = 'البريد الإلكتروني مستخدم بالفعل';
    await _pumpDialog(tester, cubit);

    await tester.enterText(
        find.widgetWithText(TextFormField, 'الاسم *'), 'سارة');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'البريد الإلكتروني *'), 'sara@factory.com');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'كلمة المرور *'), 'Pass@1234');
    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();

    expect(cubit.createUserCalls, hasLength(1));
    expect(find.text('البريد الإلكتروني مستخدم بالفعل'), findsOneWidget);
    expect(find.text('مستخدم جديد'), findsOneWidget);
  });
}

Future<void> _pumpDialog(WidgetTester tester, UsersCubit cubit) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: CreateUserDialog(cubit: cubit)),
    ),
  );
  await tester.pump();
}

class _FakeUsersCubit extends UsersCubit {
  final List<Map<String, dynamic>> createUserCalls = <Map<String, dynamic>>[];
  String? createError;

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
    return createError;
  }
}
