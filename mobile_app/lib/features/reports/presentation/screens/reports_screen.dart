import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/reports_cubit.dart';
import '../cubit/reports_state.dart';

class ReportsScreen extends StatelessWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => ReportsCubit()..fetchDashboardStats(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('التقارير والإحصائيات'),
        ),
        body: BlocBuilder<ReportsCubit, ReportsState>(
          builder: (context, state) {
            if (state is ReportsLoading) {
              return const Center(child: CircularProgressIndicator());
            }
            if (state is ReportsLoaded) {
              final data = state.data;
              final sales = List<dynamic>.from(data['sales'] as List);
              final production =
                  List<dynamic>.from(data['production'] as List);
              final workers = List<dynamic>.from(data['topWorkers'] as List);
              final inventory = data['inventory'] as Map;
              return RefreshIndicator(
                onRefresh: () =>
                    context.read<ReportsCubit>().fetchDashboardStats(),
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _buildInventoryCards(inventory),
                    const SizedBox(height: 24),
                    _buildSectionTitle('المبيعات حسب الشهر (جنيه)'),
                    _buildSalesChart(sales),
                    const SizedBox(height: 28),
                    _buildSectionTitle('الإنتاج حسب اليوم (قطعة)'),
                    _buildProductionChart(production),
                    const SizedBox(height: 28),
                    _buildSectionTitle('أفضل العمال إنتاجاً في الفترة'),
                    _buildTopWorkers(workers),
                  ],
                ),
              );
            }
            if (state is ReportsError) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.cloud_off,
                          size: 48, color: AppColors.error),
                      const SizedBox(height: 12),
                      Text(
                        state.message,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontFamily: 'Cairo'),
                      ),
                      const SizedBox(height: 16),
                      OutlinedButton.icon(
                        onPressed: () =>
                            context.read<ReportsCubit>().fetchDashboardStats(),
                        icon: const Icon(Icons.refresh),
                        label: const Text('إعادة المحاولة'),
                      ),
                    ],
                  ),
                ),
              );
            }
            return const SizedBox.shrink();
          },
        ),
      ),
    );
  }

  Widget _buildInventoryCards(Map inventory) {
    return Row(
      children: [
        Expanded(
          child: _buildMetricCard(
            'الخامات',
            inventory['totalMaterials'],
            Icons.inventory_2_outlined,
            AppColors.primary,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _buildMetricCard(
            'نقص المخزون',
            inventory['lowStockMaterials'],
            Icons.warning_amber_outlined,
            AppColors.error,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _buildMetricCard(
            'منتج تام',
            inventory['totalFinishedGoodsTypes'],
            Icons.checkroom_outlined,
            AppColors.success,
          ),
        ),
      ],
    );
  }

  Widget _buildMetricCard(
    String label,
    dynamic value,
    IconData icon,
    Color color,
  ) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
        child: Column(
          children: [
            Icon(icon, color: color),
            const SizedBox(height: 6),
            Text(
              '${value is num ? value : 0}',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            Text(
              label,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 11, fontFamily: 'Cairo'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.bold,
          fontFamily: 'Cairo',
        ),
      ),
    );
  }

  Widget _buildSalesChart(List<dynamic> sales) {
    if (sales.isEmpty) return _emptyReport('لا توجد مبيعات في الفترة المحددة');
    return SizedBox(
      height: 250,
      child: BarChart(
        BarChartData(
          alignment: BarChartAlignment.spaceAround,
          borderData: FlBorderData(show: false),
          titlesData: FlTitlesData(
            show: true,
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                getTitlesWidget: (value, meta) {
                  final index = value.toInt();
                  if (index < 0 || index >= sales.length) {
                    return const SizedBox.shrink();
                  }
                  final period = sales[index]['period'] as String;
                  return Text(
                    period.substring(0, 7),
                    style: const TextStyle(fontSize: 10, fontFamily: 'Cairo'),
                  );
                },
              ),
            ),
            leftTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: true, reservedSize: 44),
            ),
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            rightTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
          ),
          barGroups: sales.asMap().entries.map((entry) {
            final amount = sales[entry.key]['amount'];
            return BarChartGroupData(
              x: entry.key,
              barRods: [
                BarChartRodData(
                  toY: amount is num ? amount.toDouble() : 0,
                  color: AppColors.primary,
                  width: 16,
                  borderRadius: BorderRadius.circular(4),
                ),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildProductionChart(List<dynamic> production) {
    if (production.isEmpty) return _emptyReport('لا يوجد إنتاج في الفترة المحددة');
    return SizedBox(
      height: 250,
      child: LineChart(
        LineChartData(
          gridData: const FlGridData(show: true),
          titlesData: FlTitlesData(
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                getTitlesWidget: (value, meta) {
                  final index = value.toInt();
                  if (index < 0 || index >= production.length) {
                    return const SizedBox.shrink();
                  }
                  final period = production[index]['period'] as String;
                  return Text(
                    period.substring(5),
                    style: const TextStyle(fontSize: 10, fontFamily: 'Cairo'),
                  );
                },
              ),
            ),
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            rightTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
          ),
          borderData: FlBorderData(show: true),
          lineBarsData: [
            LineChartBarData(
              spots: production.asMap().entries.map((entry) {
                final pieces = production[entry.key]['pieces'];
                return FlSpot(
                  entry.key.toDouble(),
                  pieces is num ? pieces.toDouble() : 0,
                );
              }).toList(),
              isCurved: true,
              color: AppColors.success,
              barWidth: 3,
              isStrokeCapRound: true,
              dotData: const FlDotData(show: true),
              belowBarData: BarAreaData(
                show: true,
                color: AppColors.success.withValues(alpha: 0.2),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTopWorkers(List<dynamic> workers) {
    if (workers.isEmpty) return _emptyReport('لا يوجد إنتاج عمال في الفترة المحددة');
    return Card(
      child: Column(
        children: workers.map((worker) {
          final name = worker['name'] as String;
          final pieces = worker['pieces'];
          return ListTile(
            leading: const CircleAvatar(
              child: Icon(Icons.star, color: Colors.amber),
            ),
            title: Text(name, style: const TextStyle(fontFamily: 'Cairo')),
            trailing: Text(
              '${pieces is num ? pieces : 0} قطعة',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                color: AppColors.primary,
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _emptyReport(String message) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(fontFamily: 'Cairo'),
        ),
      ),
    );
  }
}
