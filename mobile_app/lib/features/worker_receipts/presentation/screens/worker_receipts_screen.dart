import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/worker_receipts_cubit.dart';

/// شاشة سندات قبض العمال — نسخة الجوال من WorkerReceipts في Selim ERP.
///
/// البنية (نمط كل شاشات Selim الجديدة):
/// 1. بطاقة العنوان المتدرجة: إجمالي مقبوضات اليوم + عددها وعدد العمال.
/// 2. قائمة منسدلة لفلترة سندات عامل بعينه (مع مجاميعه داخل المرشح).
/// 3. قائمة بطاقات السندات: الكود + العامل + المبلغ (أخضر) + التاريخ +
///    اسم الخزينة إن وُجدت، مع حذف بتأكيد (يعكس القيد ويعيد رصيد
///    الخزينة خادميًا في معاملة واحدة).
///
/// الزر العائم يفتح حوار الإنشاء: عامل (إلزامي) + مبلغ + خزينة
/// اختيارية (تُجلب عند فتح الحوار) + ملاحظات.
class WorkerReceiptsScreen extends StatefulWidget {
  const WorkerReceiptsScreen({super.key});

  @override
  State<WorkerReceiptsScreen> createState() => _WorkerReceiptsScreenState();
}

class _WorkerReceiptsScreenState extends State<WorkerReceiptsScreen> {
  /// البنفسجي المميز لوحدة العمالة في Selim.
  static const _violet = Color(0xFF6A1B9A);

  String? _workerFilter;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => WorkerReceiptsCubit()..fetch(),
      child: BlocBuilder<WorkerReceiptsCubit, WorkerReceiptsState>(
        builder: (context, state) {
          return SelimShellScaffold(
            title: 'سندات قبض العمال',
            fab: FloatingActionButton.extended(
              onPressed: () =>
                  _showCreateDialog(context, context.read<WorkerReceiptsCubit>()),
              icon: const Icon(Icons.add_rounded),
              label: const Text(
                'سند جديد',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            body: RefreshIndicator(
              onRefresh: () => context.read<WorkerReceiptsCubit>().fetch(),
              child: _body(context, state),
            ),
          );
        },
      ),
    );
  }

