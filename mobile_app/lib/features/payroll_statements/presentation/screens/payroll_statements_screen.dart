import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart';
import '../../../../core/widgets/selim/status_chip_bar.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/payroll_statements_cubit.dart';

/// شاشة كشوف الرواتب المجمدة — نسخة الجوال من PayrollStatements في Selim.
///
/// البنية (نمط كل شاشات Selim الجديدة):
/// 1. بطاقة العنوان المتدرجة: صافي المجاميع + عدادات المسودة/المرحّلة.
/// 2. شريط شرائح الحالة (الكل/مسودة/مرحّلة) بعداداتها.
/// 3. بطاقات الكشوف المجمدة: الكود + الفترة (من → إلى) + عدد العمال +
///    الصافي + شارة الحالة؛ التوسيع يكشف المجاميع وجدول صفوف العمال
///    (الاسم + الصافي من لقطة lines JSON).
///
/// الإجراءات: «ترحيل ودفع» للمسودة (قيد رواتب واحد وتعليم كشوف العمال
/// مُدفوعة — لا رجعة بعده)، وحذف للمسودة فقط (يفك ربط الكشوف).
/// الزر العائم يولّد كشفًا من فترة منتقاة بتاريخين (periodFrom/To).
class PayrollStatementsScreen extends StatefulWidget {
  const PayrollStatementsScreen({super.key});

  @override
  State<PayrollStatementsScreen> createState() =>
      _PayrollStatementsScreenState();
}

class _PayrollStatementsScreenState extends State<PayrollStatementsScreen> {
  /// البني المميز لوحدة كشوف الرواتب في Selim.
  static const _brown = Color(0xFF5D4037);

  String _filter = 'ALL';

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => PayrollStatementsCubit()..fetch(),
      child: BlocBuilder<PayrollStatementsCubit, PayrollStatementsState>(
        builder: (context, state) {
          return SelimShellScaffold(
            title: 'كشوف الرواتب المجمدة',
            fab: FloatingActionButton.extended(
              onPressed: () => _showGenerateDialog(
                context,
                context.read<PayrollStatementsCubit>(),
              ),
              icon: const Icon(Icons.auto_awesome_rounded),
              label: const Text(
                'توليد كشف',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            body: RefreshIndicator(
              onRefresh: () => context.read<PayrollStatementsCubit>().fetch(),
              child: _body(context, state),
            ),
          );
        },
      ),
    );
  }

