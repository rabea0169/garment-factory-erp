import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart' show HeroStat;
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/financial_reports_cubit.dart';

/// شاشة التقارير المالية — نسخة الجوال من financial-reports في Selim ERP.
///
/// أربعة تبويبات (TabBar): قائمة الدخل / الميزانية العمومية / ضريبة
/// VAT / أعمار الذمم، فوق رأس نطاق زمني مشترك (منتقيا from/to + زر
/// استعلام؛ و asOf وحيد للتقارير اللحظية: الميزانية وأعمار الذمم).
///
/// كل تقرير يُحمّل قسمه المستقل من الكيوبت: خطأ تبويب لا يُسقط البقية.
/// كل الحسابات من دفتر القيود على الخادم — الشاشة عرض صرف:
/// - قائمة الدخل: إيرادات (خضراء) − مصروفات (حمراء) = صافي الربح.
/// - الميزانية: أصول/التزامات/حقوق ملكية + فحص التوازن (متوازنة/فرق X).
/// - VAT: بطاقات المخرجات/المدخلات/الصافي + المبيعات الخاضعة.
/// - أعمار الذمم: AR/AP + بطاقات الدلاء الأربع + صفوف العملاء/الموردين.
class FinancialReportsScreen extends StatefulWidget {
  const FinancialReportsScreen({super.key});

  @override
  State<FinancialReportsScreen> createState() =>
      _FinancialReportsScreenState();
}

