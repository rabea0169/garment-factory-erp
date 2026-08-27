import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

void main() {
  testWidgets('a pushed module route returns to the dashboard on back', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: '/dashboard',
      routes: [
        GoRoute(
          path: '/dashboard',
          builder: (_, __) => const Scaffold(body: Text('dashboard')),
        ),
        GoRoute(
          path: '/sales',
          builder: (_, __) => const Scaffold(body: Text('sales')),
        ),
      ],
    );

    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    expect(find.text('dashboard'), findsOneWidget);

    router.push('/sales');
    await tester.pumpAndSettle();
    expect(find.text('sales'), findsOneWidget);

    router.pop();
    await tester.pumpAndSettle();
    expect(find.text('dashboard'), findsOneWidget);
  });
}