  Widget _body(BuildContext context, PayrollStatementsState state) {
    if (state is PayrollStatementsLoading || state is PayrollStatementsInitial) {
      return const AppLoadingView(message: 'جاري تحميل الكشوف المجمدة...');
    }
    if (state is PayrollStatementsError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<PayrollStatementsCubit>().fetch(),
      );
    }
    if (state is PayrollStatementsLoaded) {
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _hero(state),
          const SizedBox(height: 12),
          _chips(context, state),
          const SizedBox(height: 12),
          if (state.statements.isEmpty)
            const _EmptyStatements()
          else
            ...state.statements.map((s) => _statementCard(context, state, s)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  /// بطاقة العنوان: صافي المجاميع من لقطات totals JSON للكشوف المحمّلة.
  Widget _hero(PayrollStatementsLoaded state) {
    num netTotal = 0;
    num grossTotal = 0;
    for (final statement in state.statements) {
      final totals = state.totalsOf(statement);
      netTotal += asNum(totals['net']);
      grossTotal += asNum(totals['gross']);
    }
    return GradientHeroCard(
      title: 'صافي كشوف الرواتب المجمدة',
      value: money(netTotal),
      icon: Icons.receipt_long_rounded,
      gradient: const LinearGradient(
        colors: [_brown, Color(0xFF8D6E63)],
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
      ),
      stats: [
        HeroStat('إجمالي الإجمالي', money(grossTotal), Icons.functions_rounded),
        HeroStat('مسودة', count(state.countOf('DRAFT')), Icons.drafts_rounded),
        HeroStat('مرحّلة', count(state.countOf('POSTED')), Icons.check_circle_rounded),
      ],
    );
  }

  Widget _chips(BuildContext context, PayrollStatementsLoaded state) {
    return StatusChipBar(
      selected: _filter,
      onSelected: (value) {
        setState(() => _filter = value);
        context.read<PayrollStatementsCubit>().fetch(status: value);
      },
      chips: [
        StatusChip(
          label: 'الكل',
          count: state.total,
          color: _brown,
          value: 'ALL',
        ),
        StatusChip(
          label: 'مسودة',
          count: state.countOf('DRAFT'),
          color: AppColors.statusPlanned,
          value: 'DRAFT',
        ),
        StatusChip(
          label: 'مرحّلة',
          count: state.countOf('POSTED'),
          color: AppColors.success,
          value: 'POSTED',
        ),
      ],
    );
  }

  /// بطاقة كشف مجمع: الكود + الفترة + عدد العمال + الصافي.
  Widget _statementCard(
    BuildContext context,
    PayrollStatementsLoaded loaded,
    Map<String, dynamic> statement,
  ) {
    final status = statement['status']?.toString() ?? 'DRAFT';
    final isDraft = status == 'DRAFT';
    final totals = loaded.totalsOf(statement);
    final workerCount = asNum(statement['workerCount']);
    return EntityCard(
      leadingIcon: Icons.receipt_long_rounded,
      iconColor: isDraft ? AppColors.statusPlanned : AppColors.success,
      title: 'كشف ${statement['code'] ?? ''}',
      badge: isDraft
          ? const EntityBadge('مسودة', AppColors.statusPlanned)
          : const EntityBadge('مرحّلة', AppColors.success),
      subtitle:
          '${date(statement['periodFrom'])} → ${date(statement['periodTo'])}',
      amount: money(asNum(totals['net'])),
      meta: '${count(workerCount)} عاملًا',
      expandRows: [
        ExpandRow('إجمالي الرواتب', money(asNum(totals['gross']))),
        ExpandRow('الخصومات (سلف/غياب)', money(asNum(totals['deductions']))),
        ExpandRow('الصافي المستحق', money(asNum(totals['net']))),
        if (statement['approvedAt'] != null)
          ExpandRow('تاريخ الترحيل', date(statement['approvedAt'])),
        if (statement['notes'] != null)
          ExpandRow('ملاحظات', statement['notes'].toString()),
      ],
      // جدول صفوف العمال من لقطة lines JSON: الاسم + الصافي لكل صف.
      expandChildren: [
        _linesTable(loaded.linesOf(statement)),
      ],
      actions: _actionsFor(context, statement, isDraft),
    );
  }

  /// جدول صفوف العمال داخل التوسيع (نفس روح جدول Selim على الجوال:
  /// صف اسم → صافٍ بدل جدول شبكي ضيق).
  Widget _linesTable(List<Map<String, dynamic>> lines) {
    if (lines.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(14, 4, 14, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 1),
          const SizedBox(height: 8),
          const Text(
            'صفوف العمال',
            style: TextStyle(
              fontFamily: 'Cairo',
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          ...lines.map(
            (line) => Padding(
              padding: const EdgeInsetsDirectional.symmetric(vertical: 2),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      line['workerName']?.toString() ?? 'عامل',
                      style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
                    ),
                  ),
                  Directionality(
                    textDirection: TextDirection.ltr,
                    child: Text(
                      money(asNum(line['net'])),
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.success,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<EntityAction> _actionsFor(
    BuildContext context,
    Map<String, dynamic> statement,
    bool isDraft,
  ) {
    final cubit = context.read<PayrollStatementsCubit>();
    final id = statement['id']?.toString() ?? '';
    final actions = <EntityAction>[];
    if (isDraft) {
      actions.add(
        EntityAction(
          'ترحيل ودفع',
          Icons.send_rounded,
          () => _confirmPost(context, cubit, id, statement['code']?.toString() ?? ''),
          color: AppColors.success,
        ),
      );
      actions.add(
        EntityAction(
          'حذف',
          Icons.delete_rounded,
          () => _confirmDelete(context, cubit, id, statement['code']?.toString() ?? ''),
          color: AppColors.error,
        ),
      );
    }
    return actions;
  }

  /// ترحيل الكشف المجمع — إجراء لا رجعة فيه (تأكيد إلزامي يشرح الأثر).
  Future<void> _confirmPost(
    BuildContext context,
    PayrollStatementsCubit cubit,
    String id,
    String code,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'ترحيل كشف $code',
      message:
          'سيتم ترحيل القيد المحاسبي (مصروف الرواتب بالإجمالي، مستحق بالصافي، '
          'ورد الخصومات لسلف العمال) وتعليم كشوف العمال المرتبطة مُدفوعة — '
          'لا يمكن التراجع بعد الترحيل. هل تريد المتابعة؟',
      confirmLabel: 'ترحيل ودفع',
    );
    if (!confirmed || !mounted) return;
    final messenger = ScaffoldMessenger.of(this.context);
    final ok = await cubit.post(id);
    if (!mounted) return;
    _snack(messenger, cubit,
        ok ? 'تم ترحيل الكشف ودفع كشوف العمال' : null);
  }

  Future<void> _confirmDelete(
    BuildContext context,
    PayrollStatementsCubit cubit,
    String id,
    String code,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف كشف $code',
      message:
          'يمكن حذف المسودة فقط — سيُفك ربط الكشوف المرتبطة فتعود متاحة '
          'للتجميع مجددًا. هل تريد الحذف؟',
      confirmLabel: 'حذف',
    );
    if (!confirmed || !mounted) return;
    final messenger = ScaffoldMessenger.of(this.context);
    final ok = await cubit.delete(id);
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تم حذف الكشف المجمع' : null);
  }

  /// حوار التوليد: منتقيان للتاريخ (بداية/نهاية الفترة) + ملاحظات.
  Future<void> _showGenerateDialog(
    BuildContext context,
    PayrollStatementsCubit cubit,
  ) async {
    final periodFrom = TextEditingController();
    final periodTo = TextEditingController();
    final notes = TextEditingController();
    final messenger = ScaffoldMessenger.of(context);
    final now = DateTime.now();
    periodFrom.text = DateTime(now.year, now.month, 1).toIso8601String().substring(0, 10);
    periodTo.text = now.toIso8601String().substring(0, 10);
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('توليد كشف رواتب مجمع'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'يجمع كل كشوف الرواتب المعتمدة غير المدفوعة التي تتقاطع '
                'فتراتها مع النطاق في لقطة JSON مجمدة.',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 11.5,
                  color: Colors.grey.shade600,
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: periodFrom,
                readOnly: true,
                onTap: () async {
                  final picked = await showDatePicker(
                    context: dialogContext,
                    initialDate: DateTime.tryParse(periodFrom.text) ?? now,
                    firstDate: DateTime(2020),
                    lastDate: DateTime(now.year + 2),
                  );
                  if (picked != null) {
                    setDialogState(
                      () => periodFrom.text = picked.toIso8601String().substring(0, 10),
                    );
                  }
                },
                decoration: const InputDecoration(
                  labelText: 'بداية الفترة',
                  prefixIcon: Icon(Icons.event_rounded),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: periodTo,
                readOnly: true,
                onTap: () async {
                  final picked = await showDatePicker(
                    context: dialogContext,
                    initialDate: DateTime.tryParse(periodTo.text) ?? now,
                    firstDate: DateTime(2020),
                    lastDate: DateTime(now.year + 2),
                  );
                  if (picked != null) {
                    setDialogState(
                      () => periodTo.text = picked.toIso8601String().substring(0, 10),
                    );
                  }
                },
                decoration: const InputDecoration(
                  labelText: 'نهاية الفترة',
                  prefixIcon: Icon(Icons.event_available_rounded),
                  border: OutlineInputBorder(),
                ),
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
              child: const Text('توليد'),
            ),
          ],
        ),
      ),
    );
    if (saved != true || !mounted) return;
    final ok = await cubit.generate(
      periodFrom: periodFrom.text,
      periodTo: periodTo.text,
      notes: notes.text.trim().isEmpty ? null : notes.text,
    );
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تم توليد الكشف المجمع' : null);
  }

  /// رسالة موحدة: نجاح، أو خطأ الإجراء من الخادم إن وُجد (مثل: لا
  /// توجد كشوف رواتب معتمدة غير مدفوعة في الفترة).
  void _snack(
    ScaffoldMessengerState messenger,
    PayrollStatementsCubit cubit,
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

class _EmptyStatements extends StatelessWidget {
  const _EmptyStatements();

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
              'لا توجد كشوف رواتب مجمعة',
              style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'ولّد كشفًا من كشوف شهر معتمدة غير مدفوعة بزر «توليد كشف»',
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
