import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/dashboard/presentation/screens/dashboard_screen.dart';
import '../../features/inventory/presentation/screens/inventory_screen.dart';
import '../../features/purchasing/presentation/screens/purchasing_screen.dart';
import '../../features/production/presentation/screens/production_screen.dart';
import '../../features/products/presentation/screens/products_screen.dart';
import '../../features/quality/presentation/screens/quality_screen.dart';
import '../../features/hr/presentation/screens/hr_screen.dart';
import '../../features/hr/payrolls/presentation/screens/payrolls_screen.dart';
import '../../features/hr/worker_activity/presentation/screens/worker_activity_screen.dart';
import '../../features/hr/worker_report/presentation/screens/worker_report_screen.dart';
import '../../features/sales/presentation/screens/sales_screen.dart';
import '../../features/suppliers/presentation/screens/suppliers_screen.dart';
import '../../features/shipping/presentation/screens/shipping_screen.dart';
import '../../features/accounting/presentation/screens/accounting_screen.dart';
import '../../features/reports/presentation/screens/reports_screen.dart';
import '../../features/users/presentation/screens/users_screen.dart';
// SELIM-ERP W1: شاشات الوحدات الجديدة المقلدة من Selim ERP.
import '../../features/quotations/presentation/screens/quotations_screen.dart';
import '../../features/quotations/presentation/screens/quotation_form_screen.dart';
import '../../features/purchase_returns/presentation/screens/purchase_returns_screen.dart';
import '../../features/inventory_adjustments/presentation/screens/inventory_adjustments_screen.dart';
import '../../features/expenses/presentation/screens/expenses_screen.dart';
import '../../features/treasury/presentation/screens/treasury_screen.dart';
import '../../features/shifts/presentation/screens/shifts_screen.dart';
import '../../features/worker_receipts/presentation/screens/worker_receipts_screen.dart';
import '../../features/payroll_statements/presentation/screens/payroll_statements_screen.dart';
import '../../features/cutting/presentation/screens/cutting_screen.dart';
import '../../features/financial_reports/presentation/screens/financial_reports_screen.dart';
import '../../features/printing/presentation/screens/printing_screen.dart';
// SELIM-ERP W2 — نقطة البيع + الاستيراد + النسخ الاحتياطي.
import '../../features/pos/presentation/screens/pos_screen.dart';
import '../../features/data_import/presentation/screens/import_screen.dart';
import '../../features/system/presentation/screens/backup_screen.dart';
import '../../features/system/presentation/screens/offline_queue_screen.dart';
import '../../features/system/presentation/screens/factory_settings_screen.dart';
import '../../features/system/presentation/screens/audit_logs_screen.dart';
import '../../features/system/presentation/screens/devices_screen.dart';
import '../../features/branches/presentation/screens/branches_screen.dart';
import '../../features/accounting/presentation/screens/cost_centers_screen.dart';
import '../../features/financial_reports/presentation/screens/party_statement_screen.dart';
import '../storage/auth_storage.dart';
import '../security/effective_permissions.dart';
import '../navigation/back_navigation.dart';

class AppRouter {
  AppRouter._();

  // Named Routes
  static const String login = '/login';
  static const String dashboard = '/dashboard';
  static const String inventory = '/inventory';
  static const String purchasing = '/purchasing';
  static const String products = '/products';
  static const String production = '/production';
  static const String quality = '/quality';
  static const String hr = '/hr';
  // MOB-8: شاشة حالة الرواتب + نشاط العامل (سلف/إنتاج).
  static const String hrPayrolls = '/hr/payrolls';
  static const String hrWorkerActivity = '/hr/workers';
  static const String hrWorkerReport = '/hr/workers/report';
  static const String sales = '/sales';
  static const String suppliers = '/suppliers';
  static const String shipping = '/shipping';
  static const String accounting = '/accounting';
  static const String reports = '/reports';
  // CC-9: إدارة المستخدمين (SUPER_ADMIN فقط خادميًا).
  static const String users = '/users';

