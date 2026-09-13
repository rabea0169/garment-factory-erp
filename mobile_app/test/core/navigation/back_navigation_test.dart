import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:garment_factory_erp/core/navigation/back_navigation.dart';

/// اختبارات سلوك «زر الرجوع» الموحد:
/// 1) الرجوع الفيزيائي (Android) من شاشة قسم وصلت عبر `go` → يعود إلى
///    لوحة التحكم بدل الخروج من التطبيق (BackGuard).
/// 2) الرجوع الفيزيائي من شاشة مفتوحة بـ `push` → يخرجها طبيعيًا
///    (تمرير حر — لا يعيد إلى لوحة التحكم).
/// 3) GfBackButton الظاهر: نفس السلوكين + السهم يتجه «للخلف» البصري
///    في RTL.
GoRouter _router({String initial = '/sales'}) => GoRouter(
  initialLocation: initial,
  routes: [
    GoRoute(
      path: '/dashboard',
      builder: (_, __) => const Scaffold(body: Text('dashboard')),
    ),
    GoRoute(
      path: '/sales',
      builder: (_, __) => BackGuard(
        child: Scaffold(body: Text('sales')),
      ),
    ),
    GoRoute(
      path: '/new',
      builder: (_, __) => BackGuard(
        child: Scaffold(body: Text('new-page')),
      ),
    ),
    GoRoute(
      path: '/back-btn',
      builder: (_, __) => BackGuard(
        child: Scaffold(appBar: AppBar(leading: GfBackButton())),
      ),
    ),
  ],
);

/// محاكاة زر الرجوع الفيزيائي في تطبيق مبني على Router (go_router):
/// منصة Android ترسل الرجوع إلى RootBackButtonDispatcher فيستدعي
/// RouterDelegate.popRoute — وهو الذي يستدعي maybePop على ملاح
/// go_router ويستشير PopScope. (didPopRoute على WidgetsApp لا يفعل
/// شيئًا في تطبيقات Router — درس من CI.)
Future<void> hardwareBack(WidgetTester tester, GoRouter router) async {
  await router.routerDelegate.popRoute();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'الرجوع الفيزيائي من شاشة وصلت عبر go يعود إلى لوحة التحكم',
    (tester) async {
      final router = _router(initial: '/sales');
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();
      expect(find.text('sales'), findsOneWidget);

      await hardwareBack(tester, router);
      expect(find.text('dashboard'), findsOneWidget);
    },
  );

  testWidgets(
    'الرجوع الفيزيائي من شاشة مفتوحة بـ push يخرجها طبيعيًا (تمرير حر)',
    (tester) async {
      final router = _router(initial: '/sales');
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      router.push('/new');
      await tester.pumpAndSettle();
      expect(find.text('new-page'), findsOneWidget);

      await hardwareBack(tester, router);
      // رجع إلى ما تحته (sales) — لا إلى لوحة التحكم: يثبت أنه pop حقيقي.
      expect(find.text('sales'), findsOneWidget);
    },
  );

  testWidgets(
    'GfBackButton في قاع المكدس يعود إلى لوحة التحكم',
    (tester) async {
      final router = _router(initial: '/back-btn');
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();
      expect(find.byType(GfBackButton), findsOneWidget);

      await tester.tap(find.byType(GfBackButton));
      await tester.pumpAndSettle();
      expect(find.text('dashboard'), findsOneWidget);
    },
  );

  testWidgets(
    'GfBackButton في شاشة مفتوحة بـ push يرجع خطوة واحدة',
    (tester) async {
      final router = _router(initial: '/sales');
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      router.push('/back-btn');
      await tester.pumpAndSettle();

      await tester.tap(find.byType(GfBackButton));
      await tester.pumpAndSettle();
      // رجع إلى sales التي تحته — لا إلى لوحة التحكم.
      expect(find.text('sales'), findsOneWidget);
    },
  );

  testWidgets('سهم GfBackButton يتجه للخلف البصري في RTL', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(appBar: AppBar(leading: GfBackButton())),
        ),
      ),
    );
    // RTL: «الخلف» جهة اليمين → arrow_forward (نفس سلوك BackButton التلقائي).
    expect(find.byIcon(Icons.arrow_forward_rounded), findsOneWidget);
  });

  testWidgets('سهم GfBackButton يتجه للخلف البصري في LTR', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Directionality(
          textDirection: TextDirection.ltr,
          child: Scaffold(appBar: AppBar(leading: GfBackButton())),
        ),
      ),
    );
    expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
  });
}
