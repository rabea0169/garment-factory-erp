import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/dashboard/presentation/screens/dashboard_screen.dart';
import '../../features/inventory/presentation/screens/inventory_screen.dart';
import '../../features/production/presentation/screens/production_screen.dart';
import '../../features/quality/presentation/screens/quality_screen.dart';
import '../../features/hr/presentation/screens/hr_screen.dart';
import '../../features/sales/presentation/screens/sales_screen.dart';
import '../../features/shipping/presentation/screens/shipping_screen.dart';
import '../../features/accounting/presentation/screens/accounting_screen.dart';
import '../../features/reports/presentation/screens/reports_screen.dart';

class AppRouter {
  AppRouter._();

  static final _rootNavigatorKey = GlobalKey<NavigatorState>();

  // Named Routes
  static const String login = '/login';
  static const String dashboard = '/dashboard';
  static const String inventory = '/inventory';
  static const String production = '/production';
  static const String quality = '/quality';
  static const String hr = '/hr';
  static const String sales = '/sales';
  static const String shipping = '/shipping';
  static const String accounting = '/accounting';
  static const String reports = '/reports';

  static final router = GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: login,
    debugLogDiagnostics: true,
    routes: [
      GoRoute(
        path: login,
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: dashboard,
        name: 'dashboard',
        builder: (context, state) => const DashboardScreen(),
      ),
      GoRoute(
        path: inventory,
        name: 'inventory',
        builder: (context, state) => const InventoryScreen(),
      ),
      GoRoute(
        path: production,
        name: 'production',
        builder: (context, state) => const ProductionScreen(),
      ),
      GoRoute(
        path: quality,
        name: 'quality',
        builder: (context, state) => const QualityScreen(),
      ),
      GoRoute(
        path: hr,
        name: 'hr',
        builder: (context, state) => const HrScreen(),
      ),
      GoRoute(
        path: sales,
        name: 'sales',
        builder: (context, state) => const SalesScreen(),
      ),
      GoRoute(
        path: shipping,
        name: 'shipping',
        builder: (context, state) => const ShippingScreen(),
      ),
      GoRoute(
        path: accounting,
        name: 'accounting',
        builder: (context, state) => const AccountingScreen(),
      ),
      GoRoute(
        path: reports,
        name: 'reports',
        builder: (context, state) => const ReportsScreen(),
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Text(
          'الصفحة غير موجودة: ${state.uri}',
          style: const TextStyle(fontFamily: 'Cairo'),
        ),
      ),
    ),
  );
}
