import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/router/app_router.dart';
import '../../../auth/presentation/cubit/auth_cubit.dart';
import '../cubit/dashboard_cubit.dart';
import '../cubit/dashboard_state.dart';

/// MOBILE-F03: لوحة تحكم حقيقية — لا توجد بيانات hardcoded.
///
/// البيانات كلها تأتي من GET /dashboard/stats (backend DashboardController)
/// عبر [DashboardCubit]. أي فشل في الشبكة أو الخادم يظهر كحالة خطأ عربيًا
/// مع زر إعادة المحاولة، وحالة التحميل تُظهر مؤشر دوار + نص "جاري التحميل...".
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => DashboardCubit()..fetchStats(),
      child: Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(
            title: const Text('لوحة التحكم'),
            actions: [
              IconButton(
                tooltip: 'تحديث',
                icon: const Icon(Icons.refresh),
                onPressed: () => context.read<DashboardCubit>().fetchStats(),
              ),
            ],
          ),
          drawer: _buildDrawer(context),
          body: BlocBuilder<DashboardCubit, DashboardState>(
            builder: (context, state) {
              if (state is DashboardLoading || state is DashboardInitial) {
                return const _DashboardLoading();
              }
              if (state is DashboardError) {
                return _DashboardError(
                  message: state.message,
                  onRetry: () => context.read<DashboardCubit>().fetchStats(),
                );
              }
              if (state is DashboardEmpty) {
                return _DashboardEmpty(
                  onRetry: () => context.read<DashboardCubit>().fetchStats(),
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
      _MenuItem(
          'المبيعات والمشتريات', Icons.receipt_long_rounded, AppRouter.sales),
      _MenuItem(
          'الشحن والتوزيع', Icons.local_shipping_rounded, AppRouter.shipping),
      _MenuItem('الحسابات', Icons.account_tree_rounded, AppRouter.accounting),
      _MenuItem(
          'التقارير والطباعة', Icons.bar_chart_rounded, AppRouter.reports),
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
                    children: [
                      const Text(
                        'مدير المصنع',
                        style: TextStyle(
                            color: Colors.white,
                            fontFamily: 'Cairo',
                            fontWeight: FontWeight.w700,
                            fontSize: 16),
                      ),
                      const Text(
                        'admin@factory.com',
                        style: TextStyle(
                            color: Colors.white70,
                            fontFamily: 'Cairo',
                            fontSize: 12),
                      ),
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Text(
                          'مدير عام',
                          style: TextStyle(
                              color: Colors.white,
                              fontFamily: 'Cairo',
                              fontSize: 10),
                        ),
                      ),
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
                  leading:
                      Icon(item.icon, color: AppColors.textSecondary, size: 22),
                  title: Text(item.title,
                      style:
                          const TextStyle(fontFamily: 'Cairo', fontSize: 14)),
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
            title: const Text('تسجيل الخروج',
                style: TextStyle(
                    fontFamily: 'Cairo', color: AppColors.error, fontSize: 14)),
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

// ============================= Content =============================

class _DashboardContent extends StatelessWidget {
  const _DashboardContent({required this.stats});

  final DashboardStats stats;

  @override
  Widget build(BuildContext context) {
    // التاريخ يُنسَّق محليًا (اليوم الحالي للمستخدم) عربيًا عبر intl.
    final cubit = context.read<DashboardCubit>();
    final arabicDate = cubit.todayArabicDate;

    return RefreshIndicator(
      onRefresh: () => cubit.fetchStats(),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildGreetingHeader(context, arabicDate),
            const SizedBox(height: 16),
            _buildKpiGrid(context),
            const SizedBox(height: 24),
            _buildRecentTransactions(context),
            const SizedBox(height: 24),
            _buildQuickLinks(context),
          ],
        ),
      ),
    );
  }

  Widget _buildGreetingHeader(BuildContext context, String arabicDate) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'مرحباً، مدير المصنع',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(
                arabicDate,
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
    final kpis = <_KpiData>[
      _KpiData(
        'مبيعات اليوم',
        _formatCurrency(stats.salesToday),
        Icons.trending_up,
        AppColors.success,
      ),
      _KpiData(
        'قيمة المخزون',
        _formatCurrency(stats.inventoryValue),
        Icons.inventory_2,
        AppColors.primary,
      ),
      _KpiData(
        'أوامر تشغيل قيد التنفيذ',
        _formatInt(stats.pendingWorkOrders),
        Icons.precision_manufacturing,
        AppColors.warning,
      ),
      _KpiData(
        'رصيد الخزينة',
        _formatCurrency(stats.treasuryBalance),
        Icons.account_balance,
        AppColors.info,
      ),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: 1.5,
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
                  child: Text(
                    kpi.title,
                    style: Theme.of(context).textTheme.bodySmall,
                    overflow: TextOverflow.ellipsis,
                  ),
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
            const SizedBox(height: 4),
            Text(
              kpi.value,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: kpi.color,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRecentTransactions(BuildContext context) {
    final txs = stats.recentTransactions;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'آخر الحركات المالية',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (stats.lowStockMaterials > 0)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.warning.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '${_formatInt(stats.lowStockMaterials)} خام منخفض',
                  style: const TextStyle(
                    color: AppColors.warning,
                    fontFamily: 'Cairo',
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        if (txs.isEmpty)
          Card(
            child: ListTile(
              leading: const Icon(Icons.inbox, color: AppColors.textSecondary),
              title: const Text(
                'لا توجد حركات حديثة',
                style: TextStyle(fontFamily: 'Cairo'),
              ),
            ),
          )
        else
          ...txs.map((t) => _buildTransactionTile(context, t)),
      ],
    );
  }

  Widget _buildTransactionTile(BuildContext context, DashboardTransaction t) {
    final isReceipt = t.type == 'RECEIPT';
    final color = isReceipt ? AppColors.success : AppColors.error;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.12),
          child: Icon(
            isReceipt ? Icons.arrow_upward : Icons.arrow_downward,
            color: color,
          ),
        ),
        title: Text(
          t.description.isEmpty ? t.code : t.description,
          style: Theme.of(context).textTheme.titleSmall,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${t.code} • ${_formatDate(t.date)}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        trailing: Text(
          _formatCurrency(t.amount),
          style: TextStyle(
            fontFamily: 'Cairo',
            fontWeight: FontWeight.w700,
            fontSize: 14,
            color: color,
          ),
        ),
      ),
    );
  }

  Widget _buildQuickLinks(BuildContext context) {
    final links = [
      _QuickLink('المخزون', Icons.inventory_2_rounded, AppRouter.inventory),
      _QuickLink('الإنتاج', Icons.precision_manufacturing_rounded,
          AppRouter.production),
      _QuickLink('المبيعات', Icons.receipt_long_rounded, AppRouter.sales),
      _QuickLink('الحسابات', Icons.account_tree_rounded, AppRouter.accounting),
      _QuickLink('التقارير', Icons.bar_chart_rounded, AppRouter.reports),
      _QuickLink('الشحن', Icons.local_shipping_rounded, AppRouter.shipping),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('روابط سريعة', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: links
              .map((l) => ActionChip(
                    label: Text(l.title,
                        style: const TextStyle(fontFamily: 'Cairo')),
                    avatar: Icon(l.icon, size: 18, color: AppColors.primary),
                    onPressed: () => context.go(l.route),
                  ))
              .toList(),
        ),
      ],
    );
  }

  String _formatCurrency(num value) {
    try {
      final nf = NumberFormat.decimalPattern('ar');
      return '${nf.format(value)} ج';
    } catch (_) {
      return '$value ج';
    }
  }

  String _formatInt(num value) {
    try {
      final nf = NumberFormat.decimalPattern('ar');
      return nf.format(value);
    } catch (_) {
      return '$value';
    }
  }

  String _formatDate(String iso) {
    if (iso.isEmpty) return '';
    try {
      final dt = DateTime.parse(iso);
      return DateFormat.yMMMd('ar').format(dt);
    } catch (_) {
      return iso;
    }
  }
}

