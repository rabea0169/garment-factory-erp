import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/router/app_router.dart';
import '../../auth/presentation/cubit/auth_cubit.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('لوحة التحكم'),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () {},
          ),
          IconButton(
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: () {},
          ),
        ],
      ),
      drawer: _buildDrawer(context),
      body: RefreshIndicator(
        onRefresh: () async => await Future.delayed(const Duration(seconds: 1)),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // مرحبًا
              _buildGreetingHeader(context),
              const SizedBox(height: 16),
              // KPI Cards
              _buildKpiGrid(context),
              const SizedBox(height: 24),
              // رسم بياني للإنتاج مقابل المبيعات
              _buildProductionChart(context),
              const SizedBox(height: 24),
              // آخر أوامر التشغيل
              _buildRecentWorkOrders(context),
              const SizedBox(height: 24),
              // تنبيهات المخزن المنخفض
              _buildLowStockAlerts(context),
              const SizedBox(height: 24),
              // الديون المتأخرة
              _buildOverdueDebts(context),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go(AppRouter.production),
        icon: const Icon(Icons.add),
        label: const Text('أمر تشغيل جديد', style: TextStyle(fontFamily: 'Cairo')),
      ),
    );
  }

  Widget _buildGreetingHeader(BuildContext context) {
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
                'السبت، 23 أغسطس 2026',
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
              Text('متصل', style: TextStyle(color: AppColors.success, fontFamily: 'Cairo', fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildKpiGrid(BuildContext context) {
    final kpis = [
      _KpiData('مبيعات اليوم', '١٢,٥٠٠ ج', Icons.trending_up, AppColors.success),
      _KpiData('الإنتاج اليوم', '٣٢٠ قطعة', Icons.precision_manufacturing, AppColors.primary),
      _KpiData('إجمالي الديون', '٨٥,٠٠٠ ج', Icons.account_balance_wallet, AppColors.warning),
      _KpiData('رصيد الخزينة', '٤٥,٢٠٠ ج', Icons.account_balance, AppColors.info),
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
                Text(kpi.title, style: Theme.of(context).textTheme.bodySmall),
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('الإنتاج مقابل المبيعات', style: Theme.of(context).textTheme.titleMedium),
                Row(
                  children: [
                    _legendItem('إنتاج', AppColors.primary),
                    const SizedBox(width: 12),
                    _legendItem('مبيعات', AppColors.secondary),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 160,
              child: LineChart(
                LineChartData(
                  gridData: FlGridData(
                    show: true,
                    drawVerticalLine: false,
                    horizontalInterval: 100,
                    getDrawingHorizontalLine: (value) => FlLine(
                      color: AppColors.divider,
                      strokeWidth: 1,
                    ),
                  ),
                  titlesData: FlTitlesData(
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        getTitlesWidget: (value, meta) {
                          final days = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];
                          return Text(
                            days[value.toInt() % 7],
                            style: const TextStyle(fontFamily: 'Cairo', fontSize: 10, color: AppColors.textSecondary),
                          );
                        },
                      ),
                    ),
                    leftTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        interval: 100,
                        getTitlesWidget: (value, meta) => Text(
                          '${value.toInt()}',
                          style: const TextStyle(fontFamily: 'Cairo', fontSize: 10, color: AppColors.textSecondary),
                        ),
                      ),
                    ),
                    rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  ),
                  borderData: FlBorderData(show: false),
                  lineBarsData: [
                    LineChartBarData(
                      spots: const [
                        FlSpot(0, 280), FlSpot(1, 310), FlSpot(2, 295),
                        FlSpot(3, 340), FlSpot(4, 320), FlSpot(5, 200), FlSpot(6, 320),
                      ],
                      isCurved: true,
                      color: AppColors.primary,
                      barWidth: 3,
                      belowBarData: BarAreaData(
                        show: true,
                        color: AppColors.primary.withValues(alpha: 0.1),
                      ),
                      dotData: const FlDotData(show: false),
                    ),
                    LineChartBarData(
                      spots: const [
                        FlSpot(0, 200), FlSpot(1, 250), FlSpot(2, 220),
                        FlSpot(3, 280), FlSpot(4, 260), FlSpot(5, 180), FlSpot(6, 260),
                      ],
                      isCurved: true,
                      color: AppColors.secondary,
                      barWidth: 3,
                      belowBarData: BarAreaData(
                        show: true,
                        color: AppColors.secondary.withValues(alpha: 0.1),
                      ),
                      dotData: const FlDotData(show: false),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _legendItem(String label, Color color) {
    return Row(
      children: [
        Container(width: 12, height: 3, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(fontFamily: 'Cairo', fontSize: 11, color: color)),
      ],
    );
  }

  Widget _buildRecentWorkOrders(BuildContext context) {
    final orders = [
      _WorkOrderData('WO-2026-089', 'تيشيرت قطني صيفي', '٥٠٠ قطعة', 'خياطة', AppColors.statusSewing),
      _WorkOrderData('WO-2026-088', 'بنطلون جينز', '٢٠٠ قطعة', 'قص', AppColors.statusCutting),
      _WorkOrderData('WO-2026-087', 'فستان كاجوال', '١٥٠ قطعة', 'تشطيب', AppColors.statusFinishing),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('آخر أوامر التشغيل', style: Theme.of(context).textTheme.titleMedium),
            TextButton(
              onPressed: () => context.go(AppRouter.production),
              child: const Text('عرض الكل', style: TextStyle(fontFamily: 'Cairo')),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ...orders.map((o) => _buildWorkOrderTile(context, o)),
      ],
    );
  }

  Widget _buildWorkOrderTile(BuildContext context, _WorkOrderData order) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Container(
          width: 44, height: 44,
          decoration: BoxDecoration(
            color: order.statusColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(Icons.precision_manufacturing, color: order.statusColor, size: 22),
        ),
        title: Text(order.productName, style: Theme.of(context).textTheme.titleSmall),
        subtitle: Text('${order.code} • ${order.quantity}', style: Theme.of(context).textTheme.bodySmall),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: order.statusColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(order.status, style: TextStyle(color: order.statusColor, fontFamily: 'Cairo', fontSize: 11, fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }

  Widget _buildLowStockAlerts(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.warning_amber_rounded, color: AppColors.warning, size: 20),
                const SizedBox(width: 8),
                Text('تنبيهات المخزن المنخفض', style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 12),
            _buildStockAlertRow(context, 'قماش قطني أبيض', '١٢ متر', '٥٠ متر'),
            const Divider(height: 16),
            _buildStockAlertRow(context, 'خيط بوليستر أسود', '٣ بكرة', '١٠ بكرة'),
            const Divider(height: 16),
            _buildStockAlertRow(context, 'زراير بلاستيك رقم ٢٤', '٥٠ حبة', '٢٠٠ حبة'),
          ],
        ),
      ),
    );
  }

  Widget _buildStockAlertRow(BuildContext context, String name, String current, String minimum) {
    return Row(
      children: [
        Expanded(child: Text(name, style: Theme.of(context).textTheme.bodyMedium)),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(current, style: const TextStyle(color: AppColors.error, fontFamily: 'Cairo', fontWeight: FontWeight.w600, fontSize: 13)),
            Text('الحد الأدنى: $minimum', style: Theme.of(context).textTheme.labelSmall),
          ],
        ),
      ],
    );
  }

  Widget _buildOverdueDebts(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('الديون المتأخرة', style: Theme.of(context).textTheme.titleMedium),
            TextButton(
              onPressed: () => context.go(AppRouter.sales),
              child: const Text('عرض الكل', style: TextStyle(fontFamily: 'Cairo')),
            ),
          ],
        ),
        const SizedBox(height: 8),
        _buildDebtCard(context, 'مجموعة النيل للتجارة', '١٥,٠٠٠ ج', '٥ أيام', AppColors.error),
        const SizedBox(height: 8),
        _buildDebtCard(context, 'شركة المحروسة', '٨,٥٠٠ ج', '٢ يوم', AppColors.warning),
      ],
    );
  }

  Widget _buildDebtCard(BuildContext context, String customer, String amount, String overdue, Color color) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: color.withValues(alpha: 0.12),
              child: Icon(Icons.business, color: color, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(customer, style: Theme.of(context).textTheme.titleSmall),
                  Text('متأخر منذ $overdue', style: TextStyle(color: color, fontFamily: 'Cairo', fontSize: 11)),
                ],
              ),
            ),
            Text(amount, style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700, fontSize: 15, color: color)),
          ],
        ),
      ),
    );
  }

  Widget _buildDrawer(BuildContext context) {
    final menuItems = [
      _MenuItem('لوحة التحكم', Icons.dashboard_rounded, AppRouter.dashboard),
      _MenuItem('المخزون', Icons.inventory_2_rounded, AppRouter.inventory),
      _MenuItem('الإنتاج', Icons.precision_manufacturing_rounded, AppRouter.production),
      _MenuItem('الجودة', Icons.verified_rounded, AppRouter.quality),
      _MenuItem('العمالة والأجور', Icons.people_rounded, AppRouter.hr),
      _MenuItem('المبيعات والمشتريات', Icons.receipt_long_rounded, AppRouter.sales),
      _MenuItem('الشحن والتوزيع', Icons.local_shipping_rounded, AppRouter.shipping),
      _MenuItem('الحسابات', Icons.account_tree_rounded, AppRouter.accounting),
      _MenuItem('التقارير والطباعة', Icons.bar_chart_rounded, AppRouter.reports),
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
                  child: Icon(Icons.factory_rounded, size: 32, color: AppColors.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'مدير المصنع',
                        style: TextStyle(color: Colors.white, fontFamily: 'Cairo', fontWeight: FontWeight.w700, fontSize: 16),
                      ),
                      const Text(
                        'admin@factory.com',
                        style: TextStyle(color: Colors.white70, fontFamily: 'Cairo', fontSize: 12),
                      ),
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Text(
                          'مدير عام',
                          style: TextStyle(color: Colors.white, fontFamily: 'Cairo', fontSize: 10),
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
                  leading: Icon(item.icon, color: AppColors.textSecondary, size: 22),
                  title: Text(item.title, style: const TextStyle(fontFamily: 'Cairo', fontSize: 14)),
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
            title: const Text('تسجيل الخروج', style: TextStyle(fontFamily: 'Cairo', color: AppColors.error, fontSize: 14)),
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

// Data Classes
class _KpiData {
  final String title;
  final String value;
  final IconData icon;
  final Color color;
  const _KpiData(this.title, this.value, this.icon, this.color);
}

class _WorkOrderData {
  final String code;
  final String productName;
  final String quantity;
  final String status;
  final Color statusColor;
  const _WorkOrderData(this.code, this.productName, this.quantity, this.status, this.statusColor);
}

class _MenuItem {
  final String title;
  final IconData icon;
  final String route;
  const _MenuItem(this.title, this.icon, this.route);
}
