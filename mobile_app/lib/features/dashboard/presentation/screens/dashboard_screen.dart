import 'dart:async';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/services/device_registration_service.dart';
import '../../../../core/navigation/double_back_exit_guard.dart';
import '../../../../core/router/app_router.dart';
import '../../../../core/security/effective_permissions.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../../../auth/presentation/cubit/auth_cubit.dart';
import '../cubit/dashboard_cubit.dart';
import '../cubit/dashboard_state.dart';

/// لوحة التحكم — مؤشرات حقيقية من `GET /dashboard/stats`.
///
/// SELIM-ERP W1: هيكل الشاشة تحوّل من درج جانبي إلى الهيكل التكيفي
/// المقلود من Selim ERP (شريط سفلي بخمسة أقسام + درج "المزيد" على
/// الجوال / NavigationRail على الديسكتوب) + شبكة الإجراءات السريعة
/// نفس ترتيب Selim (فاتورة بيع / أمر تشغيل / عرض سعر / تسوية / مصروف
/// / التقارير). المحتوى يظل كما هو: 4 بطاقات KPI + رسم الإنتاج اليومي
/// + أعلى 5 عمال إنتاجاً.
///
/// الحالات: Loading / Error / Empty / Loaded. لا توجد قيم ثابتة بأي شكل.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _exitGuard = DoubleBackExitGuard();

  @override
  void initState() {
    super.initState();
    // SELIM-ERP W3: تسجيل الجهاز بعد الدخول (فشل صمت — تتبع تشغيلي).
    // catchError عند الاستدعاء: حتى لو أفلت خطأ (مثل Hive غير مهيأ في
    // بيئة اختبار) من المُسجّل رغم مصائد الداخل، لا يصبح مستقبلًا
    // غير معالج يفشل اختبارات الواجهة.
    unawaited(
      DeviceRegistrationService.instance
          .registerOnce()
          .catchError((_) => false),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        if (!_exitGuard.handleBack()) {
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(
              const SnackBar(
                content: Text('اضغط مرة أخرى للخروج من التطبيق'),
                duration: Duration(seconds: 2),
              ),
            );
          return;
        }
        SystemNavigator.pop();
      },
      child: BlocProvider<DashboardCubit>(
        create: (_) => DashboardCubit()..fetchStats(),
        child: BlocBuilder<DashboardCubit, DashboardState>(
          builder: (context, state) {
            return SelimShellScaffold(
              title: 'لوحة التحكم',
              // خروج من الشاشة نفسها — نفس موضع الإعدادات في Selim.
              actions: [_LogoutButton()],
              body: _stateBody(context, state),
              fab: FloatingActionButton.extended(
                onPressed: () => context.push(AppRouter.production),
                icon: const Icon(Icons.add),
                label: const Text(
                  'أمر تشغيل جديد',
                  style: TextStyle(fontFamily: 'Cairo'),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _stateBody(BuildContext context, DashboardState state) {
    if (state is DashboardLoading || state is DashboardInitial) {
      return const AppLoadingView();
    }
    if (state is DashboardForbidden) {
      // DSH-1: دور بلا صلاحية مؤشرات — شاشة ترحيب تفاعلية
      // بالتنقل السريع بدل شاشة خطأ (هبوط 5 من 8 أدوار).
      return const _DashboardWelcome();
    }
    if (state is DashboardError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<DashboardCubit>().fetchStats(),
      );
    }
    if (state is DashboardEmpty) {
      return AppEmptyView(
        title: 'لا توجد بيانات في الفترة المحددة',
        actionLabel: 'إعادة التحميل',
        onAction: () => context.read<DashboardCubit>().fetchStats(),
      );
    }
    if (state is DashboardLoaded) {
      // MOB-3: بيانات من الكاش (لا اتصال) — شارة وضوح أعلى
      // المحتوى مع استمرار عرض المؤشرات كاملة.
      return Column(
        children: [
          if (state.fromCache && state.cachedAt != null)
            AppCachedDataBanner(cachedAt: state.cachedAt!),
          Expanded(child: _DashboardContent(stats: state.stats)),
        ],
      );
    }
    return const SizedBox.shrink();
  }
}

/// زر تسجيل الخروج — كان آخر عنصر في الدرو القديم؛ الآن أيقونة أعلى
/// الشاشة (نفس موضع قائمة الإعدادات في Selim ERP).
class _LogoutButton extends StatelessWidget {
  const _LogoutButton();

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: const Icon(Icons.logout_rounded),
      tooltip: 'تسجيل الخروج',
      onPressed: () async {
        await context.read<AuthCubit>().logout();
        if (context.mounted) context.go(AppRouter.login);
      },
    );
  }
}

/// قراءة قيمة عرض نصية آمنة من خريطة المستخدم (مشتركة بين الشاشة
/// والمحتوى — كانت static على كلاس الولاية قبل إعادة الهيكلة).
String _displayValue(dynamic value, String fallback) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? fallback : text;
}

// ---------------------------------------------------------------------------
// شاشة الترحيب للأدوار بلا صلاحية مؤشرات (DSH-1) — تنقل سريع مفيد.
// ---------------------------------------------------------------------------

class _DashboardWelcome extends StatelessWidget {
  const _DashboardWelcome();

  static const _shortcuts = <(String, IconData, String)>[
    ('المخزون', Icons.inventory_2_rounded, AppRouter.inventory),
    ('الإنتاج', Icons.precision_manufacturing_rounded, AppRouter.production),
    ('الجودة', Icons.verified_rounded, AppRouter.quality),
    ('العمالة والأجور', Icons.people_rounded, AppRouter.hr),
    ('المبيعات', Icons.receipt_long_rounded, AppRouter.sales),
    ('المشتريات', Icons.add_business_rounded, AppRouter.purchasing),
    ('الشحن', Icons.local_shipping_rounded, AppRouter.shipping),
  ];

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Icon(Icons.waving_hand_rounded,
              size: 56, color: AppColors.primary),
          const SizedBox(height: 12),
          Text(
            'أهلًا بك 👋',
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontSize: 22, fontWeight: FontWeight.w700, fontFamily: 'Cairo'),
          ),
          const SizedBox(height: 8),
          const Text(
            'مؤشرات لوحة التحكم متاحة للمدير العام والمحاسبة.\nابدأ عملك مباشرة من الأقسام التالية:',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, color: Colors.black54),
          ),
          const SizedBox(height: 20),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            alignment: WrapAlignment.center,
            children: [
              for (final (label, icon, route) in _shortcuts)
                ActionChip(
                  avatar: Icon(icon, size: 20, color: AppColors.primary),
                  label: Text(label),
                  onPressed: () => context.push(route),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// المحتوى الرئيسي عند نجاح التحميل — كل الأرقام من state.stats.
// ---------------------------------------------------------------------------

class _DashboardContent extends StatelessWidget {
  const _DashboardContent({required this.stats});

  final Map<String, dynamic> stats;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () => context.read<DashboardCubit>().fetchStats(),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildGreetingHeader(context),
            const SizedBox(height: 16),
            _buildQuickActions(context),
            const SizedBox(height: 16),
            _buildKpiGrid(context),
            const SizedBox(height: 24),
            _buildProductionChart(context),
            const SizedBox(height: 24),
            _buildExpensesChart(context),
            const SizedBox(height: 24),
            _buildTopWorkers(context),
          ],
        ),
      ),
    );
  }

  /// الإجراءات السريعة — يقلد QuickActions في Selim ERP: شبكة 3 أعمدة
  /// بأزرار ملونة بنص وصفي. تصفية الأزرار حسب الدور عبر RouteAccess
  /// (نفس مرآة سياسات الخادم) فلا يظهر للمحاسب زر ينقله لشاشة ممنوعة.
  Widget _buildQuickActions(BuildContext context) {
    final authState = context.watch<AuthCubit>().state;
    final user = authState is AuthAuthenticated ? authState.user : null;
    final actions = <(String, String, IconData, Color, String)>[
      (
        'فاتورة مبيعات',
        'بيع جديد لعميل',
        Icons.receipt_long_rounded,
        const Color(0xFF00897B),
        AppRouter.sales,
      ),
      (
        'أمر تشغيل',
        'بدء إنتاج جديد',
        Icons.precision_manufacturing_rounded,
        const Color(0xFFC62828),
        AppRouter.production,
      ),
      (
        'عرض سعر',
        'عرض جديد لعميل محتمل',
        Icons.request_quote_rounded,
        const Color(0xFF3949AB),
        AppRouter.quotations,
      ),
      (
        'تسوية جرد',
        'مطابقة الرصيد الدفتري',
        Icons.rule_rounded,
        const Color(0xFF00838F),
        AppRouter.adjustments,
      ),
      (
        'مصروف',
        'تسجيل مصروف جديد',
        Icons.payments_rounded,
        const Color(0xFFEF5350),
        AppRouter.expenses,
      ),
      (
        'التقارير',
        'تقارير شاملة ومالية',
        Icons.bar_chart_rounded,
        AppColors.primary,
        AppRouter.reports,
      ),
    ].where((a) => canAccessWithUser(a.$5, user)).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'الإجراءات السريعة',
          style: TextStyle(
            fontFamily: 'Cairo',
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 10),
        GridView.count(
          crossAxisCount: MediaQuery.sizeOf(context).width > 700 ? 6 : 3,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.05,
          children: [
            for (final (label, description, icon, color, route) in actions)
              _QuickActionTile(
                label: label,
                description: description,
                icon: icon,
                color: color,
                onTap: () => context.push(route),
              ),
          ],
        ),
      ],
    );
  }

  Widget _buildGreetingHeader(BuildContext context) {
    final authState = context.watch<AuthCubit>().state;
    final user = authState is AuthAuthenticated
        ? authState.user
        : const <String, dynamic>{};
    final displayName = _displayValue(user['name'], 'المستخدم');
    // التاريخ يُحسب من DateTime.now() بصيغة عربية عبر intl.
    final now = DateTime.now();
    final dateText = DateFormat.yMMMd('ar').format(now);
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'مرحباً، $displayName 👋',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(
                dateText,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.success.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.success.withValues(alpha: 0.3)),
          ),
          child: const Row(
            children: [
              Icon(Icons.circle, size: 8, color: AppColors.success),
              SizedBox(width: 6),
              Text('الخادم استجاب',
                  style: TextStyle(
                      color: AppColors.success,
                      fontFamily: 'Cairo',
                      fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildKpiGrid(BuildContext context) {
    final inventory = Map<String, dynamic>.from(stats['inventory'] as Map);
    final sales = List<dynamic>.from(stats['sales'] as List);
    // إجمالي مبيعات الفترة = مجموع حقول amount في السلسلة الشهرية.
    final totalSales = sales.fold<double>(
      0,
      (prev, item) =>
          prev + (((item as Map)['amount'] as num?)?.toDouble() ?? 0),
    );
    final totalMaterials = (inventory['totalMaterials'] as num?)?.toInt() ?? 0;
    final lowStock = (inventory['lowStockMaterials'] as num?)?.toInt() ?? 0;
    final finishedGoods =
        (inventory['totalFinishedGoodsTypes'] as num?)?.toInt() ?? 0;

    final nf = NumberFormat.decimalPattern('ar');
    final kpis = [
      _KpiData(
        title: 'إجمالي الخامات',
        value: nf.format(totalMaterials),
        icon: Icons.inventory_2_outlined,
        color: AppColors.primary,
      ),
      _KpiData(
        title: 'نقص المخزون',
        value: nf.format(lowStock),
        icon: Icons.warning_amber_outlined,
        color: AppColors.error,
      ),
      _KpiData(
        title: 'أنواع المنتج التام',
        value: nf.format(finishedGoods),
        icon: Icons.checkroom_outlined,
        color: AppColors.success,
      ),
      _KpiData(
        title: 'مبيعات الفترة (ج)',
        value: nf.format(totalSales.round()),
        icon: Icons.trending_up,
        color: AppColors.secondary,
      ),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: 1.6,
      ),
      itemCount: kpis.length,
      itemBuilder: (context, index) => _buildKpiCard(context, kpis[index]),
    );
  }

  Widget _buildKpiCard(BuildContext context, _KpiData kpi) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Text(kpi.title,
                      style: Theme.of(context).textTheme.bodySmall),
                ),
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: kpi.color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(kpi.icon, size: 18, color: kpi.color),
                ),
              ],
            ),
            Text(
              kpi.value,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: kpi.color,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProductionChart(BuildContext context) {
    final production = List<dynamic>.from(stats['production'] as List);
    if (production.isEmpty) {
      return _sectionCard(
        context,
        title: 'الإنتاج اليومي',
        child: const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Text(
            'لا يوجد إنتاج في الفترة المحددة',
            textAlign: TextAlign.center,
            style: TextStyle(fontFamily: 'Cairo'),
          ),
        ),
      );
    }

    final nf = NumberFormat.decimalPattern('ar');
    double piecesValue(dynamic item) {
      if (item is! Map) return 0;
      final pieces = item['pieces'];
      return pieces is num ? pieces.toDouble() : 0;
    }

    final maxYValue = production.fold<double>(
      0,
      (prev, item) {
        final v = piecesValue(item);
        return prev > v ? prev : v;
      },
    );
    final maxY = (maxYValue * 1.2).ceil().clamp(1, double.infinity);
    final interval = maxY >= 4 ? maxY / 4 : 1.0;

    return _sectionCard(
      context,
      title: 'الإنتاج اليومي (قطعة)',
      child: SizedBox(
        height: 180,
        child: LineChart(
          LineChartData(
            gridData: FlGridData(
              show: true,
              drawVerticalLine: false,
              horizontalInterval: interval == 0 ? 1 : interval,
              getDrawingHorizontalLine: (value) => FlLine(
                color: AppColors.divider,
                strokeWidth: 1,
              ),
            ),
            titlesData: FlTitlesData(
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  interval: 1,
                  getTitlesWidget: (value, meta) {
                    final index = value.toInt();
                    if (index < 0 || index >= production.length) {
                      return const SizedBox.shrink();
                    }
                    final period =
                        (production[index] as Map)['period'] as String;
                    // period بصيغة YYYY-MM-DD — نأخذ الجزء اليومي فقط.
                    final dayLabel =
                        period.length >= 10 ? period.substring(8, 10) : period;
                    return Text(
                      nf.format(int.tryParse(dayLabel) ?? 0),
                      style: const TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 10,
                          color: AppColors.textSecondary),
                    );
                  },
                ),
              ),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  interval: interval == 0 ? 1 : interval,
                  getTitlesWidget: (value, meta) => Text(
                    nf.format(value.toInt()),
                    style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 10,
                        color: AppColors.textSecondary),
                  ),
                ),
              ),
              rightTitles:
                  const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              topTitles:
                  const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            ),
            borderData: FlBorderData(show: false),
            lineBarsData: [
              LineChartBarData(
                spots: production.asMap().entries.map((entry) {
                  final pieces = (entry.value as Map)['pieces'] as num;
                  return FlSpot(entry.key.toDouble(), pieces.toDouble());
                }).toList(),
                isCurved: true,
                color: AppColors.primary,
                barWidth: 3,
                belowBarData: BarAreaData(
                  show: true,
                  color: AppColors.primary.withValues(alpha: 0.1),
                ),
                dotData: const FlDotData(show: false),
              ),
            ],
            minY: 0,
            maxY: maxY == 0 ? 1 : maxY.toDouble(),
          ),
        ),
      ),
    );
  }

  /// SELIM-ERP W3: مصاريف الفترة حسب البند (دائري — مرآة
  /// expensesByCategory في /api/dashboard/charts عند Selim).
  Widget _buildExpensesChart(BuildContext context) {
    final raw = stats['expensesByCategory'];
    final categories = <(String, double)>[];
    if (raw is List) {
      for (final row in raw) {
        if (row is Map) {
          final label = row['category']?.toString() ?? 'غير مصنف';
          final amount = double.tryParse(
                row['amount']?.toString() ?? '0',
              ) ??
              0;
          if (amount > 0) categories.add((label, amount));
        }
      }
    }
    if (categories.isEmpty) {
      return const SizedBox.shrink();
    }
    final total = categories.fold<double>(0, (sum, c) => sum + c.$2);
    const palette = <Color>[
      Color(0xFF00897B),
      Color(0xFF3949AB),
      Color(0xFFC62828),
      Color(0xFFEF6C00),
      Color(0xFF6D4C41),
      Color(0xFF00838F),
    ];
    return _sectionCard(
      context,
      title: 'توزيع المصاريف حسب البند',
      child: SizedBox(
        height: 220,
        child: Row(
          children: [
            Expanded(
              child: PieChart(
                PieChartData(
                  sectionsSpace: 2,
                  centerSpaceRadius: 40,
                  sections: [
                    for (var i = 0; i < categories.length && i < 6; i++)
                      PieChartSectionData(
                        value: categories[i].$2,
                        color: palette[i % palette.length],
                        radius: 46,
                        title:
                            '${(categories[i].$2 / total * 100).round()}%',
                        titleStyle: const TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 11,
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var i = 0; i < categories.length && i < 6; i++)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              color: palette[i % palette.length],
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              categories[i].$1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'Cairo',
                                fontSize: 12,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTopWorkers(BuildContext context) {
    final workers = List<dynamic>.from(stats['topWorkers'] as List);
    final nf = NumberFormat.decimalPattern('ar');

    return _sectionCard(
      context,
      title: 'أفضل العمال إنتاجاً',
      child: workers.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'لا يوجد إنتاج عمال في الفترة المحددة',
                textAlign: TextAlign.center,
                style: TextStyle(fontFamily: 'Cairo'),
              ),
            )
          : Column(
              children: workers.map((w) {
                final name = (w as Map)['name'] as String? ?? '';
                final pieces = (w['pieces'] as num?)?.toInt() ?? 0;
                return ListTile(
                  leading: const CircleAvatar(
                    child: Icon(Icons.star, color: Colors.amber),
                  ),
                  title:
                      Text(name, style: const TextStyle(fontFamily: 'Cairo')),
                  trailing: Text(
                    '${nf.format(pieces)} قطعة',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: AppColors.primary,
                      fontFamily: 'Cairo',
                    ),
                  ),
                );
              }).toList(),
            ),
    );
  }

  Widget _sectionCard(
    BuildContext context, {
    required String title,
    required Widget child,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// مشاهد الحالات الخاصة (Error / Empty).
// ---------------------------------------------------------------------------

class _KpiData {
  final String title;
  final String value;
  final IconData icon;
  final Color color;
  const _KpiData({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });
}

/// ب tileSize إجراء سريع — أيقونة داخل مربع ملون + نص + وصف صغير
/// (نفس شكل أزرار QuickActions في Selim ERP).
class _QuickActionTile extends StatelessWidget {
  const _QuickActionTile({
    required this.label,
    required this.description,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  final String label;
  final String description;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsetsDirectional.all(8),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsetsDirectional.all(8),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: Colors.black87,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                description,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 9.5,
                  color: Colors.grey.shade600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
