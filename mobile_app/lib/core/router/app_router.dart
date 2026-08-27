import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/dashboard/presentation/screens/dashboard_screen.dart';
import '../../features/inventory/presentation/screens/inventory_screen.dart';
import '../../features/production/presentation/screens/production_screen.dart';
import '../../features/products/presentation/screens/products_screen.dart';
import '../../features/quality/presentation/screens/quality_screen.dart';
import '../../features/hr/presentation/screens/hr_screen.dart';
import '../../features/sales/presentation/screens/sales_screen.dart';
import '../../features/suppliers/presentation/screens/suppliers_screen.dart';
import '../../features/shipping/presentation/screens/shipping_screen.dart';
import '../../features/accounting/presentation/screens/accounting_screen.dart';
import '../../features/reports/presentation/screens/reports_screen.dart';
import '../storage/auth_storage.dart';

class AppRouter {
  AppRouter._();

  // Named Routes
  static const String login = '/login';
  static const String dashboard = '/dashboard';
  static const String inventory = '/inventory';
  static const String production = '/production';
  static const String quality = '/quality';
  static const String hr = '/hr';
  static const String sales = '/sales';
  static const String suppliers = '/suppliers';
  static const String shipping = '/shipping';
  static const String accounting = '/accounting';
  static const String reports = '/reports';

  static final _rootNavigatorKey = GlobalKey<NavigatorState>();
  static String _initialLocation = login;

  /// يضبط أول مسار قبل أول استعمال لـ router في main.dart.
  static void configureInitialLocation({required bool isAuthenticated}) {
    _initialLocation = isAuthenticated ? dashboard : login;
  }

  /// يستدعى من ApiClient بعد مسح الجلسة عند وصول 401.
  static void goToLogin() {
    router.go(login);
  }

  static final router = GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: _initialLocation,
    debugLogDiagnostics: true,
    redirect: (context, state) async {
      final isLoginRoute = state.matchedLocation == login;
      String? token;
      try {
        token = await AuthStorage().readAccessToken();
      } catch (_) {
        token = null;
      }

      final isAuthenticated = token?.isNotEmpty == true;
      if (!isAuthenticated && !isLoginRoute) return login;
      if (isAuthenticated && isLoginRoute) return dashboard;
      return null;
    },
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
        path: '/products',
        builder: (context, state) => const ProductsScreen(),
      ),
      GoRoute(
        path: quality,
        name: 'quality',
        builder: (context, state) => const QualityScreen(),
      ),
      GoRoute(
        path: production,
        name: 'production',
        builder: (context, state) => const ProductionScreen(),
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
        path: suppliers,
        name: 'suppliers',
        builder: (context, state) => const SuppliersScreen(),
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
