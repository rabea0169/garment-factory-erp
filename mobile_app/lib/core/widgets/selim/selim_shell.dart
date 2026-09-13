import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../features/auth/presentation/cubit/auth_cubit.dart';
import '../../constants/app_colors.dart';
import '../../router/app_router.dart';
import '../../security/route_access.dart';
import '../search/command_palette.dart';
import 'selim_more_sheet.dart';

/// الهيكل التكيفي الموحد — نسخة دارت من AppShell في Selim ERP.
///
/// **الجوال** (العرض < 1000): شريط سفلي بخمسة أقسام رئيسية + زر "المزيد"
/// يفتح درجًا بحثيًا بكل الأقسام (نفس BottomNav.tsx + درج "كل الأقسام").
/// **الديسكتوب** (العرض ≥ 1000): NavigationRail يمين الشاشة (RTL) بكل
/// الأقسام مباشرة + شريط علوي رقيق (نفس Sidebar.tsx الأيمن).
///
/// كل شاشات وحدات Selim الجديدة تُلف بهذا الهيكل عبر `SelimShellScaffold`
/// بدل Scaffold العادي — فتكتسب التنقل السفلي على الجوال والقضيب الجانبي
/// على الديسكتوب مجانًا مع بقاء محتواها هو المحور.
class SelimShellScaffold extends StatelessWidget implements PreferredSizeWidget {
  const SelimShellScaffold({
    super.key,
    required this.title,
    required this.body,
    this.fab,
    this.currentRoute,
    this.actions,
  });

  /// عنوان الشاشة في الـ AppBar.
  final String title;

  final Widget body;

  /// زر الإجراء العائم الخاص بالشاشة (فاتورة جديدة / تسوية جديدة...).
  final Widget? fab;

  /// المسار الحالي لتحديد التبويب النشط (يفترض من سياق الروتر).
  final String? currentRoute;

  /// أزرار إضافية في شريط التطبيق.
  final List<Widget>? actions;

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.sizeOf(context).width >= 1000;
    if (isWide) {
      return _WideShell(title: title, body: body, fab: fab, actions: actions);
    }
    return _MobileShell(title: title, body: body, fab: fab, actions: actions);
  }
}

/// عناصر القسم الرئيسية الخمسة (الجوال) — نفس ترتيب Selim:
/// لوحة التحكم · مبيعات · إنتاج · تقارير · مشتريات + المزيد.
List<SelimDestination> get _primaryDestinations => [
  SelimDestination('لوحة التحكم', Icons.dashboard_rounded, AppColors.primary, AppRouter.dashboard),
  SelimDestination('مبيعات', Icons.shopping_cart_rounded, const Color(0xFF00897B), AppRouter.sales),
  SelimDestination('إنتاج', Icons.precision_manufacturing_rounded, const Color(0xFFC62828), AppRouter.production),
  SelimDestination('تقارير', Icons.trending_up_rounded, const Color(0xFF1565C0), AppRouter.reports),
  SelimDestination('مشتريات', Icons.local_mall_rounded, const Color(0xFFF57F17), AppRouter.purchasing),
];

