import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart';
import '../../../../core/widgets/selim/status_chip_bar.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/treasury_cubit.dart';
import '../widgets/treasury_transaction_form_dialog.dart';

/// شاشة حركات الخزينة (SELIM-ERP W1) — بنمط شاشات Selim:
///
/// 1. بطاقة العنوان المتدرجة الزمردية (00897B → 26A69A): رصيد الخزائن
///    الكلي + مجاميع الإيداعات/السحوبات/التحويلات.
/// 2. شريط شرائح النوع: الكل/إيداعات/سحوبات/تحويلات — يمرر type كمرشح
///    استعلام للخادم، مع فلتر خزينة من شريط التطبيق (treasuryId).
/// 3. بطاقات حركات: المبلغ بإشارة (+ أخضر للإيداع / − أحمر للسحب /
///    محايد للتحويل) مع وصف الحركة وفئتها ورمزها TRT.
/// 4. إجراء حذف للحركات اليدوية فقط (بلا referenceId — الحركات الناتجة
///    عن مستندات تُحذف من مستندها).
class TreasuryScreen extends StatefulWidget {
  const TreasuryScreen({super.key});

  @override
  State<TreasuryScreen> createState() => _TreasuryScreenState();
}

class _TreasuryScreenState extends State<TreasuryScreen> {
  String _typeFilter = 'ALL';
  String? _treasuryFilter;

  static const _emerald = Color(0xFF00897B);
  static const _emeraldLight = Color(0xFF26A69A);

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => TreasuryCubit()..fetch(),
      child: BlocBuilder<TreasuryCubit, TreasuryState>(
        builder: (context, state) {
          return SelimShellScaffold(
            title: 'الخزينة',
            fab: FloatingActionButton.extended(
              onPressed: () => _openForm(context, state),
              icon: const Icon(Icons.add_card_rounded),
              label: const Text(
                'حركة جديدة',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            actions: [
              if (state is TreasuryLoaded) _treasuryFilterMenu(context, state),
            ],
            body: RefreshIndicator(
              onRefresh: () => context.read<TreasuryCubit>().fetch(),
              child: _body(context, state),
            ),
          );
        },
      ),
    );
  }

  Widget _treasuryFilterMenu(BuildContext context, TreasuryLoaded state) {
    return PopupMenuButton<String?>(
      tooltip: 'فلترة الخزينة',
      icon: const Icon(Icons.filter_list_rounded),
      initialValue: _treasuryFilter,
      onSelected: (value) {
        setState(() => _treasuryFilter = value);
        context.read<TreasuryCubit>().fetch(treasuryId: value ?? '');
      },
      itemBuilder: (context) => [
        PopupMenuItem<String?>(
          value: null,
          child: const Text('كل الخزائن', style: TextStyle(fontFamily: 'Cairo')),
        ),
        ...state.treasuries.map(
          (treasury) => PopupMenuItem<String?>(
            value: treasury['id']?.toString(),
            child: Text(
              treasury['name']?.toString() ?? 'خزينة',
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
            ),
          ),
        ),
      ],
    );
  }

