import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:fl_chart/fl_chart.dart';
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
            } else if (state is ReportsLoaded) {
              final data = state.data;
              return SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _buildSectionTitle('المبيعات آخر 6 أشهر (جنيه)'),
                    _buildSalesChart(data['sales']),
                    const SizedBox(height: 32),
                    _buildSectionTitle('الإنتاج آخر 6 أيام (قطعة)'),
                    _buildProductionChart(data['production']),
                    const SizedBox(height: 32),
                    _buildSectionTitle('أفضل العمال إنتاجاً'),
                    _buildTopWorkers(data['topWorkers']),
                  ],
                ),
              );
            } else if (state is ReportsError) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.cloud_off, size: 48, color: AppColors.error),
                      const SizedBox(height: 12),
                      Text(
                        state.message,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontFamily: 'Cairo'),
                      ),
                      const SizedBox(height: 16),
                      OutlinedButton.icon(
                        onPressed: () => context.read<ReportsCubit>().fetchDashboardStats(),
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

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Text(
        title,
        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, fontFamily: 'Cairo'),
      ),
    );
  }

  Widget _buildSalesChart(List<dynamic> sales) {
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
                getTitlesWidget: (value, meta) => Text('شهر ${value.toInt() + 1}', style: const TextStyle(fontSize: 10, fontFamily: 'Cairo')),
              ),
            ),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(showTitles: true, reservedSize: 40),
            ),
            topTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          barGroups: sales.asMap().entries.map((e) {
            return BarChartGroupData(
              x: e.key,
              barRods: [
                BarChartRodData(
                  toY: e.value.toDouble(),
                  color: AppColors.primary,
                  width: 16,
                  borderRadius: BorderRadius.circular(4),
                )
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildProductionChart(List<dynamic> production) {
    return SizedBox(
      height: 250,
      child: LineChart(
        LineChartData(
          gridData: FlGridData(show: true),
          titlesData: FlTitlesData(
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                getTitlesWidget: (value, meta) => Text('يوم ${value.toInt() + 1}', style: const TextStyle(fontSize: 10, fontFamily: 'Cairo')),
              ),
            ),
            topTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          borderData: FlBorderData(show: true),
          lineBarsData: [
            LineChartBarData(
              spots: production.asMap().entries.map((e) => FlSpot(e.key.toDouble(), e.value.toDouble())).toList(),
              isCurved: true,
              color: AppColors.success,
              barWidth: 3,
              isStrokeCapRound: true,
              dotData: FlDotData(show: true),
              belowBarData: BarAreaData(show: true, color: AppColors.success.withValues(alpha: 0.2)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTopWorkers(List<dynamic> workers) {
    return Card(
      child: Column(
        children: workers.map((w) => ListTile(
          leading: const CircleAvatar(child: Icon(Icons.star, color: Colors.amber)),
          title: Text(w['name'], style: const TextStyle(fontFamily: 'Cairo')),
          trailing: Text('${w['pieces']} قطعة', style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primary)),
        )).toList(),
      ),
    );
  }
}