/// كل الأقسام (قضيب الديسكتوب) — مرآة درج "كل الأقسام" في الجوال.
List<SelimDestination> get allDestinations => [
  ..._primaryDestinations,
  SelimDestination('المخزون', Icons.inventory_2_rounded, const Color(0xFF7B1FA2), AppRouter.inventory),
  SelimDestination('عروض الأسعار', Icons.request_quote_rounded, const Color(0xFF3949AB), AppRouter.quotations),
  SelimDestination('مرتجع المشتريات', Icons.assignment_return_rounded, const Color(0xFFE65100), AppRouter.purchaseReturns),
  SelimDestination('تسويات الجرد', Icons.rule_rounded, const Color(0xFF00838F), AppRouter.adjustments),
  SelimDestination('القص والتعبئة', Icons.content_cut_rounded, const Color(0xFFAD1457), AppRouter.cutting),
  SelimDestination('الكتالوج', Icons.checkroom_rounded, const Color(0xFF5E35B1), AppRouter.products),
  SelimDestination('الخزينة', Icons.account_balance_wallet_rounded, const Color(0xFF00897B), AppRouter.treasury),
  SelimDestination('المصاريف', Icons.payments_rounded, const Color(0xFFC62828), AppRouter.expenses),
  SelimDestination('العمالة', Icons.people_rounded, const Color(0xFF6A1B9A), AppRouter.hr),
  SelimDestination('الورديات', Icons.schedule_rounded, const Color(0xFF00838F), AppRouter.shifts),
  SelimDestination('كشوف الرواتب', Icons.receipt_long_rounded, const Color(0xFF5D4037), AppRouter.payrollStatements),
  SelimDestination('الجودة', Icons.verified_rounded, const Color(0xFF2E7D32), AppRouter.quality),
  SelimDestination('الموردون', Icons.business_center_rounded, const Color(0xFF00695C), AppRouter.suppliers),
  SelimDestination('الشحن', Icons.local_shipping_rounded, const Color(0xFF00695C), AppRouter.shipping),
  SelimDestination('الحسابات', Icons.account_tree_rounded, const Color(0xFF0277BD), AppRouter.accounting),
  SelimDestination('التقارير المالية', Icons.assessment_rounded, const Color(0xFF1565C0), AppRouter.financialReports),
  SelimDestination('مركز الطباعة', Icons.print_rounded, const Color(0xFFE65100), AppRouter.printing),
  SelimDestination('المستخدمون', Icons.manage_accounts_rounded, const Color(0xFF37474F), AppRouter.users),
  // SELIM-ERP W2 — الموجة الثانية: نقطة البيع + الاستيراد + النسخ.
  SelimDestination('نقطة البيع', Icons.point_of_sale_rounded, const Color(0xFF00897B), AppRouter.pos),
  SelimDestination('معالج الاستيراد', Icons.upload_file_rounded, const Color(0xFF00838F), AppRouter.importWizard),
  SelimDestination('النسخ الاحتياطي', Icons.backup_rounded, const Color(0xFF455A64), AppRouter.backup),
];

class _MobileShell extends StatelessWidget {
  const _MobileShell({required this.title, required this.body, this.fab, this.actions});

  final String title;
  final Widget body;
  final Widget? fab;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    // maybeOf (لا of): شاشات تُختبر بلا GoRouter فوقها (widget tests تضخ
    // MaterialApp مباشرة) — بلا موجّه لا يُحدَّد تبويب نشط بدل الانهيار.
    final router = GoRouter.maybeOf(context);
    final location = router != null
        ? GoRouterState.of(context).matchedLocation
        : '';
    return CallbackShortcuts(
      // SELIM-ERP W2: Ctrl+K يفتح لوحة الأوامر (نفس CommandPalette في Selim).
      bindings: <ShortcutActivator, VoidCallback>{
        const SingleActivator(LogicalKeyboardKey.keyK, control: true):
            () => showCommandPalette(context),
      },
      child: Focus(
        autofocus: true,
        child: Scaffold(
          appBar: AppBar(
            title: Text(title, style: const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700)),
            centerTitle: true,
            actions: [
              IconButton(
                tooltip: 'بحث شامل (Ctrl+K)',
                icon: const Icon(Icons.search_rounded),
                onPressed: () => showCommandPalette(context),
              ),
              ...?actions,
            ],
          ),
            body: body,
            floatingActionButton: fab,
            // المساحة السفلية تحفظ بطاقة الشريط من فوق زر النظام في
            // الأجهزة الحديثة (safe-area) — مثل pb-[env(...)] في Selim.
            bottomNavigationBar: SafeArea(
              top: false,
              child: _SelimBottomNav(currentRoute: location),
            ),
          ),
        ),
      );
  }
}

class _SelimBottomNav extends StatelessWidget {
  const _SelimBottomNav({required this.currentRoute});

  final String currentRoute;

  @override
  Widget build(BuildContext context) {
    final role = _roleOf(context);
    final destinations =
        _primaryDestinations
            .where((d) => RouteAccess.canAccess(d.route, role))
            .toList();
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 10,
            offset: const Offset(0, -3),
          ),
        ],
      ),
      child: Row(
        children: [
          ...destinations.map((d) => _BottomTab(destination: d, currentRoute: currentRoute)),
          // زر "المزيد" — يفتح درج كل الأقسام.
          Expanded(child: _MoreButton(currentRoute: currentRoute)),
        ],
      ),
    );
  }
}

class _BottomTab extends StatelessWidget {
  const _BottomTab({required this.destination, required this.currentRoute});

  final SelimDestination destination;
  final String currentRoute;

