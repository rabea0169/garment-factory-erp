import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/router/app_router.dart';
import '../../../auth/presentation/cubit/auth_cubit.dart';
import '../cubit/dashboard_cubit.dart';
import '../cubit/dashboard_state.dart';

/// لوحة التحكم — مؤشرات حقيقية من `GET /dashboard/stats`.
///
/// تمسح كل البيانات الـ hardcoded السابقة وتعرض:
/// - 4 بطاقات KPI من ملخص المخزون + إجمالي مبيعات الفترة.
/// - رسم بياني خطي للإنتاج اليومي الحقيقي.
/// - قائمة بأعلى 5 عمال إنتاجاً.
///
/// الحالات: Loading / Error / Empty / Loaded. لا توجد قيم ثابتة بأي شكل.
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider<DashboardCubit>(
      create: (_) => DashboardCubit()..fetchStats(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('لوحة التحكم'),
          // MOBILE-F03: أيقونات الإشعارات/الحساب معطّلة حتى تُنفّذ مساراتها.
        ),
        drawer: _buildDrawer(context),
        body: BlocBuilder<DashboardCubit, DashboardState>(
          builder: (context, state) {
            if (state is DashboardLoading || state is DashboardInitial) {
              return const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 12),
                    Text(
                      'جاري التحميل...',
                      style: TextStyle(fontFamily: 'Cairo'),
                    ),
                  ],
                ),
              );
            }
            if (state is DashboardError) {
              return _ErrorView(
                message: state.message,
                onRetry: () =>
                    context.read<DashboardCubit>().fetchStats(),
              );
            }
            if (state is DashboardEmpty) {
              return _EmptyView(
                onRetry: () =>
                    context.read<DashboardCubit>().fetchStats(),
              );
            }
            if (state is DashboardLoaded) {
              return _DashboardContent(stats: state.stats);
            }
            return const SizedBox.shrink();
          },
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => context.go(AppRouter.production),
          icon: const Icon(Icons.add),
          label: const Text(
            'أمر تشغيل جديد',
            style: TextStyle(fontFamily: 'Cairo'),
          ),
        ),
      ),
    );
  }

  Widget _buildDrawer(BuildContext context) {
    final menuItems = [
      _MenuItem('لوحة التحكم', Icons.dashboard_rounded, AppRouter.dashboard),
      _MenuItem('المخزون', Icons.inventory_2_rounded, AppRouter.inventory),
      _MenuItem('الإنتاج', Icons.precision_manufacturing_rounded,
          AppRouter.production),
      _MenuItem('الجودة', Icons.verified_rounded, AppRouter.quality),
      _MenuItem('العمالة والأجور', Icons.people_rounded, AppRouter.hr),
      _MenuItem('المبيعات والمشتريات', Icons.receipt_long_rounded,
          AppRouter.sales),
      _MenuItem('الشحن والتوزيع', Icons.local_shipping_rounded,
          AppRouter.shipping),
      _MenuItem('الحسابات', Icons.account_tree_rounded, AppRouter.accounting),
      _MenuItem('التقارير والطباعة', Icons.bar_chart_rounded,
          AppRouter.reports),
    ];

    return Drawer(
      child: Column(
        children: [
          DrawerHeader(
            decoration: const BoxDecoration(color: AppColors.primary),
            child: Row(
              children: [
                const CircleAvatar(
                  radius: 30,
                  backgroundColor: Colors.white,
                  child: Icon(Icons.factory_rounded,
                      size: 32, color: AppColors.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Text(
                        'مدير المصنع',
                        style: TextStyle(
                          color: Colors.white,
                          fontFamily: 'Cairo',
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                      Text(
                        'admin@factory.com',
                        style: TextStyle(
                          color: Colors.white70,
                          fontFamily: 'Cairo',
                          fontSize: 12,
                        ),
                      ),
                      SizedBox(height: 6),
                      _RoleBadge(),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: EdgeInsets.zero,
              itemCount: menuItems.length,
              itemBuilder: (context, index) {
                final item = menuItems[index];
                return ListTile(
                  leading: Icon(item.icon,
                      color: AppColors.textSecondary, size: 22),
                  title: Text(item.title,
                      style: const TextStyle(
                          fontFamily: 'Cairo', fontSize: 14)),
                  onTap: () {
                    Navigator.pop(context);
                    context.go(item.route);
                  },
                );
              },
            ),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout, color: AppColors.error),
            title: const Text(
              'تسجيل الخروج',
              style: TextStyle(
                  fontFamily: 'Cairo', color: AppColors.error, fontSize: 14),
            ),
            onTap: () async {
              await context.read<AuthCubit>().logout();
              if (context.mounted) context.go(AppRouter.login);
            },
          ),
          const SizedBox(height: 8),
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
            _buildKpiGrid(context),
            const SizedBox(height: 24),
            _buildProductionChart(context),
            const SizedBox(height: 24),
            _buildTopWorkers(context),
          ],
        ),
      ),
    );
  }

  Widget _buildGreetingHeader(BuildContext context) {
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
                'مرحباً، مدير المصنع 👋',
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
          padding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.success.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
                color: AppColors.success.withValues(alpha: 0.3)),
          ),
          child: const Row(
            children: [
              Icon(Icons.circle, size: 8, color: AppColors.success),
              SizedBox(width: 6),
              Text('متصل',
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
    final inventory =
        Map<String, dynamic>.from(stats['inventory'] as Map);
    final sales = List<dynamic>.from(stats['sales'] as List);
    // إجمالي مبيعات الفترة = مجموع حقول amount في السلسلة الشهرية.
    final totalSales = sales.fold<double>(
      0,
      (prev, item) =>
          prev + (((item as Map)['amount'] as num?)?.toDouble() ?? 0),
    );
    final totalMaterials =
        (inventory['totalMaterials'] as num?)?.toInt() ?? 0;
    final lowStock =
        (inventory['lowStockMaterials'] as num?)?.toInt() ?? 0;
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
      itemBuilder: (context, index) =>
          _buildKpiCard(context, kpis[index]),
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
    final production =
        List<dynamic>.from(stats['production'] as List);
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
                    final dayLabel = period.length >= 10
                        ? period.substring(8, 10)
                        : period;
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
              rightTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: false)),
              topTitles: const AxisTitles(
                  sideTitles: SideTitles(showTitles: false)),
            ),
            borderData: FlBorderData(show: false),
            lineBarsData: [
              LineChartBarData(
                spots: production.asMap().entries.map((entry) {
                  final pieces =
                      (entry.value as Map)['pieces'] as num;
                  return FlSpot(entry.key.toDouble(),
                      pieces.toDouble());
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

  Widget _buildTopWorkers(BuildContext context) {
    final workers =
        List<dynamic>.from(stats['topWorkers'] as List);
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
                    child:
                        Icon(Icons.star, color: Colors.amber),
                  ),
                  title: Text(name,
                      style: const TextStyle(fontFamily: 'Cairo')),
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

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 48, color: AppColors.error),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontFamily: 'Cairo'),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.inbox_outlined,
                size: 48, color: AppColors.textSecondary),
            const SizedBox(height: 12),
            const Text(
              'لا توجد بيانات',
              textAlign: TextAlign.center,
              style: TextStyle(fontFamily: 'Cairo'),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('إعادة التحميل'),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoleBadge extends StatelessWidget {
  const _RoleBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(10),
      ),
      child: const Text(
        'مدير عام',
        style: TextStyle(
            color: Colors.white, fontFamily: 'Cairo', fontSize: 10),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Data Classes.
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

class _MenuItem {
  final String title;
  final IconData icon;
  final String route;
  const _MenuItem(this.title, this.icon, this.route);
}
