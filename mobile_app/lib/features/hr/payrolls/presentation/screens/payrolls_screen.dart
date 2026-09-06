import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../../../core/constants/app_colors.dart';
import '../../../../../core/widgets/app_feedback.dart';
import '../cubit/payrolls_cubit.dart';
import '../cubit/payrolls_state.dart';

/// MOB-8: شاشة حالة الرواتب — قائمة كشوف الرواتب من GET /hr/payrolls
/// مع مرشح حالة بسيط (الكل/مسودة/معتمد/مدفوع)، عرض الصافي والحالة
/// وتاريخ الفترة، وتحديث بالسحب + حالات loading/loaded/empty/error
/// عربية كاملة.
class PayrollsScreen extends StatelessWidget {
  const PayrollsScreen({this.cubit, super.key});

  /// يُحقن في الاختبارات؛ الافتراضي cubit جديد يبدأ الجلب فورًا.
  final PayrollsCubit? cubit;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => cubit ?? (PayrollsCubit()..fetchPayrolls()),
      child: const _PayrollsView(),
    );
  }
}

class _PayrollsView extends StatelessWidget {
  const _PayrollsView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('كشوف الرواتب')),
      body: Column(
        children: [
          const _PayrollFilterBar(),
          Expanded(
            child: BlocBuilder<PayrollsCubit, PayrollsState>(
              builder: (context, state) {
                if (state is PayrollsLoading || state is PayrollsInitial) {
                  return const AppLoadingView(message: 'جاري تحميل الكشوف...');
                }
                if (state is PayrollsError) {
                  return AppErrorView(
                    message: state.message,
                    onRetry: () =>
                        context.read<PayrollsCubit>().fetchPayrolls(),
                  );
                }
                if (state is PayrollsEmpty) {
                  return AppEmptyView(
                    title: 'لا توجد كشوف رواتب',
                    message: state.filter == PayrollStatusFilter.all
                        ? 'لم تُنشأ أي كشوف بعد'
                        : 'لا توجد كشوف بحالة "${state.filter.label}"',
                    actionLabel: 'إعادة التحميل',
                    onAction: () =>
                        context.read<PayrollsCubit>().fetchPayrolls(),
                  );
                }
                if (state is PayrollsLoaded) {
                  return RefreshIndicator(
                    onRefresh: () => context
                        .read<PayrollsCubit>()
                        .fetchPayrolls(refreshing: true),
                    child: ListView.separated(
                      // دائمًا قابلة للسحب (شروط ScrollPhysics للسحب).
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(16),
                      itemCount: state.payrolls.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (context, index) => _PayrollCard(
                        payroll: state.payrolls[index],
                      ),
                    ),
                  );
                }
                return const SizedBox.shrink();
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// شريط مرشح الحالة — شرائح أفقية قابلة للتمرير.
class _PayrollFilterBar extends StatelessWidget {
  const _PayrollFilterBar();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<PayrollsCubit, PayrollsState>(
      buildWhen: (previous, current) => previous.filter != current.filter,
      builder: (context, state) {
        return SizedBox(
          height: 56,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            children: [
              for (final filter in PayrollStatusFilter.values)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 8),
                  child: ChoiceChip(
                    label: Text(filter.label),
                    selected: state.filter == filter,
                    onSelected: (_) =>
                        context.read<PayrollsCubit>().setFilter(filter),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _PayrollCard extends StatelessWidget {
  const _PayrollCard({required this.payroll});

  final Map<String, dynamic> payroll;

  @override
  Widget build(BuildContext context) {
    final workerName = _workerName(payroll);
    final period = _periodLabel(payroll);
    final net = _amount(payroll['netAmount']);
    final status = payroll['status']?.toString() ?? '';
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: AppColors.primary,
          child: Icon(Icons.payments, color: Colors.white),
        ),
        title: Text(
          workerName ?? 'عامل غير معروف',
          style:
              const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Cairo'),
        ),
        subtitle: Text('الفترة: $period\nالصافي: $net ج.م'),
        isThreeLine: true,
        trailing: _StatusChip(status: status),
      ),
    );
  }

  /// اسم العامل من كائن worker المتداخل بالعقد الحرفي
  /// (worker: {id, name, code}) — مع سقوط توافقي للحقل المسطح
  /// workerName إن أرسله مصدر آخر.
  static String? _workerName(Map<String, dynamic> payroll) {
    final worker = payroll['worker'];
    if (worker is Map) {
      final name = worker['name']?.toString();
      if (name != null && name.isNotEmpty) return name;
    }
    final flat = payroll['workerName']?.toString();
    if (flat != null && flat.isNotEmpty) return flat;
    return null;
  }

  static String _periodLabel(Map<String, dynamic> payroll) {
    final start = _date(payroll['periodStart']);
    final end = _date(payroll['periodEnd']);
    if (start == null && end == null) return 'غير محددة';
    if (start == null) return end!;
    if (end == null) return start;
    return '$start → $end';
  }

  static String? _date(Object? value) {
    if (value == null) return null;
    final parsed = DateTime.tryParse(value.toString());
    if (parsed == null) return null;
    return DateFormat('yyyy-MM-dd').format(parsed);
  }

  static String _amount(Object? value) {
    final parsed = num.tryParse(value?.toString() ?? '');
    if (parsed == null) return '0.00';
    return parsed.toStringAsFixed(2);
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status.toUpperCase()) {
      'DRAFT' => ('مسودة', AppColors.textSecondary),
      'APPROVED' => ('معتمد', AppColors.primary),
      'PAID' => ('مدفوع', AppColors.success),
      _ => (status.isEmpty ? 'غير معروفة' : status, AppColors.textSecondary),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.bold,
          fontFamily: 'Cairo',
        ),
      ),
    );
  }
}