// ============================= Loading / Error / Empty =============================

class _DashboardLoading extends StatelessWidget {
  const _DashboardLoading();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 16),
          Text(
            'جاري التحميل...',
            style: TextStyle(fontFamily: 'Cairo'),
          ),
        ],
      ),
    );
  }
}

class _DashboardError extends StatelessWidget {
  const _DashboardError({required this.message, required this.onRetry});

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
            const Icon(Icons.cloud_off, size: 56, color: AppColors.error),
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
              label: const Text('إعادة المحاولة',
                  style: TextStyle(fontFamily: 'Cairo')),
            ),
          ],
        ),
      ),
    );
  }
}

class _DashboardEmpty extends StatelessWidget {
  const _DashboardEmpty({required this.onRetry});

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
                size: 56, color: AppColors.textSecondary),
            const SizedBox(height: 12),
            const Text(
              'لا توجد بيانات',
              textAlign: TextAlign.center,
              style: TextStyle(fontFamily: 'Cairo', fontSize: 16),
            ),
            const SizedBox(height: 8),
            const Text(
              'لم يتم تسجيل أي مبيعات أو حركات مالية بعد. سيتم عرض الإحصائيات فور توفّرها.',
              textAlign: TextAlign.center,
              style: TextStyle(
                  fontFamily: 'Cairo',
                  color: AppColors.textSecondary,
                  fontSize: 12),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('تحديث', style: TextStyle(fontFamily: 'Cairo')),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================= Data Classes =============================

class _KpiData {
  final String title;
  final String value;
  final IconData icon;
  final Color color;
  const _KpiData(this.title, this.value, this.icon, this.color);
}

class _QuickLink {
  final String title;
  final IconData icon;
  final String route;
  const _QuickLink(this.title, this.icon, this.route);
}

class _MenuItem {
  final String title;
  final IconData icon;
  final String route;
  const _MenuItem(this.title, this.icon, this.route);
}