  Widget _body(BuildContext context, WorkerReceiptsState state) {
    if (state is WorkerReceiptsLoading || state is WorkerReceiptsInitial) {
      return const AppLoadingView(message: 'جاري تحميل سندات القبض...');
    }
    if (state is WorkerReceiptsError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<WorkerReceiptsCubit>().fetch(),
      );
    }
    if (state is WorkerReceiptsLoaded) {
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _hero(state),
          const SizedBox(height: 12),
          _workerFilterField(context, state),
          const SizedBox(height: 12),
          if (state.receipts.isEmpty)
            const _EmptyReceipts()
          else
            ...state.receipts.map((r) => _receiptCard(context, r)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  /// بطاقة العنوان: مقبوضات اليوم (محسوبة عميلًا من تاريخ السندات).
  Widget _hero(WorkerReceiptsLoaded state) {
    final today = DateTime.now();
    num todayTotal = 0;
    int todayCount = 0;
    for (final receipt in state.receipts) {
      final dt = DateTime.tryParse(receipt['date']?.toString() ?? '');
      if (dt != null &&
          dt.year == today.year &&
          dt.month == today.month &&
          dt.day == today.day) {
        todayTotal += asNum(receipt['amount']);
        todayCount++;
      }
    }
    return GradientHeroCard(
      title: 'سندات قبض العمال — اليوم',
      value: money(todayTotal),
      icon: Icons.receipt_long_rounded,
      gradient: const LinearGradient(
        colors: [_violet, Color(0xFF8E24AA)],
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
      ),
      stats: [
        HeroStat('سندات اليوم', count(todayCount), Icons.today_rounded),
        HeroStat('إجمالي السندات', count(state.total), Icons.receipt_rounded),
        HeroStat(
          'عمال له سندات',
          count(state.workerTotals.length),
          Icons.groups_rounded,
        ),
      ],
    );
  }

  /// قائمة منسدلة لفلترة سندات عامل (استعلام جديد عند التغيير).
  Widget _workerFilterField(BuildContext context, WorkerReceiptsLoaded state) {
    return DropdownButtonFormField<String?>(
      initialValue: _workerFilter,
      isExpanded: true,
      decoration: InputDecoration(
        hintText: 'كل العمال',
        filled: true,
        fillColor: Colors.white,
        prefixIcon: const Icon(Icons.person_search_rounded),
        contentPadding: const EdgeInsetsDirectional.symmetric(vertical: 10),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
      ),
      items: [
        const DropdownMenuItem<String?>(value: null, child: Text('كل العمال')),
        ...state.workers.map(
          (worker) => DropdownMenuItem<String?>(
            value: worker['id']?.toString(),
            child: Text(worker['name']?.toString() ?? 'عامل'),
          ),
        ),
      ],
      onChanged: (value) {
        setState(() => _workerFilter = value);
        context.read<WorkerReceiptsCubit>().fetch(workerId: value ?? '');
      },
    );
  }

  /// بطاقة سند قبض: الكود + العامل + المبلغ (أخضر) + الخزينة.
  Widget _receiptCard(BuildContext context, Map<String, dynamic> receipt) {
    final worker = receipt['worker'];
    final treasury = receipt['treasury'];
    final workerName =
        (worker is Map ? worker['name'] : null)?.toString() ?? 'عامل';
    final treasuryName = treasury is Map ? treasury['name']?.toString() : null;
    return EntityCard(
      leadingIcon: Icons.receipt_long_rounded,
      iconColor: _violet,
      title: workerName,
      subtitle:
          '${receipt['code'] ?? ''} · ${date(receipt['date'])}',
      amount: money(asNum(receipt['amount'])),
      amountColor: AppColors.success,
      meta: treasuryName,
      expandRows: [
        ExpandRow('المبلغ', money(asNum(receipt['amount']))),
        ExpandRow('التاريخ', date(receipt['date'])),
        ExpandRow('العامل', workerName),
        if (treasuryName != null) ExpandRow('الخزينة', treasuryName),
        if (receipt['notes'] != null)
          ExpandRow('ملاحظات', receipt['notes'].toString()),
      ],
      actions: [
        EntityAction(
          'حذف',
          Icons.delete_rounded,
          () => _confirmDelete(
            context,
            context.read<WorkerReceiptsCubit>(),
            receipt,
          ),
          color: AppColors.error,
        ),
      ],
    );
  }

  /// حذف سند — يعكس القيد ويعيد رصيد الخزينة خادميًا (تأكيد إلزامي).
  Future<void> _confirmDelete(
    BuildContext context,
    WorkerReceiptsCubit cubit,
    Map<String, dynamic> receipt,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف سند قبض',
      message:
          'سيُعكس القيد المحاسبي ويُعاد رصيد الخزينة المرتبطة إن وُجدت — '
          'هل تريد حذف السند ${receipt['code'] ?? ''}؟',
      confirmLabel: 'حذف',
    );
    if (!confirmed || !mounted) return;
    final messenger = ScaffoldMessenger.of(this.context);
    final ok = await cubit.delete(receipt['id']?.toString() ?? '');
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تم حذف السند وعكس أثره المالي' : null);
  }

  /// حوار إنشاء سند: عامل + مبلغ + خزينة اختيارية + ملاحظات.
  Future<void> _showCreateDialog(
    BuildContext context,
    WorkerReceiptsCubit cubit,
  ) async {
    String? workerId;
    String? treasuryId;
    final amount = TextEditingController();
    final notes = TextEditingController();
    final messenger = ScaffoldMessenger.of(context);
    // الخزائن تُجلب لحظة الحوار (لا تثقل تحميل الشاشة) — الفشل يعرض
    // رسالة ويترك الاختيار فارغًا (السند بلا خزينة يظل صالحًا خادميًا).
    List<Map<String, dynamic>> treasuries = const [];
    try {
      treasuries = await cubit.fetchTreasuries();
    } catch (_) {}
    if (!mounted) return;
    final state = cubit.state;
    final workers =
        state is WorkerReceiptsLoaded ? state.workers : const <Map<String, dynamic>>[];
    final saved = await showDialog<bool>(
      context: this.context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('سند قبض جديد'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: workerId,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'العامل',
                  prefixIcon: Icon(Icons.person_rounded),
                  border: OutlineInputBorder(),
                ),
                items: workers
                    .map(
                      (worker) => DropdownMenuItem<String>(
                        value: worker['id']?.toString(),
                        child: Text(worker['name']?.toString() ?? 'عامل'),
                      ),
                    )
                    .toList(),
                onChanged: (value) =>
                    setDialogState(() => workerId = value),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: amount,
                autofocus: true,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'المبلغ المقبوض (ج.م)',
                  prefixIcon: Icon(Icons.payments_rounded),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                initialValue: treasuryId,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: 'الخزينة (اختياري)',
                  prefixIcon: const Icon(Icons.account_balance_rounded),
                  border: const OutlineInputBorder(),
                ),
                items: [
                  const DropdownMenuItem<String?>(value: null, child: Text('بلا خزينة')),
                  ...treasuries.map(
                    (treasury) => DropdownMenuItem<String?>(
                      value: treasury['id']?.toString(),
                      child: Text(
                        '${treasury['name'] ?? 'خزينة'} · ${money(asNum(treasury['balance']))}',
                      ),
                    ),
                  ),
                ],
                onChanged: (value) => setDialogState(() => treasuryId = value),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: notes,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'ملاحظات (اختياري)',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('حفظ السند'),
            ),
          ],
        ),
      ),
    );
    if (saved != true || !mounted) return;
    final value = double.tryParse(amount.text);
    if (workerId == null || value == null || value <= 0) {
      _snack(messenger, cubit, null, fallback: 'اختر العامل وأدخل مبلغًا صحيحًا');
      return;
    }
    final ok = await cubit.create(
      workerId: workerId!,
      amount: value,
      treasuryId: treasuryId,
      notes: notes.text.trim().isEmpty ? null : notes.text,
    );
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تم إنشاء سند القبض' : null);
  }

  /// رسالة موحدة: نجاح، أو خطأ الإجراء من الخادم إن وُجد.
  void _snack(
    ScaffoldMessengerState messenger,
    WorkerReceiptsCubit cubit,
    String? success, {
    String? fallback,
  }) {
    final ok = success != null;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            ok
                ? success
                : (cubit.lastActionError ??
                    fallback ??
                    'تعذر تنفيذ العملية — حاول مجددًا'),
            style: const TextStyle(fontFamily: 'Cairo'),
          ),
          backgroundColor: ok ? AppColors.success : AppColors.error,
          duration: const Duration(seconds: 3),
        ),
      );
  }
}

class _EmptyReceipts extends StatelessWidget {
  const _EmptyReceipts();

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0.5,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(24),
        child: Column(
          children: [
            const Icon(Icons.receipt_long_rounded,
                size: 48, color: AppColors.textHint),
            const SizedBox(height: 10),
            const Text(
              'لا توجد سندات قبض',
              style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'سجّل سندًا جديدًا لتسوية سلفة أو مديونية عامل',
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12,
                color: Colors.grey.shade500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
