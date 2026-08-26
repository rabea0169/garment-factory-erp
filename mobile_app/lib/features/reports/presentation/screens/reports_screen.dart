import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/reports_cubit.dart';
import '../cubit/reports_state.dart';

/// MOBILE-F04/F05: شاشة التقارير الإحصائية — تستهلك نفس endpoint
/// `/dashboard/stats` المُستخدَم في لوحة التحكم.
///
/// ملاحظات:
/// - حالة التحميل: مؤشر دوار + نص "جاري التحميل...".
/// - حالة الخطأ: أيقونة + الرسالة العربية من `messageFor` (تتضمن حالة 404 ودودة)
///   + زر "إعادة المحاولة".
/// - حالة الفراغ: "لا توجد بيانات" مع زر تحديث.
/// - كل قسم (مبيعات/إنتاج/عمال) يعرض نصًا بديلاً عند غياب بياناته فقط،
///   بدلاً من إخفاء الشاشة بالكامل.
class ReportsScreen extends StatelessWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => ReportsCubit()..fetchDashboardStats(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('التقارير والإحصائيات'),
          actions: [
            Builder(
              builder: (innerContext) => IconButton(
                tooltip: 'تحديث',
                icon: const Icon(Icons.refresh),
                onPressed: () =>
                    innerContext.read<ReportsCubit>().fetchDashboardStats(),
              ),
            ),
          ],
        ),
        body: BlocBuilder<ReportsCubit, ReportsState>(
          builder: (context, state) {
            if (state is ReportsLoading) {
              return const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 16),
                    Text('جاري التحميل...',
                        style: TextStyle(fontFamily: 'Cairo')),
                  ],
                ),
              );
            } else if (state is ReportsLoaded) {
              final data = state.data;
              final sales = _asList(data['sales']);
              final production = _asList(data['production']);
              final topWorkers = _asList(data['topWorkers']);
              if (sales.isEmpty && production.isEmpty && topWorkers.isEmpty) {
                return _EmptyState(
                  onRetry: () =>
                      context.read<ReportsCubit>().fetchDashboardStats(),
                );
              }
              return RefreshIndicator(
                onRefresh: () =>
                    context.read<ReportsCubit>().fetchDashboardStats(),
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (sales.isNotEmpty) ...[
                        _buildSectionTitle('المبيعات آخر 6 أشهر (جنيه)'),
                        _buildSalesChart(sales),
                        const SizedBox(height: 32),
                      ],
                      if (production.isNotEmpty) ...[
                        _buildSectionTitle('الإنتاج آخر 6 أيام (قطعة)'),
                        _buildProductionChart(production),
                        const SizedBox(height: 32),
                      ],
                      if (topWorkers.isNotEmpty) ...[
                        _buildSectionTitle('أفضل العمال إنتاجاً'),
                        _buildTopWorkers(topWorkers),
                      ],
                    ],
                  ),
                ),
              );
            } else if (state is ReportsError) {
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

  List<dynamic> _asList(Object? value) {
    if (value is List) return value;
    return const <dynamic>[];
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Text(
        title,
        style: const TextStyle(
            fontSize: 18, fontWeight: FontWeight.bold, fontFamily: 'Cairo'),
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
                getTitlesWidget: (value, meta) => Text(
                    'شهر ${value.toInt() + 1}',
                    style: const TextStyle(fontSize: 10, fontFamily: 'Cairo')),
              ),
            ),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(showTitles: true, reservedSize: 40),
            ),
            topTitles:
                const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles:
                const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          barGroups: sales.asMap().entries.map((e) {
            return BarChartGroupData(
              x: e.key,
              barRods: [
                BarChartRodData(
                  toY: (e.value is num ? (e.value as num).toDouble() : 0.0),
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
          gridData: const FlGridData(show: true),
          titlesData: FlTitlesData(
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                getTitlesWidget: (value, meta) => Text(
                    'يوم ${value.toInt() + 1}',
                    style: const TextStyle(fontSize: 10, fontFamily: 'Cairo')),
              ),
            ),
            topTitles:
                const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles:
                const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          borderData: FlBorderData(show: true),
          lineBarsData: [
            LineChartBarData(
              spots: production.asMap().entries.map((e) {
                final v = e.value is num ? (e.value as num).toDouble() : 0.0;
                return FlSpot(e.key.toDouble(), v);
              }).toList(),
              isCurved: true,
              color: AppColors.success,
              barWidth: 3,
              isStrokeCapRound: true,
              dotData: const FlDotData(show: true),
              belowBarData: BarAreaData(
                  show: true, color: AppColors.success.withValues(alpha: 0.2)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTopWorkers(List<dynamic> workers) {
    return Card(
      child: Column(
        children: workers.map((w) {
          final m =
              w is Map ? Map<String, dynamic>.from(w) : <String, dynamic>{};
          final name = (m['name'] ?? '—').toString();
          final pieces = m['pieces'];
          final piecesStr = pieces is num ? pieces.toString() : '0';
          return ListTile(
            leading: const CircleAvatar(
                child: Icon(Icons.star, color: Colors.amber)),
            title: Text(name, style: const TextStyle(fontFamily: 'Cairo')),
            trailing: Text('$piecesStr قطعة',
                style: const TextStyle(
                    fontWeight: FontWeight.bold, color: AppColors.primary)),
          );
        }).toList(),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onRetry});

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
              'لا توجد إحصائيات كافية لعرضها بعد. سيتم عرض الرسوم بمجرد توفّر بيانات المبيعات والإنتاج والعمال.',
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
