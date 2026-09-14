import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/widgets/app_feedback.dart';
import 'package:garment_factory_erp/features/auth/presentation/cubit/auth_cubit.dart';
import 'package:garment_factory_erp/features/auth/presentation/screens/login_screen.dart';

/// UI-REVAMP: اختبارات تحسينات الواجهة:
/// (1) شاشة الدخول — زر إظهار/إخفاء كلمة المرور يعمل فعليًا (تبديل
///     obscureText بالضغط) وترويسة العلامة التجارية تظهر.
/// (2) السكيلتون — يبني العدد المطلوب من بطاقات الهيكل.
/// تحمّل الهيكل الموحد بلا AuthCubit مغطى ضمنيًا: كل اختبارات الشاشات
/// المُرحّلة (sales/purchasing/shipping/suppliers/quality/accounting)
/// تبني SelimShellScaffold اليوم بلا مزود أعلاها — وتمر.

/// cubit مصدر ثابت الحالة — لا شبكة ولا تخزين.
class _StaticAuthCubit extends AuthCubit {
  _StaticAuthCubit(AuthState state) {
    emit(state);
  }
}

void main() {
  group('LoginScreen — UI-REVAMP', () {
    Future<void> pumpLogin(WidgetTester tester) async {
      final cubit = _StaticAuthCubit(AuthInitial());
      addTearDown(cubit.close);
      await tester.pumpWidget(
        MaterialApp(
          home: BlocProvider<AuthCubit>.value(
            value: cubit,
            child: const LoginScreen(),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('كلمة المرور مخفية افتراضيًا وزر العين يظهرها ويخفيها',
        (tester) async {
      await pumpLogin(tester);

      TextField passwordFieldAt(int index) => tester.widget<TextField>(
            find.byType(TextField).at(index),
          );

      // افتراضيًا: حقل كلمة المرور آمن (النقاط) — الحقل الثاني بعد البريد.
      expect(passwordFieldAt(1).obscureText, isTrue);

      // زر العين يبدّل الحالة إلى الظاهرة.
      await tester.tap(find.byIcon(Icons.visibility_outlined));
      await tester.pump();
      expect(passwordFieldAt(1).obscureText, isFalse);

      // ضغطة ثانية تعيد الإخفاء (الأيقونة معكوسة).
      await tester.tap(find.byIcon(Icons.visibility_off_outlined));
      await tester.pump();
      expect(passwordFieldAt(1).obscureText, isTrue);
    });

    testWidgets('ترويسة العلامة التجارية وتذييل الإصدار يظهران', (tester) async {
      await pumpLogin(tester);
      expect(find.byIcon(Icons.factory_rounded), findsOneWidget);
      expect(find.text('نظام إدارة المصنع'), findsNothing); // ليست نصًا خامًا
      expect(find.text('مرحباً بك في نظام إدارة المصنع'), findsOneWidget);
      expect(find.textContaining('إصدار 1.6'), findsOneWidget);
    });
  });

  group('AppSkeletonList — UI-REVAMP', () {
    testWidgets('يبني العدد المطلوب من بطاقات الهيكل', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: AppSkeletonList(itemCount: 4))),
      );
      await tester.pump();
      // كل بطاقة تحوي دائرة وسطرين هيكليين — 4 بطاقات = 12 صندوقًا.
      expect(
        find.descendant(
          of: find.byType(AppSkeletonList),
          matching: _skeletonBoxFinder,
        ),
        findsNWidgets(12),
      );
    });
  });
}

final _skeletonBoxFinder =
    find.byWidgetPredicate((w) => w.runtimeType.toString() == '_SkeletonBox');