class _FinancialReportsScreenState extends State<FinancialReportsScreen>
    with SingleTickerProviderStateMixin {
  /// الأزرق المميز لوحدة التقارير المالية في Selim.
  static const _blue = Color(0xFF1565C0);

  late final TabController _tabController;

  /// الكيوبت مملوك للـ State — مستمع التبويبات يحتاجه خارج شجرة
  /// BlocProvider (السياق أعلاه لا يرى مزودًا)، فيُنشأ هنا ويُقدم
  /// للشجرة عبر BlocProvider.value ويُغلق في dispose.
  late final FinancialReportsCubit _cubit;

  // رأس النطاق المشترك: من/إلى للتقارير الدورية، وasOf للتقارير اللحظية.
  late final TextEditingController _from;
  late final TextEditingController _to;
  late final TextEditingController _asOf;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    final now = DateTime.now();
    _from = TextEditingController(
      text: DateTime(now.year, now.month, 1).toIso8601String().substring(0, 10),
    );
    _to = TextEditingController(
      text: now.toIso8601String().substring(0, 10),
    );
    _asOf = TextEditingController(
      text: now.toIso8601String().substring(0, 10),
    );
    // أول تقرير يُحمّل عند الفتح؛ تبديل التبويب يحمّل تقريره إن لم يُحمّل.
    _cubit = FinancialReportsCubit()
      ..fetchIncomeStatement(from: _from.text, to: _to.text);
    _tabController.addListener(_onTabChanged);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _cubit.close();
    _from.dispose();
    _to.dispose();
    _asOf.dispose();
    super.dispose();
  }

  void _onTabChanged() {
    if (!mounted || _tabController.indexIsChanging) return;
    _fetchCurrent(_cubit, force: false);
    setState(() {});
  }

  /// تحميل تقرير التبويب الحالي — الزر يجبر إعادة الاستعلام، أما تبديل
  /// التبويب فيحمّل تقريره مرة واحدة فقط (لا يعيد الضغط على الخادم).
  void _fetchCurrent(FinancialReportsCubit cubit, {required bool force}) {
    final state = cubit.state;
    final loaded = state is FinancialReportsLoaded ? state : null;
    switch (_tabController.index) {
      case 0:
        if (force || loaded?.incomeStatement == null) {
          cubit.fetchIncomeStatement(from: _from.text, to: _to.text);
        }
      case 1:
        if (force || loaded?.balanceSheet == null) {
          cubit.fetchBalanceSheet(asOf: _asOf.text);
        }
      case 2:
        if (force || loaded?.vatReport == null) {
          cubit.fetchVatReport(from: _from.text, to: _to.text);
        }
      case 3:
        if (force || loaded?.agingReport == null) {
          cubit.fetchAging(asOf: _asOf.text);
        }
    }
  }

  /// هل التبويب الحالي لحظي (asOf) أم دوري (من/إلى)؟
  bool get _isInstantTab => _tabController.index == 1 || _tabController.index == 3;

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: BlocBuilder<FinancialReportsCubit, FinancialReportsState>(
        builder: (context, state) {
          final cubit = _cubit;
          return SelimShellScaffold(
            title: 'التقارير المالية',
            body: Column(
              children: [
                _rangeHeader(context, cubit),
                Material(
                  color: Colors.white,
                  child: TabBar(
                    controller: _tabController,
                    isScrollable: true,
                    labelColor: _blue,
                    unselectedLabelColor: Colors.grey.shade600,
                    indicatorColor: _blue,
                    labelStyle: const TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                    ),
                    tabs: const [
                      Tab(text: 'قائمة الدخل'),
                      Tab(text: 'الميزانية'),
                      Tab(text: 'ضريبة VAT'),
                      Tab(text: 'أعمار الذمم'),
                    ],
                  ),
                ),
                Expanded(
                  child: state is FinancialReportsLoading
                      ? const AppLoadingView(message: 'جاري تحميل التقرير...')
                      : TabBarView(
                          controller: _tabController,
                          children: [
                            _incomeTab(context, cubit),
                            _balanceSheetTab(context, cubit),
                            _vatTab(context, cubit),
                            _agingTab(context, cubit),
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

  // -------------------------------------------------------------------
  // رأس النطاق الزمني المشترك
  // -------------------------------------------------------------------

  Widget _rangeHeader(BuildContext context, FinancialReportsCubit cubit) {
    return Card(
      elevation: 0.5,
      margin: const EdgeInsetsDirectional.fromSTEB(16, 10, 16, 4),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(10, 8, 10, 8),
        child: Row(
          children: [
            if (_isInstantTab) ...[
              Expanded(child: _dateField(controller: _asOf, label: 'تاريخ التقييم')),
            ] else ...[
              Expanded(child: _dateField(controller: _from, label: 'من تاريخ')),
              const SizedBox(width: 8),
              Expanded(child: _dateField(controller: _to, label: 'إلى تاريخ')),
            ],
            const SizedBox(width: 8),
            FilledButton.icon(
              onPressed: () => _fetchCurrent(cubit, force: true),
              icon: const Icon(Icons.query_stats_rounded, size: 18),
              label: const Text('استعلام'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dateField({
    required TextEditingController controller,
    required String label,
  }) {
    return TextFormField(
      controller: controller,
      readOnly: true,
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: DateTime.tryParse(controller.text) ?? DateTime.now(),
          firstDate: DateTime(2020),
          lastDate: DateTime(DateTime.now().year + 2),
        );
        if (picked != null) {
          setState(() => controller.text = picked.toIso8601String().substring(0, 10));
        }
      },
      style: const TextStyle(fontFamily: 'Cairo', fontSize: 12.5),
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        prefixIcon: const Icon(Icons.event_rounded, size: 18),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  // -------------------------------------------------------------------
  // تبويب قائمة الدخل
  // -------------------------------------------------------------------

  Widget _incomeTab(BuildContext context, FinancialReportsCubit cubit) {
    final state = cubit.state;
    final loaded = state is FinancialReportsLoaded ? state : null;
    final report = loaded?.incomeStatement;
    return _tabBody(
      sectionKey: kIncomeSection,
      loaded: loaded,
      child: () {
        final revenues =
            _rowsOf(report, 'revenues');
        final expenses = _rowsOf(report, 'expenses');
        return ListView(
          padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
          children: [
            _summaryCard(
              title: 'صافي الربح',
              value: money(asNum(report?['netIncome'])),
              valueColor: asNum(report?['netIncome']) >= 0
                  ? AppColors.success
                  : AppColors.error,
              stats: [
                HeroStat('الإيرادات', money(asNum(report?['totalRevenues'])),
                    Icons.trending_up_rounded),
                HeroStat('المصروفات', money(asNum(report?['totalExpenses'])),
                    Icons.trending_down_rounded),
                HeroStat('الصافي', money(asNum(report?['netIncome'])),
                    Icons.calculate_rounded),
              ],
            ),
            const SizedBox(height: 12),
            _sectionTitle('الإيرادات', AppColors.success),
            if (revenues.isEmpty)
              const _EmptySection(message: 'لا توجد إيرادات في الفترة')
            else
              ...revenues.map((row) => _reportRow(row, AppColors.success)),
            const SizedBox(height: 12),
            _sectionTitle('المصروفات', AppColors.error),
            if (expenses.isEmpty)
              const _EmptySection(message: 'لا توجد مصروفات في الفترة')
            else
              ...expenses.map((row) => _reportRow(row, AppColors.error)),
          ],
        );
      },
    );
  }

  // -------------------------------------------------------------------
  // تبويب الميزانية العمومية
  // -------------------------------------------------------------------

  Widget _balanceSheetTab(BuildContext context, FinancialReportsCubit cubit) {
    final state = cubit.state;
    final loaded = state is FinancialReportsLoaded ? state : null;
    final report = loaded?.balanceSheet;
    return _tabBody(
      sectionKey: kBalanceSheetSection,
      loaded: loaded,
      child: () {
        final balanced = report?['checkAssetsEqualLiabilitiesEquity'] == true;
        final difference = asNum(report?['difference']);
        return ListView(
          padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
          children: [
            _summaryCard(
              title: 'إجمالي الأصول',
              value: money(asNum(report?['totalAssets'])),
              valueColor: _blue,
              stats: [
                HeroStat('الالتزامات', money(asNum(report?['totalLiabilities'])),
                    Icons.account_balance_rounded),
                HeroStat('حقوق الملكية', money(asNum(report?['totalEquity'])),
                    Icons.savings_rounded),
                HeroStat(
                  'صافي الربح التراكمي',
                  money(asNum(report?['retainedEarnings'])),
                  Icons.trending_up_rounded,
                ),
              ],
            ),
            const SizedBox(height: 12),
            // فحص التوازن: الأصول = الالتزامات + حقوق الملكية.
            _balanceCheckCard(balanced, difference),
            const SizedBox(height: 12),
            _sectionTitle('الأصول', _blue),
            _rowsList(_rowsOf(report, 'assets'), 'لا توجد أصول بآرصدة'),
            const SizedBox(height: 12),
            _sectionTitle('الالتزامات', AppColors.warning),
            _rowsList(
              _rowsOf(report, 'liabilities'),
              'لا توجد التزامات بآرصدة',
              color: AppColors.warning,
            ),
            const SizedBox(height: 12),
            _sectionTitle('حقوق الملكية', AppColors.success),
            _rowsList(
              _rowsOf(report, 'equity'),
              'لا توجد حقوق ملكية بآرصدة',
              color: AppColors.success,
            ),
          ],
        );
      },
    );
  }

  Widget _balanceCheckCard(bool balanced, num difference) {
    return Card(
      elevation: 0,
      color: (balanced ? AppColors.success : AppColors.error).withValues(alpha: 0.08),
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(14, 10, 14, 10),
        child: Row(
          children: [
            Icon(
              balanced ? Icons.check_circle_rounded : Icons.error_rounded,
              color: balanced ? AppColors.success : AppColors.error,
              size: 22,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                balanced
                    ? 'الميزانية متوازنة — الأصول = الالتزامات + حقوق الملكية'
                    : 'الميزانية غير متوازنة — الفرق ${money(difference)}',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: balanced ? AppColors.success : AppColors.error,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // تبويب ضريبة القيمة المضافة
  // -------------------------------------------------------------------

  Widget _vatTab(BuildContext context, FinancialReportsCubit cubit) {
    final state = cubit.state;
    final loaded = state is FinancialReportsLoaded ? state : null;
    final report = loaded?.vatReport;
    return _tabBody(
      sectionKey: kVatSection,
      loaded: loaded,
      child: () {
        final salesOrders = report?['salesOrders'];
        final salesCount = salesOrders is Map ? asNum(salesOrders['count']) : 0;
        final salesTotal = salesOrders is Map ? asNum(salesOrders['total']) : 0;
        return ListView(
          padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
          children: [
            _summaryCard(
              title: 'صافي الضريبة المستحقة للهيئة',
              value: money(asNum(report?['netVat'])),
              valueColor: AppColors.warning,
              stats: [
                HeroStat('مخرجات VAT', money(asNum(report?['outputVat'])),
                    Icons.call_made_rounded),
                HeroStat('مدخلات VAT', money(asNum(report?['inputVat'])),
                    Icons.call_received_rounded),
                HeroStat('مبيعات خاضعة', money(asNum(report?['vatableSales'])),
                    Icons.receipt_rounded),
              ],
            ),
            const SizedBox(height: 12),
            Card(
              elevation: 0.5,
              margin: EdgeInsets.zero,
              shape:
                  RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: Padding(
                padding: const EdgeInsetsDirectional.all(14),
                child: Column(
                  children: [
                    _kvRow('ضريبة المخرجات (المبيعات)',
                        money(asNum(report?['outputVat']))),
                    _kvRow(
                        'ضريبة المدخلات', money(asNum(report?['inputVat']))),
                    _kvRow('المشتريات الخاضعة',
                        money(asNum(report?['vatablePurchases']))),
                    _kvRow('عدد أوامر البيع الخاضعة', count(salesCount)),
                    _kvRow('إجمالي أوامر البيع', money(salesTotal)),
                    _kvRow('الصافي المستحق', money(asNum(report?['netVat'])),
                        bold: true),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  // -------------------------------------------------------------------
  // تبويب أعمار الذمم
  // -------------------------------------------------------------------

  Widget _agingTab(BuildContext context, FinancialReportsCubit cubit) {
    final state = cubit.state;
    final loaded = state is FinancialReportsLoaded ? state : null;
    final report = loaded?.agingReport;
    return _tabBody(
      sectionKey: kAgingSection,
      loaded: loaded,
      child: () {
        final buckets = report?['buckets'];
        final isAR = (loaded?.agingType ?? 'AR') == 'AR';
        final rows = _rowsOf(report, isAR ? 'customers' : 'suppliers');
        return ListView(
          padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
          children: [
            // مبدّل AR/AP: عملاء (مدينون) / موردون (دائنون).
            Row(
              children: [
                Expanded(
                  child: ChoiceChip(
                    label: const Text('ذمم العملاء (AR)'),
                    selected: isAR,
                    onSelected: (_) => cubit.fetchAging(
                      type: 'AR',
                      asOf: _asOf.text,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ChoiceChip(
                    label: const Text('ذمم الموردين (AP)'),
                    selected: !isAR,
                    onSelected: (_) => cubit.fetchAging(
                      type: 'AP',
                      asOf: _asOf.text,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _summaryCard(
              title: 'إجمالي ${isAR ? 'ذمم العملاء' : 'ذمم الموردين'}',
              value: money(asNum(report?['total'])),
              valueColor: AppColors.error,
              stats: [
                HeroStat('غير مخصص', money(asNum(report?['unallocated'])),
                    Icons.help_outline_rounded),
                HeroStat(
                  'أقدم من 90 يومًا',
                  money(asNum(buckets is Map ? buckets['90+'] : null)),
                  Icons.warning_rounded,
                ),
                HeroStat('عدد الأطراف', count(rows.length),
                    Icons.groups_rounded),
              ],
            ),
            const SizedBox(height: 12),
            // بطاقات الدلاء الأربع.
            Row(
              children: [
                Expanded(
                  child: _bucketCard('0-30', asNum(buckets is Map ? buckets['0-30'] : null),
                      AppColors.success),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _bucketCard('31-60', asNum(buckets is Map ? buckets['31-60'] : null),
                      AppColors.info),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: _bucketCard('61-90', asNum(buckets is Map ? buckets['61-90'] : null),
                      AppColors.warning),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _bucketCard('90+', asNum(buckets is Map ? buckets['90+'] : null),
                      AppColors.error),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (rows.isEmpty)
              const _EmptySection(message: 'لا توجد أرصدة قائمة')
            else
              ...rows.map((row) => _agingRow(row)),
          ],
        );
      },
    );
  }

  /// صف طرف (عميل/مورد) مع شارة دلو العمر ورصيده.
  Widget _agingRow(Map<String, dynamic> row) {
    final bucket = row['bucket']?.toString();
    final color = switch (bucket) {
      '0-30' => AppColors.success,
      '31-60' => AppColors.info,
      '61-90' => AppColors.warning,
      '90+' => AppColors.error,
      _ => AppColors.statusPlanned,
    };
    return Card(
      elevation: 0.5,
      margin: const EdgeInsetsDirectional.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(12, 10, 12, 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    row['name']?.toString() ?? 'طرف',
                    style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    bucket == null
                        ? 'رصيد غير مخصص (بلا أمر مفتوح قابل للتأريخ)'
                        : 'أقدم أمر مفتوح: ${date(row['oldestOpenDate'])}',
                    style: TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 10.5,
                      color: Colors.grey.shade500,
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding:
                  const EdgeInsetsDirectional.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                bucket ?? '—',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Directionality(
              textDirection: TextDirection.ltr,
              child: Text(
                money(asNum(row['balance'])),
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // عناصر مشتركة
  // -------------------------------------------------------------------

  /// جسم تبويب موحد: سبينر أثناء تحميل القسم، أو خطأ القسم مع إعادة
  /// المحاولة، أو محتوى التقرير (كل قسم مستقل — فشل أحدها لا يمس البقية).
  Widget _tabBody({
    required String sectionKey,
    required FinancialReportsLoaded? loaded,
    required Widget Function() child,
  }) {
    if (loaded == null) {
      return const AppLoadingView(message: 'جاري تحميل التقرير...');
    }
    if (loaded.loadingSections.contains(sectionKey)) {
      return const AppLoadingView(message: 'جاري تحميل التقرير...');
    }
    final error = loaded.sectionErrors[sectionKey];
    if (error != null) {
      return AppErrorView(message: error, onRetry: () {
        _fetchCurrent(context.read<FinancialReportsCubit>(), force: true);
      });
    }
    return child();
  }

  /// بطاقة شبيهة ببطاقة العنوان لكن مسطحة (تقرير — لا تدرجات صارخة).
  Widget _summaryCard({
    required String title,
    required String value,
    required Color valueColor,
    required List<HeroStat> stats,
  }) {
    return Card(
      elevation: 0.5,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 14, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12.5,
                color: Colors.grey.shade600,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Directionality(
              textDirection: TextDirection.ltr,
              child: SizedBox(
                width: double.infinity,
                child: Text(
                  value,
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    color: valueColor,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: stats.take(3).map((stat) => _summaryStat(stat)).toList(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryStat(HeroStat stat) {
    return Expanded(
      child: Padding(
        padding: const EdgeInsetsDirectional.only(start: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              stat.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 10.5,
                color: Colors.grey.shade600,
              ),
            ),
            Directionality(
              textDirection: TextDirection.ltr,
              child: SizedBox(
                width: double.infinity,
                child: Text(
                  stat.value,
                  textAlign: TextAlign.right,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bucketCard(String label, num amount, Color color) {
    return Card(
      elevation: 0.5,
      color: color.withValues(alpha: 0.06),
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(10, 10, 10, 10),
        child: Column(
          children: [
            Text(
              '$label يومًا',
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
            const SizedBox(height: 4),
            Directionality(
              textDirection: TextDirection.ltr,
              child: Text(
                money(amount),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionTitle(String title, Color color) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(bottom: 6),
      child: Row(
        children: [
          Container(
            width: 4,
            height: 16,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            title,
            style: TextStyle(
              fontFamily: 'Cairo',
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  /// صف حساب تقريري: الكود + الاسم + المبلغ (أخضر إيرادًا / أحمر مصروفًا).
  Widget _reportRow(Map<String, dynamic> row, Color color) {
    return Card(
      elevation: 0,
      margin: const EdgeInsetsDirectional.only(bottom: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(10, 8, 10, 8),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsetsDirectional.symmetric(
                horizontal: 6,
                vertical: 2,
              ),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                row['code']?.toString() ?? '',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: Colors.grey.shade600,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                row['name']?.toString() ?? 'حساب',
                style: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
              ),
            ),
            Directionality(
              textDirection: TextDirection.ltr,
              child: Text(
                money(asNum(row['amount'])),
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _rowsList(List<Map<String, dynamic>> rows, String emptyMessage,
      {Color color = _blue}) {
    if (rows.isEmpty) {
      return _EmptySection(message: emptyMessage);
    }
    return Column(
      children: rows.map((row) => _reportRow(row, color)).toList(),
    );
  }

  Widget _kvRow(String label, String value, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12.5,
                color: Colors.grey.shade700,
                fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
          Directionality(
            textDirection: TextDirection.ltr,
            child: Text(
              value,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 13,
                fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
                color: bold ? AppColors.warning : Colors.black87,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// صفوف قسم من استجابة التقرير (revenues/expenses/assets/...).
  List<Map<String, dynamic>> _rowsOf(Map<String, dynamic>? report, String key) {
    final raw = report?[key];
    if (raw is List) {
      return raw
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList(growable: false);
    }
    return const [];
  }
}

class _EmptySection extends StatelessWidget {
  const _EmptySection({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsetsDirectional.all(16),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: 'Cairo',
            fontSize: 12,
            color: Colors.grey.shade500,
          ),
        ),
      ),
    );
  }
}
