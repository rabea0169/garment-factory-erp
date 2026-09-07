import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../../../core/constants/app_colors.dart';
import '../../../../../core/widgets/app_feedback.dart';
import '../cubit/payrolls_cubit.dart';
import '../cubit/payrolls_state.dart';
import '../widgets/create_payroll_dialog.dart';
import '../widgets/pay_payroll_dialog.dart';

/// MOB-8 + GF-IMP-W3: شاشة كشوف الرواتب — قائمة كشوف GET /hr/payrolls مع
/// مرشح حالة (الكل/مسودة/معتمد/مدفوع)، وتحويلها من عرض فقط إلى دورة
/// كاملة: إنشاء كشف (FAB "كشف جديد")، اعتماد/إبطال للمسودة، ودفع
/// للمعتمد (حوار اختيار الخزينة) — كل فعل بمفتاح اندماجية ويعرض رسالة
/// الخادم الفعلية عند الفشل دون مسح القائمة.
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
                        ? 'لم تُنشأ أي كشوف بعد — أنشئ كشفًا جديدًا من زر "كشف جديد"'
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
                        cubit: context.read<PayrollsCubit>(),
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
      // GF-IMP-W3: إنشاء كشف راتب جديد (POST /hr/payrolls).
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreatePayrollDialog(context),
        icon: const Icon(Icons.post_add),
        label: const Text('كشف جديد'),
      ),
    );
  }

  Future<void> _showCreatePayrollDialog(BuildContext context) async {
    final cubit = context.read<PayrollsCubit>();
    final created = await showDialog<bool>(
      context: context,
      builder: (_) => CreatePayrollDialog(cubit: cubit),
    );
    if (created == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إنشاء كشف الراتب (مسودة) بنجاح')),
      );
    }
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

/// بطاقة كشف راتب — عرض البيانات + أزرار إجراء حسب الحالة:
/// DRAFT → اعتماد + إبطال، APPROVED → دفع، PAID → لا أفعال.
class _PayrollCard extends StatefulWidget {
  const _PayrollCard({required this.payroll, required this.cubit});

  final Map<String, dynamic> payroll;
  final PayrollsCubit cubit;

  @override
  State<_PayrollCard> createState() => _PayrollCardState();
}

class _PayrollCardState extends State<_PayrollCard> {
  /// الفعل الجاري تنفيذه (نص الزر) — null عند الخمول؛ يعطّل بقية الأزرار.
  String? _runningAction;

  String? get _id => widget.payroll['id']?.toString();

  Future<void> _runAction(
    String label,
    String successMessage,
    Future<String?> Function() action,
  ) async {
    setState(() => _runningAction = label);
    final error = await action();
    if (!mounted) return;
    setState(() => _runningAction = null);
    final messenger = ScaffoldMessenger.of(context);
    if (error != null) {
      // رسالة الخادم الفعلية (messageFor) — القائمة تبقى معروضة.
      messenger.showSnackBar(
        SnackBar(content: Text(error), duration: const Duration(seconds: 4)),
      );
    } else {
      messenger.showSnackBar(SnackBar(content: Text(successMessage)));
    }
  }

  Future<void> _approve() => _runAction(
        'اعتماد',
        'تم اعتماد الكشف بنجاح',
        () => widget.cubit.approvePayroll(_id!),
      );

  Future<void> _cancel() async {
    final confirmed = await confirmAppAction(
      context,
      title: 'إبطال كشف الراتب',
      message:
          'سيُحذف كشف المسودة نهائيًا مع تدقيق كامل. هل أنت متأكد؟',
      confirmLabel: 'إبطال',
    );
    if (!confirmed || !mounted) return;
    await _runAction(
      'إبطال',
      'تم إبطال كشف الراتب',
      () => widget.cubit.cancelPayroll(_id!),
    );
  }

  Future<void> _pay() async {
    final treasuryChoice = await showDialog<String>(
      context: context,
      builder: (_) => PayPayrollDialog(
        cubit: widget.cubit,
        payroll: widget.payroll,
      ),
    );
    // null = إلغاء المستخدم؛ نص فارغ = دفع بلا خزينة (صافٍ صفر — HR-4).
    if (treasuryChoice == null || !mounted) return;
    final treasuryId =
        treasuryChoice.isEmpty ? null : treasuryChoice;
    await _runAction(
      'دفع',
      'تم دفع كشف الراتب وترحيله من الخزينة',
      () => widget.cubit.payPayroll(_id!, treasuryId: treasuryId),
    );
  }

  @override
  Widget build(BuildContext context) {
    final workerName = _workerName(widget.payroll);
    final period = _periodLabel(widget.payroll);
    final net = _amount(widget.payroll['netAmount']);
    final status = widget.payroll['status']?.toString() ?? '';
    return Card(
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          ListTile(
            leading: const CircleAvatar(
              backgroundColor: AppColors.primary,
              child: Icon(Icons.payments, color: Colors.white),
            ),
            title: Text(
              workerName ?? 'عامل غير معروف',
              style: const TextStyle(
                  fontWeight: FontWeight.bold, fontFamily: 'Cairo'),
            ),
            subtitle: Text('الفترة: $period\nالصافي: $net ج.م'),
            isThreeLine: true,
            trailing: _StatusChip(status: status),
          ),
          if (_hasActions) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: _actionButtons,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// DRAFT → اعتماد + إبطال؛ APPROVED → دفع؛ PAID → لا أفعال
  /// (ولا أزرار بلا معرف صالح للكشف).
  bool get _hasActions =>
      _id != null && (statusUpper == 'DRAFT' || statusUpper == 'APPROVED');

  String get statusUpper =>
      widget.payroll['status']?.toString().toUpperCase() ?? '';

  List<Widget> get _actionButtons {
    final busy = _runningAction != null;
    final running = _runningAction;
    Widget actionButton({
      required String label,
      required IconData icon,
      required VoidCallback onPressed,
      Color? color,
      bool tonal = true,
    }) =>
        Padding(
          padding: const EdgeInsetsDirectional.only(start: 8),
          child: running == label
              ? FilledButton.tonalIcon(
                  onPressed: null,
                  icon: const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  label: Text('جاري $label...'),
                )
              : tonal
                  ? FilledButton.tonalIcon(
                      onPressed: busy ? null : onPressed,
                      icon: Icon(icon, size: 18),
                      label: Text(label),
                      style: color == null
                          ? null
                          : FilledButton.styleFrom(
                              foregroundColor: color,
                            ),
                    )
                  : TextButton.icon(
                      onPressed: busy ? null : onPressed,
                      icon: Icon(icon, size: 18, color: color),
                      label: Text(label, style: TextStyle(color: color)),
                    ),
        );

    return switch (statusUpper) {
      'DRAFT' => [
          actionButton(
            label: 'اعتماد',
            icon: Icons.verified_outlined,
            onPressed: _approve,
            color: AppColors.primary,
          ),
          actionButton(
            label: 'إبطال',
            icon: Icons.delete_outline,
            onPressed: _cancel,
            color: AppColors.error,
            tonal: false,
          ),
        ],
      'APPROVED' => [
          actionButton(
            label: 'دفع',
            icon: Icons.payments_outlined,
            onPressed: _pay,
            color: AppColors.success,
          ),
        ],
      _ => const <Widget>[],
    };
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