  // SELIM-ERP W1: مسارات الوحدات المقلدة.
  static const String quotations = '/quotations';
  static const String purchaseReturns = '/purchase-returns';
  static const String adjustments = '/adjustments';
  static const String expenses = '/expenses';
  static const String treasury = '/treasury';
  static const String shifts = '/shifts';
  static const String workerReceipts = '/worker-receipts';
  static const String payrollStatements = '/payroll-statements';
  static const String cutting = '/cutting';
  static const String financialReports = '/financial-reports';
  static const String printing = '/printing';
  // SELIM-ERP W2 — مسارات الموجة الثانية.
  static const String pos = '/pos';
  static const String importWizard = '/import';
  static const String backup = '/backup';
  // SELIM-ERP W3 — مسارات الموجة الثالثة.
  static const String offlineQueue = '/offline-queue';
  static const String factorySettings = '/factory-settings';
  static const String auditLogs = '/audit-logs';
  static const String devices = '/devices';
  static const String costCenters = '/cost-centers';
  static const String branches = '/branches';
  static const String customerStatement = '/statement/customer';
  static const String supplierStatement = '/statement/supplier';

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
    // audit-FE2 P2: إيقاف ضوضاء التشخيص في نسخ release — كان مفعلاً دائمًا.
    debugLogDiagnostics: false,
    redirect: (context, state) async {
      final isLoginRoute = state.matchedLocation == login;
      String? token;
      try {
        token = await AuthStorage().readAccessToken();
      } catch (_) {
        token = null;
      }

      Map<String, dynamic>? user;
      try {
        user = await AuthStorage().readUser();
      } catch (_) {
        user = null;
      }

      final isAuthenticated = token?.isNotEmpty == true && user?['id'] != null;
      if (!isAuthenticated && !isLoginRoute) return login;
      if (isAuthenticated && isLoginRoute) return dashboard;

      // audit-FE (P0): حماية الوصول المباشر (deep-link) حسب الدور —
      // محاولة مستخدم بلاغٍ خاطئ دخول /users أو /accounting عبر URL
      // كان يعرض شاشة 403؛ الآن يُعاد توجيهه للوحة التحكم. الخادم يظل
      // خط الدفاع الأخير (fail-closed).
      // SELIM-ERP W4: الصلاحيات الصريحة (effectivePermissions من الجلسة)
      // تفتح مسارًا فشل فحص دورِه — نفس منطق الخادم (طبقة فوق الدور).
      if (isAuthenticated && !isLoginRoute) {
        if (!canAccessWithUser(state.matchedLocation, user)) {
          return dashboard;
        }
      }
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
        builder: (context, state) =>
            const BackGuard(child: InventoryScreen()),
      ),
      GoRoute(
        path: purchasing,
        name: 'purchasing',
        builder: (context, state) =>
            const BackGuard(child: PurchasingScreen()),
      ),
      GoRoute(
        path: products,
        name: 'products',
        builder: (context, state) =>
            const BackGuard(child: ProductsScreen()),
      ),
      GoRoute(
        path: quality,
        name: 'quality',
        builder: (context, state) =>
            const BackGuard(child: QualityScreen()),
      ),
      GoRoute(
        path: production,
        name: 'production',
        builder: (context, state) =>
            const BackGuard(child: ProductionScreen()),
      ),
      GoRoute(
        path: hr,
        name: 'hr',
        builder: (context, state) =>
            const BackGuard(child: HrScreen()),
      ),
      // MOB-8: كشوف الرواتب (GET /hr/payrolls) مع مرشح حالة.
      GoRoute(
        path: hrPayrolls,
        name: 'hrPayrolls',
        builder: (context, state) =>
            const BackGuard(child: PayrollsScreen()),
      ),
      // MOB-8: نشاط عامل — آخر السلف وآخر الإنتاج (GET /hr/advances |
      // /hr/production مع workerId).
      GoRoute(
        path: '$hrWorkerActivity/:workerId',
        name: 'hrWorkerActivity',
        builder: (context, state) => BackGuard(
          child: WorkerActivityScreen(
            workerId: state.pathParameters['workerId'] ?? '',
            workerName: state.uri.queryParameters['name'],
          ),
        ),
      ),
      // SELIM-ERP W5: تقرير العامل المجمّع بنطاق تاريخ
      // (GET /hr/workers/:id/report) — قيود الوصول من بادئة /hr/workers.
      GoRoute(
        path: '$hrWorkerReport/:workerId',
        name: 'hrWorkerReport',
        builder: (context, state) => BackGuard(
          child: WorkerReportScreen(
            workerId: state.pathParameters['workerId'] ?? '',
            workerName: state.uri.queryParameters['name'],
          ),
        ),
      ),
      GoRoute(
        path: sales,
        name: 'sales',
        builder: (context, state) =>
            const BackGuard(child: SalesScreen()),
      ),
      GoRoute(
        path: suppliers,
        name: 'suppliers',
        builder: (context, state) =>
            const BackGuard(child: SuppliersScreen()),
      ),
      GoRoute(
        path: shipping,
        name: 'shipping',
        builder: (context, state) =>
            const BackGuard(child: ShippingScreen()),
      ),
      GoRoute(
        path: accounting,
        name: 'accounting',
        builder: (context, state) =>
            const BackGuard(child: AccountingScreen()),
      ),
      GoRoute(
        path: reports,
        name: 'reports',
        builder: (context, state) =>
            const BackGuard(child: ReportsScreen()),
      ),
      // CC-9: إدارة المستخدمين — قائمة/إنشاء/دور/تعطيل/تنشيط.
      GoRoute(
        path: users,
        name: 'users',
        builder: (context, state) =>
            const BackGuard(child: UsersScreen()),
      ),
      // SELIM-ERP W1: مسارات الوحدات المقلدة من Selim ERP.
      GoRoute(
        path: quotations,
        name: 'quotations',
        builder: (context, state) =>
            const BackGuard(child: QuotationsScreen()),
        routes: [
          GoRoute(
            path: 'new',
            name: 'quotationNew',
            builder: (context, state) =>
                const BackGuard(child: QuotationFormScreen()),
          ),
        ],
      ),
      GoRoute(
        path: purchaseReturns,
        name: 'purchaseReturns',
        builder: (context, state) =>
            const BackGuard(child: PurchaseReturnsScreen()),
      ),
      GoRoute(
        path: adjustments,
        name: 'adjustments',
        builder: (context, state) =>
            const BackGuard(child: InventoryAdjustmentsScreen()),
      ),
      GoRoute(
        path: expenses,
        name: 'expenses',
        builder: (context, state) =>
            const BackGuard(child: ExpensesScreen()),
      ),
      GoRoute(
        path: treasury,
        name: 'treasury',
        builder: (context, state) =>
            const BackGuard(child: TreasuryScreen()),
      ),
      GoRoute(
        path: shifts,
        name: 'shifts',
        builder: (context, state) =>
            const BackGuard(child: ShiftsScreen()),
      ),
      GoRoute(
        path: workerReceipts,
        name: 'workerReceipts',
        builder: (context, state) =>
            const BackGuard(child: WorkerReceiptsScreen()),
      ),
      GoRoute(
        path: payrollStatements,
        name: 'payrollStatements',
        builder: (context, state) =>
            const BackGuard(child: PayrollStatementsScreen()),
      ),
      GoRoute(
        path: cutting,
        name: 'cutting',
        builder: (context, state) =>
            const BackGuard(child: CuttingScreen()),
      ),
      GoRoute(
        path: financialReports,
        name: 'financialReports',
        builder: (context, state) =>
            const BackGuard(child: FinancialReportsScreen()),
      ),
      GoRoute(
        path: printing,
        name: 'printing',
        builder: (context, state) =>
            const BackGuard(child: PrintingScreen()),
      ),
      // SELIM-ERP W2 — نقطة البيع (Cubit يُنشأ داخل الشاشة).
      GoRoute(
        path: pos,
        name: 'pos',
        builder: (context, state) =>
            const BackGuard(child: PosScreen()),
      ),
      GoRoute(
        path: importWizard,
        name: 'import',
        builder: (context, state) =>
            const BackGuard(child: ImportScreen()),
      ),
      GoRoute(
        path: backup,
        name: 'backup',
        builder: (context, state) =>
            const BackGuard(child: BackupScreen()),
      ),
      // SELIM-ERP W3 — مسارات الموجة الثالثة (كلها داخل BackGuard:
      // الرجوع يعود للوحة التحكم — نفس سلوك زر الرجوع الموحد).
      GoRoute(
        path: offlineQueue,
        name: 'offlineQueue',
        builder: (context, state) =>
            const BackGuard(child: OfflineQueueScreen()),
      ),
      GoRoute(
        path: factorySettings,
        name: 'factorySettings',
        builder: (context, state) =>
            const BackGuard(child: FactorySettingsScreen()),
      ),
      GoRoute(
        path: auditLogs,
        name: 'auditLogs',
        builder: (context, state) =>
            const BackGuard(child: AuditLogsScreen()),
      ),
      GoRoute(
        path: devices,
        name: 'devices',
        builder: (context, state) =>
            const BackGuard(child: DevicesScreen()),
      ),
      GoRoute(
        path: costCenters,
        name: 'costCenters',
        builder: (context, state) =>
            const BackGuard(child: CostCentersScreen()),
      ),
      GoRoute(
        path: branches,
        name: 'branches',
        builder: (context, state) =>
            const BackGuard(child: BranchesScreen()),
      ),
      GoRoute(
        path: '$customerStatement/:id',
        name: 'customerStatement',
        builder: (context, state) => BackGuard(
          child: PartyStatementScreen(
            partyId: state.pathParameters['id'] ?? '',
            isCustomer: true,
          ),
        ),
      ),
      GoRoute(
        path: '$supplierStatement/:id',
        name: 'supplierStatement',
        builder: (context, state) => BackGuard(
          child: PartyStatementScreen(
            partyId: state.pathParameters['id'] ?? '',
            isCustomer: false,
          ),
        ),
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
