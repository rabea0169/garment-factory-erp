import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart';
import '../../../../core/widgets/selim/status_chip_bar.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/expenses_cubit.dart';
import '../widgets/expense_category_form_dialog.dart';
import '../widgets/expense_form_dialog.dart';

/// شاشة المصاريف وبنودها (SELIM-ERP W1) — بنمط شاشات Selim بتبويبين:
///
/// 1. تبويب «المصاريف»: بطاقة العنوان الوردية (C62828 → EF5350) بإجمالي
///    المصاريف والعدد ومصاريف اليوم، شريط شرائح البنود (فلترة categoryId)،
///    بحث بالملاحظات/البند (search خادمي)، وبطاقات كيانات بإجراء حذف.
/// 2. تبويب «البنود»: بطاقات بنود المصاريف بعدّاد استخدام مع إنشاء وتعديل
///    وحذف (الحذف ممنوع للبنود المستخدمة — Restrict خادمي).
///
/// زر الإجراء العائم يتبدل مع التبويب: «مصروف جديد» / «بند جديد».
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});

  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  final _search = TextEditingController();
  String _categoryFilter = 'ALL';

  static const _rose = Color(0xFFC62828);
  static const _roseLight = Color(0xFFEF5350);

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (_tabController.indexIsChanging) {
        // إعادة بناء ليتبدل زر الإجراء العائم مع التبويب النشط.
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => ExpensesCubit()..fetch(),
      child: BlocBuilder<ExpensesCubit, ExpensesState>(
        builder: (context, state) {
          return SelimShellScaffold(
            title: 'المصاريف',
            fab: FloatingActionButton.extended(
              onPressed: () => _onFab(context, state),
              icon: Icon(
                _tabController.index == 0
                    ? Icons.payments_rounded
                    : Icons.category_rounded,
              ),
              label: Text(
                _tabController.index == 0 ? 'مصروف جديد' : 'بند جديد',
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            body: Column(
              children: [
                Material(
                  color: Colors.white,
                  child: TabBar(
                    controller: _tabController,
                    labelColor: _rose,
                    unselectedLabelColor: Colors.grey.shade600,
                    indicatorColor: _rose,
                    labelStyle: const TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                    tabs: const [
                      Tab(text: 'المصاريف'),
                      Tab(text: 'البنود'),
                    ],
                  ),
                ),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      RefreshIndicator(
                        onRefresh: () =>
                            context.read<ExpensesCubit>().fetch(),
                        child: _expensesTab(context, state),
                      ),
                      RefreshIndicator(
                        onRefresh: () =>
                            context.read<ExpensesCubit>().fetch(),
                        child: _categoriesTab(context, state),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _onFab(BuildContext context, ExpensesState state) {
    if (_tabController.index == 0) {
      final categories =
          state is ExpensesLoaded ? state.categories : const <Map<String, dynamic>>[];
      _openExpenseForm(context, categories);
    } else {
      _openCategoryForm(context);
    }
  }

  Future<void> _openExpenseForm(
    BuildContext context,
    List<Map<String, dynamic>> categories,
  ) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => ExpenseFormDialog(categories: categories),
    );
    if (saved == true && context.mounted) {
      await context.read<ExpensesCubit>().fetch();
    }
  }

  Future<void> _openCategoryForm(BuildContext context) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => const ExpenseCategoryFormDialog(),
    );
    if (saved == true && context.mounted) {
      await context.read<ExpensesCubit>().fetch();
    }
  }

  // ===================== تبويب المصاريف =====================

  Widget _expensesTab(BuildContext context, ExpensesState state) {
    if (state is ExpensesLoading || state is ExpensesInitial) {
      return ListView(
        children: const [
          SizedBox(height: 120),
          Center(child: AppLoadingView(message: 'جاري تحميل المصاريف...')),
        ],
      );
    }
    if (state is ExpensesError) {
      return ListView(
        children: [
          const SizedBox(height: 120),
          AppErrorView(
            message: state.message,
            onRetry: () => context.read<ExpensesCubit>().fetch(),
          ),
        ],
      );
    }
    if (state is ExpensesLoaded) {
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _hero(state),
          const SizedBox(height: 12),
          _chips(state),
          const SizedBox(height: 10),
          _searchField(context),
          const SizedBox(height: 12),
          if (state.expenses.isEmpty)
            AppEmptyView(
              title: _categoryFilter == 'ALL' && _search.text.trim().isEmpty
                  ? 'لا توجد مصاريف'
                  : 'لا نتائج مطابقة للفلاتر الحالية',
              actionLabel: 'مصروف جديد',
              onAction: () => _openExpenseForm(context, state.categories),
            )
          else
            ...state.expenses.map((e) => _expenseCard(context, e)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Widget _hero(ExpensesLoaded state) {
    final stats = state.stats;
    final items = state.expenses;
    final today = DateTime.now();
    final todayTotal = items.fold<double>(
      0,
      (sum, e) {
        final value = e['date'] ?? e['createdAt'];
        final dt = value is DateTime ? value : DateTime.tryParse(value?.toString() ?? '');
        final sameDay = dt != null &&
            dt.year == today.year &&
            dt.month == today.month &&
            dt.day == today.day;
        return sum + (sameDay ? asNum(e['amount']).toDouble() : 0);
      },
    );
    return GradientHeroCard(
      title: 'إجمالي المصاريف',
      value: money(asNum(stats['totalAmount'])),
      icon: Icons.payments_rounded,
      gradient: const LinearGradient(
        colors: [_rose, _roseLight],
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
      ),
      stats: [
        HeroStat('العدد', count(asNum(stats['totalCount'])), Icons.receipt_rounded),
        HeroStat('اليوم', money(todayTotal), Icons.today_rounded),
      ],
    );
  }

  Widget _chips(ExpensesLoaded state) {
    final stats = state.stats;
    final byCategory = (stats['byCategory'] as List?) ?? const [];
    final byId = <String, Map<String, dynamic>>{};
    for (final entry in byCategory.whereType<Map>()) {
      final map = Map<String, dynamic>.from(entry);
      final id = map['categoryId']?.toString();
      if (id != null && id.isNotEmpty) byId[id] = map;
    }
    final chips = <StatusChip>[
      StatusChip(
        label: 'الكل',
        count: asNum(stats['totalCount']).toInt(),
        color: _rose,
        value: 'ALL',
      ),
    ];
    for (final category in state.categories) {
      final id = category['id']?.toString();
      if (id == null || id.isEmpty) continue;
      final usage =
          byId[id]?['count'] ?? ((category['_count'] as Map?)?['expenses'] as num?);
      chips.add(StatusChip(
        label: category['name']?.toString() ?? 'بند',
        count: asNum(usage).toInt(),
        color: _roseLight,
        value: id,
      ));
    }
    return StatusChipBar(
      selected: _categoryFilter,
      onSelected: (value) => setState(() {
        _categoryFilter = value;
        context.read<ExpensesCubit>().fetch(categoryId: value);
      }),
      chips: chips,
    );
  }

  Widget _searchField(BuildContext context) {
    return TextField(
      controller: _search,
      onSubmitted: (value) => context.read<ExpensesCubit>().fetch(search: value),
      decoration: InputDecoration(
        hintText: 'بحث بالملاحظات أو بند المصروف...',
        hintStyle: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
        prefixIcon: const Icon(Icons.search_rounded),
        suffixIcon: IconButton(
          icon: const Icon(Icons.filter_alt_rounded),
          tooltip: 'بحث',
          onPressed: () =>
              context.read<ExpensesCubit>().fetch(search: _search.text),
        ),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsetsDirectional.symmetric(vertical: 10),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
      ),
    );
  }

  Widget _expenseCard(BuildContext context, Map<String, dynamic> e) {
    final category = e['category'] as Map?;
    final treasury = e['treasury'] as Map?;
    final journal = e['journalEntry'] as Map?;
    final isPosted = journal != null && journal['id'] != null;
    return EntityCard(
      leadingIcon: Icons.payments_rounded,
      iconColor: _rose,
      title: e['categoryName']?.toString() ??
          category?['name']?.toString() ??
          'مصروف',
      badge: EntityBadge(isPosted ? 'مقيد ماليًا' : 'غير مقيد',
          isPosted ? AppColors.info : AppColors.statusPlanned),
      subtitle: date(e['date'] ?? e['createdAt']),
      amount: money(asNum(e['amount'])),
      amountColor: _rose,
      meta: treasury?['name']?.toString(),
      expandRows: [
        ExpandRow('البند', e['categoryName']?.toString() ?? '—'),
        if (treasury != null)
          ExpandRow('الخزينة', treasury['name']?.toString() ?? '—')
        else
          const ExpandRow('الخزينة', 'بلا خزينة — سجل بلا قيد'),
        if (journal != null && journal['code'] != null)
          ExpandRow('القيد المالي', journal['code'].toString()),
        if (e['notes'] != null) ExpandRow('ملاحظات', e['notes'].toString()),
        ExpandRow('أنشئ في', dateTime(e['createdAt'])),
      ],
      actions: [
        EntityAction(
          'حذف',
          Icons.delete_rounded,
          () => _confirmDelete(context, e),
          color: AppColors.error,
        ),
      ],
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    Map<String, dynamic> e,
  ) async {
    final cubit = context.read<ExpensesCubit>();
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف المصروف',
      message: _isPosted(e)
          ? 'سيُعكس القيد المالي وتُعاد قيمة الخصم لرصيد الخزينة داخل معاملة '
              'واحدة. هل تريد الحذف؟'
          : 'سيُحذف سجل المصروف (بلا أثر مالي). هل تريد الحذف؟',
      confirmLabel: 'حذف',
    );
    if (confirmed && mounted) {
      await _run(
        this.context,
        cubit.deleteExpense(e['id']?.toString() ?? ''),
        'تم حذف المصروف',
      );
    }
  }

  /// هل المصروف مقيد ماليًا؟ (لرسالة التأكيد — الحذف يعكس القيد).
  bool _isPosted(Map<String, dynamic> e) {
    final journal = e['journalEntry'] as Map?;
    return journal != null && journal['id'] != null;
  }

  // ===================== تبويب البنود =====================

  Widget _categoriesTab(BuildContext context, ExpensesState state) {
    if (state is ExpensesLoading || state is ExpensesInitial) {
      return const Center(
        child: AppLoadingView(message: 'جاري تحميل البنود...'),
      );
    }
    if (state is ExpensesError) {
      return Center(
        child: AppErrorView(
          message: state.message,
          onRetry: () => context.read<ExpensesCubit>().fetch(),
        ),
      );
    }
    if (state is ExpensesLoaded) {
      if (state.categories.isEmpty) {
        return Center(
          child: AppEmptyView(
            title: 'لا توجد بنود مصاريف',
            actionLabel: 'إضافة بند',
            onAction: () => _openCategoryForm(context),
          ),
        );
      }
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          ...state.categories.map((c) => _categoryCard(context, c)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Widget _categoryCard(BuildContext context, Map<String, dynamic> c) {
    final usage = ((c['_count'] as Map?)?['expenses'] as num?)?.toInt() ?? 0;
    return EntityCard(
      leadingIcon: Icons.category_rounded,
      iconColor: _roseLight,
      title: c['name']?.toString() ?? 'بند',
      badge: EntityBadge(usage > 0 ? '$usage مصروف' : 'غير مستخدم',
          usage > 0 ? AppColors.info : AppColors.statusPlanned),
      subtitle: c['isActive'] == false ? 'بند موقوف' : 'بند مصروف',
      expandRows: [
        if (c['notes'] != null) ExpandRow('ملاحظات', c['notes'].toString()),
        ExpandRow('الاستخدام', '$usage مصروف'),
      ],
      actions: [
        EntityAction(
          'تعديل',
          Icons.edit_rounded,
          () => _editCategory(context, c),
          color: AppColors.info,
        ),
        // الحذف ممنوع للبنود المستخدمة (Restrict خادمي) — يظهر فقط للفارغة.
        if (usage == 0)
          EntityAction(
            'حذف',
            Icons.delete_rounded,
            () => _confirmDeleteCategory(context, c),
            color: AppColors.error,
          ),
      ],
    );
  }

  Future<void> _editCategory(
    BuildContext context,
    Map<String, dynamic> c,
  ) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => ExpenseCategoryFormDialog(existing: c),
    );
    if (saved == true && context.mounted) {
      await context.read<ExpensesCubit>().fetch();
    }
  }

  Future<void> _confirmDeleteCategory(
    BuildContext context,
    Map<String, dynamic> c,
  ) async {
    final cubit = context.read<ExpensesCubit>();
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف البند ${c['name'] ?? ''}',
      message: 'البند غير مستخدم في أي مصروف. هل تريد الحذف؟',
      confirmLabel: 'حذف',
    );
    if (confirmed && mounted) {
      await _run(
        this.context,
        cubit.deleteCategory(c['id']?.toString() ?? ''),
        'تم حذف البند',
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