  Widget _body(BuildContext context, TreasuryState state) {
    if (state is TreasuryLoading || state is TreasuryInitial) {
      return const AppLoadingView(message: 'جاري تحميل حركات الخزينة...');
    }
    if (state is TreasuryError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<TreasuryCubit>().fetch(),
      );
    }
    if (state is TreasuryLoaded) {
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _hero(state),
          const SizedBox(height: 12),
          _chips(state),
          const SizedBox(height: 12),
          if (state.transactions.isEmpty)
            AppEmptyView(
              title: _typeFilter == 'ALL' && _treasuryFilter == null
                  ? 'لا توجد حركات خزينة'
                  : 'لا حركات مطابقة للفلاتر الحالية',
              actionLabel: 'حركة جديدة',
              onAction: () => _openForm(context, state),
            )
          else
            ...state.transactions.map((t) => _transactionCard(context, t)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Future<void> _openForm(BuildContext context, TreasuryState state) async {
    final treasuries =
        state is TreasuryLoaded ? state.treasuries : const <Map<String, dynamic>>[];
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => TreasuryTransactionFormDialog(treasuries: treasuries),
    );
    if (saved == true && context.mounted) {
      await context.read<TreasuryCubit>().fetch();
    }
  }

  Widget _hero(TreasuryLoaded state) {
    final stats = state.stats;
    final byType = (stats['byType'] as Map?) ?? const {};
    double typeTotal(String key) =>
        asNum((byType[key] as Map?)?['totalAmount']).toDouble();
    // الملخص المحاسبي متاح للإدارة/المحاسبة — عند غيابه (403) نحسب
    // المجاميع من الحركات المعروضة نفسها (نفس تراجع quotations للـ stats).
    final hasSummary = stats.isNotEmpty;
    final fallbackDeposit = state.transactions
        .where((t) => t['type'] == 'DEPOSIT')
        .fold<double>(0, (sum, t) => sum + asNum(t['amount']).toDouble());
    final fallbackWithdrawal = state.transactions
        .where((t) => t['type'] == 'WITHDRAWAL')
        .fold<double>(0, (sum, t) => sum + asNum(t['amount']).toDouble());
    final fallbackTransfer = state.transactions
        .where((t) => t['type'] == 'TRANSFER')
        .fold<double>(0, (sum, t) => sum + asNum(t['amount']).toDouble());
    return GradientHeroCard(
      title: 'رصيد الخزائن',
      value: money(asNum(stats['totalActiveBalance'])),
      icon: Icons.account_balance_wallet_rounded,
      gradient: const LinearGradient(
        colors: [_emerald, _emeraldLight],
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
      ),
      stats: [
        HeroStat(
          'إيداعات',
          money(hasSummary ? typeTotal('DEPOSIT') : fallbackDeposit),
          Icons.south_west_rounded,
        ),
        HeroStat(
          'سحوبات',
          money(hasSummary ? typeTotal('WITHDRAWAL') : fallbackWithdrawal),
          Icons.north_east_rounded,
        ),
        HeroStat(
          'تحويلات',
          money(hasSummary ? typeTotal('TRANSFER') : fallbackTransfer),
          Icons.swap_horiz_rounded,
        ),
      ],
    );
  }

  Widget _chips(TreasuryLoaded state) {
    final stats = state.stats;
    final byType = (stats['byType'] as Map?) ?? const {};
    int typeCount(String key) => asNum((byType[key] as Map?)?['count']).toInt();
    return StatusChipBar(
      selected: _typeFilter,
      onSelected: (value) => setState(() {
        _typeFilter = value;
        context.read<TreasuryCubit>().fetch(type: value);
      }),
      chips: [
        StatusChip(
          label: 'الكل',
          count: byType.isEmpty
              ? state.transactions.length
              : typeCount('DEPOSIT') +
                  typeCount('WITHDRAWAL') +
                  typeCount('TRANSFER'),
          color: _emerald,
          value: 'ALL',
        ),
        StatusChip(
          label: 'إيداعات',
          count: typeCount('DEPOSIT'),
          color: AppColors.success,
          value: 'DEPOSIT',
        ),
        StatusChip(
          label: 'سحوبات',
          count: typeCount('WITHDRAWAL'),
          color: AppColors.error,
          value: 'WITHDRAWAL',
        ),
        StatusChip(
          label: 'تحويلات',
          count: typeCount('TRANSFER'),
          color: AppColors.info,
          value: 'TRANSFER',
        ),
      ],
    );
  }

  Widget _transactionCard(BuildContext context, Map<String, dynamic> t) {
    final type = t['type']?.toString() ?? 'DEPOSIT';
    final treasury = t['treasury'] as Map?;
    final toTreasury = t['toTreasury'] as Map?;
    final journal = t['journalEntry'] as Map?;
    final amount = asNum(t['amount']).toDouble();
    final isManual = t['referenceId'] == null;

    // إشارة المبلغ: إيداع + / سحب − / تحويل بلا إشارة (حركة داخلية).
    final sign = type == 'DEPOSIT' ? '+' : (type == 'WITHDRAWAL' ? '-' : '');
    final amountColor = type == 'DEPOSIT'
        ? AppColors.success
        : (type == 'WITHDRAWAL' ? AppColors.error : _emerald);
    final title = type == 'TRANSFER'
        ? '${treasury?['name'] ?? 'خزينة'} → ${toTreasury?['name'] ?? 'خزينة'}'
        : (treasury?['name']?.toString() ?? 'خزينة');

    return EntityCard(
      leadingIcon: type == 'DEPOSIT'
          ? Icons.south_west_rounded
          : (type == 'WITHDRAWAL' ? Icons.north_east_rounded : Icons.swap_horiz_rounded),
      iconColor: amountColor,
      title: title,
      badge: EntityBadge(_typeLabel(type), amountColor),
      subtitle: '${t['code'] ?? ''} · ${date(t['date'] ?? t['createdAt'])}',
      amount: '$sign${money(amount)}',
      amountColor: amountColor,
      meta: t['category']?.toString(),
      expandRows: [
        ExpandRow('النوع', _typeLabel(type)),
        ExpandRow('الخزينة', treasury?['name']?.toString() ?? '—'),
        if (toTreasury != null)
          ExpandRow('الخزينة المستهدفة', toTreasury['name']?.toString() ?? '—'),
        if (t['category'] != null) ExpandRow('الفئة', t['category'].toString()),
        ExpandRow('الوصف', t['description']?.toString() ?? '—'),
        if (journal != null && journal['code'] != null)
          ExpandRow('القيد المالي', journal['code'].toString())
        else
          const ExpandRow('القيد المالي', 'حركة داخلية بلا قيد GL'),
        if (t['notes'] != null) ExpandRow('ملاحظات', t['notes'].toString()),
        ExpandRow('أنشئها', (t['createdBy'] as Map?)?['name']?.toString() ?? '—'),
      ],
      actions: [
        // الحذف للحركات اليدوية فقط — الحركات المرتبطة بمستند تُحذف منه.
        if (isManual)
          EntityAction(
            'حذف',
            Icons.delete_rounded,
            () => _confirmDelete(context, t),
            color: AppColors.error,
          ),
      ],
    );
  }

  String _typeLabel(String type) {
    switch (type) {
      case 'DEPOSIT':
        return 'إيداع';
      case 'WITHDRAWAL':
        return 'سحب';
      case 'TRANSFER':
        return 'تحويل';
    }
    return type;
  }

  Future<void> _confirmDelete(
    BuildContext context,
    Map<String, dynamic> t,
  ) async {
    final cubit = context.read<TreasuryCubit>();
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف الحركة ${t['code'] ?? ''}',
      message:
          'سيُعكس القيد المالي وتُعاد الأرصدة (عكس اتجاه الحركة) داخل معاملة '
          'واحدة. هل تريد الحذف؟',
      confirmLabel: 'حذف',
    );
    if (confirmed && mounted) {
      await _run(
        this.context,
        cubit.delete(t['id']?.toString() ?? ''),
        'تم حذف الحركة وإعادة الأرصدة',
      );
    }
  }

  Future<void> _run(
    BuildContext context,
    Future<bool> future,
    String successMessage,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await future;
    if (!mounted) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            ok ? successMessage : 'تعذر تنفيذ العملية — تحقق من الشروط وحاول مجددًا',
            style: const TextStyle(fontFamily: 'Cairo'),
          ),
          backgroundColor: ok ? AppColors.success : AppColors.error,
          duration: const Duration(seconds: 3),
        ),
      );
  }
}