  @override
  Widget build(BuildContext context) {
    final active = _isSameSection(currentRoute, destination.route);
    final color = active ? destination.color : Colors.grey.shade500;
    return Expanded(
      child: InkWell(
        onTap: () {
          // اهتزاز خفيف 8ms مثل سلوك Selim (vibrate 8ms) عند تبديل التبويب.
          HapticFeedback.selectionClick();
          context.go(destination.route);
        },
        child: Padding(
          padding: const EdgeInsetsDirectional.symmetric(vertical: 7),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                padding: const EdgeInsetsDirectional.symmetric(horizontal: 14, vertical: 4),
                decoration: BoxDecoration(
                  color: active ? destination.color : Colors.transparent,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  destination.icon,
                  size: 21,
                  color: active ? Colors.white : color,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                destination.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 10,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  color: color,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MoreButton extends StatelessWidget {
  const _MoreButton({required this.currentRoute});

  final String currentRoute;

  @override
  Widget build(BuildContext context) {
    // الزر يبدو نشطًا حين لا يكون أي قسم رئيسي هو الحالي.
    final inPrimary = _primaryDestinations.any(
      (d) => _isSameSection(currentRoute, d.route),
    );
    final color = inPrimary ? Colors.grey.shade500 : AppColors.primary;
    return InkWell(
      onTap: () {
        HapticFeedback.selectionClick();
        // الدور يُحل مسبقًا هنا (تحت شجرة المزود) ويمرر للدرج.
        showSelimMoreSheet(context, role: _roleOf(context));
      },
      child: Padding(
        padding: const EdgeInsetsDirectional.symmetric(vertical: 7),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              padding: const EdgeInsetsDirectional.symmetric(horizontal: 14, vertical: 4),
              decoration: BoxDecoration(
                color: inPrimary ? Colors.transparent : AppColors.primary,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(Icons.apps_rounded, size: 21, color: inPrimary ? color : Colors.white),
            ),
            const SizedBox(height: 3),
            Text(
              'المزيد',
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 10,
                fontWeight: inPrimary ? FontWeight.w500 : FontWeight.w700,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WideShell extends StatelessWidget {
  const _WideShell({required this.title, required this.body, this.fab, this.actions});

  final String title;
  final Widget body;
  final Widget? fab;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    // نفس حماية maybeOf في الهيكل الجوالي — الاختبارات بلا موجّه.
    final router = GoRouter.maybeOf(context);
    final location = router != null
        ? GoRouterState.of(context).matchedLocation
        : '';
    final role = _roleOf(context);
    final all = allDestinations.where((d) => RouteAccess.canAccess(d.route, role)).toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(title, style: const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700)),
        centerTitle: false,
        actions: [
          // SELIM-ERP W2: زر البحث الشامل — نفس Ctrl+K (لوحة الأوامر).
          IconButton(
            tooltip: 'بحث شامل (Ctrl+K)',
            icon: const Icon(Icons.search_rounded),
            onPressed: () => showCommandPalette(context),
          ),
          ...?actions,
        ],
      ),
      // RTL: القضيب الجانبي يظهر يمين الشاشة تلقائيًا في اتجاه عربي.
      body: Row(
        children: [
          NavigationRail(
            selectedIndex: _activeIndex(all, location),
            onDestinationSelected: (index) {
              HapticFeedback.selectionClick();
              context.go(all[index].route);
            },
            labelType: NavigationRailLabelType.all,
            leading: Padding(
              padding: const EdgeInsetsDirectional.only(top: 8, bottom: 12),
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [AppColors.primary, AppColors.primaryLight],
                  ),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.factory_rounded, color: Colors.white),
              ),
            ),
            groupAlignment: -1,
            destinations: all
                .map(
                  (d) => NavigationRailDestination(
                    icon: Icon(d.icon, color: Colors.grey.shade600),
                    selectedIcon: Icon(d.icon, color: d.color),
                    label: Text(
                      d.label,
                      style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
                    ),
                  ),
                )
                .toList(),
          ),
          const VerticalDivider(width: 1, thickness: 1),
          Expanded(child: body),
        ],
      ),
      floatingActionButton: fab,
    );
  }
}

int _activeIndex(List<SelimDestination> all, String location) {
  for (var i = 0; i < all.length; i++) {
    if (_isSameSection(location, all[i].route)) return i;
  }
  return 0;
}

/// القسم نفسه؟ المسار قد يحمل معاملات (`/cutting/:id`) فنقارن البادئة.
bool _isSameSection(String location, String section) {
  return location == section || location.startsWith('$section/');
}

String _roleOf(BuildContext context) {
  final authState = context.watch<AuthCubit>().state;
  if (authState is AuthAuthenticated) {
    return authState.user['role']?.toString() ?? '';
  }
  return '';
}

class SelimDestination {
  const SelimDestination(this.label, this.icon, this.color, this.route);
  final String label;
  final IconData icon;
  final Color color;
  final String route;
}
