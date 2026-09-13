import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart';
import '../../../../core/widgets/selim/status_chip_bar.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/cutting_cubit.dart';

/// شاشة القص — نسخة الجوال من CuttingOrders في Selim ERP.
///
/// تبويبان (TabBar):
/// 1. «أوامر القص»: شريط شرائح الحالة (الكل/مسودة/مفعّل/معكوس) + بطاقة
///    العنوان (إجمالي القطع) + بطاقات الأوامر: رقم المستند CUT-0001 +
///    المنتج + إجمالي القطع + إجمالي الأجر + شارة الحالة؛ التوسيع
///    يكشف البنود (اللون بنقطة + المقاس + الرقصات × القطع = الكمية)
///    وإجراءات التفعيل/العكس (كلٌّ بحسب الحالة وبتأكيد).
/// 2. «الإعدادات»: مدير الألوان (نقطة hex + حذف منطقي + إضافة بتحقق
///    #RRGGBB) ومدير مجموعات المقاسات (رقائق المقاسات + حذف منطقي).
///
/// الزر العائم (في تبويب الأوامر فقط) يفتح حوار الإنشاء: منتج + مخزن +
///    عامل اختياري + أجر القطعة + محرر بنود (لون/مقاس/رقصات/قطع لكل
///    رقصة) + ملاحظات — الكميات والإجماليات تُحسب على الخادم.
///
/// ملاحظة عقد: وحدة الخادم لا تقدم حذفًا لأوامر القص (العكس هو مسار
/// التراجع المعتمد) — لذلك لا يعرض التطبيق إجراء حذف للأوامر.
class CuttingScreen extends StatefulWidget {
  const CuttingScreen({super.key});

  @override
  State<CuttingScreen> createState() => _CuttingScreenState();
}

class _CuttingScreenState extends State<CuttingScreen>
    with SingleTickerProviderStateMixin {
  /// الأرجواني المميز لوحدة القص في Selim.
  static const _magenta = Color(0xFFAD1457);

  late final TabController _tabController;
  String _filter = 'ALL';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    // إعادة البناء عند تبديل التبويب ليظهر/يختفي زر الإنشاء (سياقي).
    _tabController.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => CuttingCubit()
        ..fetchOrders()
        ..fetchSettings(),
      child: BlocBuilder<CuttingCubit, CuttingState>(
        builder: (context, state) {
          final cubit = context.read<CuttingCubit>();
          final onOrdersTab = _tabController.index == 0;
          return SelimShellScaffold(
            title: 'القص والتعبئة',
            fab: onOrdersTab
                ? FloatingActionButton.extended(
                    onPressed: () => _showCreateDialog(context, cubit),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text(
                      'أمر قص جديد',
                      style: TextStyle(
                        fontFamily: 'Cairo',
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  )
                : null,
            body: Column(
              children: [
                Material(
                  color: Colors.white,
                  child: TabBar(
                    controller: _tabController,
                    labelColor: _magenta,
                    unselectedLabelColor: Colors.grey.shade600,
                    indicatorColor: _magenta,
                    labelStyle: const TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                    ),
                    tabs: const [
                      Tab(
                        icon: Icon(Icons.content_cut_rounded),
                        text: 'أوامر القص',
                      ),
                      Tab(
                        icon: Icon(Icons.tune_rounded),
                        text: 'الإعدادات',
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      RefreshIndicator(
                        onRefresh: () async {
                          await cubit.fetchOrders();
                        },
                        child: _ordersBody(context, state),
                      ),
                      RefreshIndicator(
                        onRefresh: () => cubit.fetchSettings(),
                        child: _settingsBody(context, state),
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

  // -------------------------------------------------------------------
  // تبويب أوامر القص
  // -------------------------------------------------------------------

  Widget _ordersBody(BuildContext context, CuttingState state) {
    if (state is CuttingLoading || state is CuttingInitial) {
      return const AppLoadingView(message: 'جاري تحميل أوامر القص...');
    }
    if (state is CuttingError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<CuttingCubit>().fetchOrders(),
      );
    }
    if (state is CuttingLoaded) {
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _hero(state),
          const SizedBox(height: 12),
          _chips(context, state),
          const SizedBox(height: 12),
          if (state.orders.isEmpty)
            const _EmptyOrders()
          else
            ...state.orders.map((order) => _orderCard(context, state, order)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  /// بطاقة العنوان: إجمالي القطع المحمّلة داخل المرشح.
  Widget _hero(CuttingLoaded state) {
    return GradientHeroCard(
      title: 'إجمالي القطع في المرشح',
      value: '${qty(state.totalPieces)} قطعة',
      icon: Icons.content_cut_rounded,
      gradient: const LinearGradient(
        colors: [_magenta, Color(0xFFD81B60)],
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
      ),
      stats: [
        HeroStat('الأوامر', count(state.ordersTotal), Icons.list_alt_rounded),
        HeroStat('أجر القص', money(state.totalWages), Icons.payments_rounded),
        HeroStat('مفعّلة', count(state.countOf('ACTIVE')), Icons.check_circle_rounded),
      ],
    );
  }

  Widget _chips(BuildContext context, CuttingLoaded state) {
    return StatusChipBar(
      selected: _filter,
      onSelected: (value) {
        setState(() => _filter = value);
        context.read<CuttingCubit>().fetchOrders(status: value);
      },
      chips: [
        StatusChip(label: 'الكل', count: state.ordersTotal, color: _magenta, value: 'ALL'),
        StatusChip(
          label: 'مسودة',
          count: state.countOf('DRAFT'),
          color: AppColors.statusPlanned,
          value: 'DRAFT',
        ),
        StatusChip(
          label: 'مفعّل',
          count: state.countOf('ACTIVE'),
          color: AppColors.success,
          value: 'ACTIVE',
        ),
        StatusChip(
          label: 'معكوس',
          count: state.countOf('REVERSED'),
          color: AppColors.error,
          value: 'REVERSED',
        ),
      ],
    );
  }

  /// بطاقة أمر قص واحدة.
  Widget _orderCard(
    BuildContext context,
    CuttingLoaded loaded,
    Map<String, dynamic> order,
  ) {
    final status = order['status']?.toString() ?? 'DRAFT';
    final product = order['product'];
    final worker = order['worker'];
    final warehouse = order['warehouse'];
    final productName =
        (product is Map ? product['name'] : null)?.toString() ?? 'موديل';
    final workerName = worker is Map ? worker['name']?.toString() : null;
    final warehouseName =
        warehouse is Map ? warehouse['name']?.toString() : null;
    final lines = (order['lines'] as List?) ?? const [];
    return EntityCard(
      leadingIcon: Icons.content_cut_rounded,
      iconColor: _statusColor(status),
      title: productName,
      badge: EntityBadge(_statusLabel(status), _statusColor(status)),
      subtitle: '${order['docNumber'] ?? ''} · ${date(order['date'])}',
      amount: money(asNum(order['wageTotal'])),
      meta:
          '${count(asNum(order['totalPieces']))} قطعة · ${count(lines.length)} بندًا',
      expandRows: [
        ExpandRow('إجمالي القطع', '${qty(asNum(order['totalPieces']))} قطعة'),
        if (warehouseName != null) ExpandRow('المخزن', warehouseName),
        if (workerName != null) ExpandRow('عامل القص', workerName),
        if (order['wagePerPiece'] != null)
          ExpandRow('أجر القطعة', money(asNum(order['wagePerPiece']))),
        if (asNum(order['remnantQty']) > 0)
          ExpandRow('البواقي', qty(asNum(order['remnantQty']))),
        if (order['reversedAt'] != null)
          ExpandRow('تاريخ العكس', date(order['reversedAt'])),
        if (order['notes'] != null)
          ExpandRow('ملاحظات', order['notes'].toString()),
      ],
      // بنود الرقصات: نقطة اللون + المقاس + الرقصات × القطع = الكمية.
      expandChildren: [
        _linesSection(loaded, lines),
      ],
      actions: _actionsFor(context, order, status),
    );
  }

  /// قسم بنود أمر القص داخل التوسيع.
  Widget _linesSection(CuttingLoaded loaded, List<dynamic> lines) {
    if (lines.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(14, 4, 14, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 1),
          const SizedBox(height: 8),
          const Text(
            'بنود القص (الرقصات)',
            style: TextStyle(
              fontFamily: 'Cairo',
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          ...lines.whereType<Map>().map(
                (raw) => _lineRow(
                  loaded,
                  Map<String, dynamic>.from(raw),
                ),
              ),
        ],
      ),
    );
  }

  /// صف بند واحد: اللون (نقطة) + المقاس + layCount×piecesPerLay = quantity.
  Widget _lineRow(CuttingLoaded loaded, Map<String, dynamic> line) {
    final hex = _hexFor(loaded, line);
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 3),
      child: Row(
        children: [
          Container(
            width: 14,
            height: 14,
            decoration: BoxDecoration(
              color: hex ?? Colors.grey.shade300,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.grey.shade300),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              line['color']?.toString() ?? 'بلا لون',
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
            ),
          ),
          Text(
            'مقاس ${line['size']?.toString() ?? '—'}',
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
          ),
          const SizedBox(width: 10),
          Directionality(
            textDirection: TextDirection.ltr,
            child: Text(
              '${qty(asNum(line['layCount']))} × ${qty(asNum(line['piecesPerLay']))} = ${qty(asNum(line['quantity']))}',
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.primary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// لون النقطة: نبحث hex من إعدادات الألوان بالمعرف أو بالاسم — القائمة
  /// الخادمية تحمل لقطة اسم اللون فقط، فالإعدادات مرجع hex المتاح.
  Color? _hexFor(CuttingLoaded loaded, Map<String, dynamic> line) {
    final colorId = line['colorId']?.toString();
    final colorName = line['color']?.toString();
    for (final color in loaded.colors) {
      final id = color['id']?.toString();
      final name = color['name']?.toString();
      if ((colorId != null && id == colorId) ||
          (colorName != null && name == colorName)) {
        return _parseHex(color['hex']?.toString());
      }
    }
    return _parseHex(colorName != null && colorName.startsWith('#') ? colorName : null);
  }

  List<EntityAction> _actionsFor(
    BuildContext context,
    Map<String, dynamic> order,
    String status,
  ) {
    final cubit = context.read<CuttingCubit>();
    final id = order['id']?.toString() ?? '';
    final actions = <EntityAction>[];
    if (status == 'DRAFT') {
      actions.add(
        EntityAction(
          'تفعيل',
          Icons.play_circle_fill_rounded,
          () => _confirmActivate(context, cubit, id,
              order['docNumber']?.toString() ?? ''),
          color: AppColors.success,
        ),
      );
    }
    if (status == 'ACTIVE') {
      actions.add(
        EntityAction(
          'عكس',
          Icons.undo_rounded,
          () => _confirmReverse(context, cubit, id,
              order['docNumber']?.toString() ?? ''),
          color: AppColors.error,
        ),
      );
    }
    return actions;
  }

  /// تفعيل أمر مسودة: صرف رصيد الموديل المصدر + إدخال التوليفات + أجر
  /// العامل في معاملة واحدة (الخادم يختار أكبر رصيد مصدر تلقائيًا).
  Future<void> _confirmActivate(
    BuildContext context,
    CuttingCubit cubit,
    String id,
    String docNumber,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'تفعيل أمر القص $docNumber',
      message:
          'سيُخصم رصيد الموديل المصدر (أكبر رصيد تلقائيًا) وتُدخل توليفات '
          'القص (لون×مقاس) بمخزون تام، ويُسجَّل أجر عامل القص إن وُجد — كلها '
          'في معاملة واحدة. هل تريد التفعيل؟',
      confirmLabel: 'تفعيل',
    );
    if (!confirmed || !mounted) return;
    final messenger = ScaffoldMessenger.of(this.context);
    final ok = await cubit.activate(id);
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تم تفعيل أمر القص وتحديث المخزون' : null);
  }

  /// عكس أمر مفعّل: رد كل الحركات من دفتر المخزون وحذف سجل الأجر.
  Future<void> _confirmReverse(
    BuildContext context,
    CuttingCubit cubit,
    String id,
    String docNumber,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'عكس أمر القص $docNumber',
      message:
          'ستُسترد كل حركات المخزون من دفتر القص ويُحذف سجل أجر العامل — '
          'يعود الأمر قابلًا لإعادة التفعيل بعد التصحيح. هل تريد العكس؟',
      confirmLabel: 'عكس',
    );
    if (!confirmed || !mounted) return;
    final messenger = ScaffoldMessenger.of(this.context);
    final ok = await cubit.reverse(id);
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تم عكس أمر القص ورد الحركات' : null);
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'ACTIVE':
        return AppColors.success;
      case 'REVERSED':
        return AppColors.error;
      case 'DRAFT':
      default:
        return AppColors.statusPlanned;
    }
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'ACTIVE':
        return 'مفعّل';
      case 'REVERSED':
        return 'معكوس';
      case 'DRAFT':
      default:
        return 'مسودة';
    }
  }

  // -------------------------------------------------------------------
  // تبويب الإعدادات (الألوان + مجموعات المقاسات)
  // -------------------------------------------------------------------

  Widget _settingsBody(BuildContext context, CuttingState state) {
    if (state is CuttingInitial) {
      return const AppLoadingView(message: 'جاري تحميل الإعدادات...');
    }
    final loaded = state is CuttingLoaded ? state : null;
    return ListView(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
      children: [
        _colorsSection(context, loaded),
        const SizedBox(height: 16),
        _sizeGroupsSection(context, loaded),
      ],
    );
  }

  /// مدير الألوان: قائمة بنقاط hex + إضافة + حذف منطقي.
  Widget _colorsSection(BuildContext context, CuttingLoaded? loaded) {
    final colors = loaded?.colors ?? const [];
    return Card(
      elevation: 0.5,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.palette_rounded,
                    size: 18, color: _magenta),
                const SizedBox(width: 6),
                const Text(
                  'الألوان',
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: () =>
                      _showAddColorDialog(context, context.read<CuttingCubit>()),
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('لون جديد'),
                ),
              ],
            ),
            if (colors.isEmpty)
              const Text(
                'لا توجد ألوان — أضف لونًا بصيغة #RRGGBB لاستخدامه في بنود القص',
                style: TextStyle(fontFamily: 'Cairo', fontSize: 12, color: Colors.grey),
              )
            else
              ...colors.map((color) => _colorTile(context, color)),
          ],
        ),
      ),
    );
  }

  Widget _colorTile(BuildContext context, Map<String, dynamic> color) {
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 3),
      child: Row(
        children: [
          Container(
            width: 18,
            height: 18,
            decoration: BoxDecoration(
              color: _parseHex(color['hex']?.toString()) ?? Colors.grey,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.grey.shade300),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              color['name']?.toString() ?? 'لون',
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
            ),
          ),
          Directionality(
            textDirection: TextDirection.ltr,
            child: Text(
              color['hex']?.toString() ?? '',
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 11.5,
                color: Colors.grey.shade500,
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline_rounded,
                size: 20, color: AppColors.error),
            tooltip: 'حذف',
            onPressed: () =>
                _confirmDeleteColor(context, context.read<CuttingCubit>(), color),
          ),
        ],
      ),
    );
  }

  /// حوار إضافة لون: اسم + كود hex بتحقق النمط #RRGGBB.
  Future<void> _showAddColorDialog(
    BuildContext context,
    CuttingCubit cubit,
  ) async {
    final name = TextEditingController();
    final hex = TextEditingController(text: '#');
    final messenger = ScaffoldMessenger.of(context);
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('لون جديد'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: name,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'اسم اللون (فريد)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: hex,
              decoration: const InputDecoration(
                labelText: 'الكود hex',
                hintText: '#1F3A93',
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
            child: const Text('إضافة'),
          ),
        ],
      ),
    );
    if (saved != true || !mounted) return;
    final hexValue = hex.text.trim();
    if (name.text.trim().isEmpty ||
        !RegExp(r'^#[0-9A-Fa-f]{6}$').hasMatch(hexValue)) {
      _snack(messenger, cubit, null,
          fallback: 'كود اللون يجب أن يكون بصيغة #RRGGBB مثل #1F3A93');
      return;
    }
    final ok =
        await cubit.createColor(name: name.text.trim(), hex: hexValue);
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تمت إضافة اللون' : null);
  }

  Future<void> _confirmDeleteColor(
    BuildContext context,
    CuttingCubit cubit,
    Map<String, dynamic> color,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف اللون',
      message:
          'حذف منطقي — التوليفات القديمة تُبقي مرجعها. هل تريد حذف '
          '${color['name'] ?? 'اللون'}؟',
      confirmLabel: 'حذف',
    );
    if (!confirmed || !mounted) return;
    final messenger = ScaffoldMessenger.of(this.context);
    final ok = await cubit.deleteColor(color['id']?.toString() ?? '');
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تم حذف اللون' : null);
  }

  /// مدير مجموعات المقاسات: اسم + رقائق المقاسات + إضافة + حذف منطقي.
  Widget _sizeGroupsSection(BuildContext context, CuttingLoaded? loaded) {
    final groups = loaded?.sizeGroups ?? const [];
    return Card(
      elevation: 0.5,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.straighten_rounded,
                    size: 18, color: _magenta),
                const SizedBox(width: 6),
                const Text(
                  'مجموعات المقاسات',
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: () => _showAddSizeGroupDialog(
                    context,
                    context.read<CuttingCubit>(),
                  ),
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('مجموعة جديدة'),
                ),
              ],
            ),
            if (groups.isEmpty)
              const Text(
                'لا توجد مجموعات — أضف مجموعة مثل «شبابي: S M L XL»',
                style: TextStyle(fontFamily: 'Cairo', fontSize: 12, color: Colors.grey),
              )
            else
              ...groups.map((group) => _sizeGroupTile(context, group)),
          ],
        ),
      ),
    );
  }

  Widget _sizeGroupTile(BuildContext context, Map<String, dynamic> group) {
    final sizes = (group['sizes'] as List?) ?? const [];
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  group['name']?.toString() ?? 'مجموعة',
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: sizes
                      .map(
                        (size) => Container(
                          padding: const EdgeInsetsDirectional.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: _magenta.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            size.toString(),
                            style: const TextStyle(
                              fontFamily: 'Cairo',
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: _magenta,
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline_rounded,
                size: 20, color: AppColors.error),
            tooltip: 'حذف',
            onPressed: () => _confirmDeleteSizeGroup(
              context,
              context.read<CuttingCubit>(),
              group,
            ),
          ),
        ],
      ),
    );
  }

  /// حوار إضافة مجموعة: اسم + مقاسات مفصولة بفواصل.
  Future<void> _showAddSizeGroupDialog(
    BuildContext context,
    CuttingCubit cubit,
  ) async {
    final name = TextEditingController();
    final sizes = TextEditingController(text: 'S M L XL');
    final messenger = ScaffoldMessenger.of(context);
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('مجموعة مقاسات جديدة'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: name,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'اسم المجموعة (فريد)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: sizes,
              decoration: const InputDecoration(
                labelText: 'المقاسات (مفصولة بمسافة أو فاصلة)',
                hintText: 'S M L XL',
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
            child: const Text('إضافة'),
          ),
        ],
      ),
    );
    if (saved != true || !mounted) return;
    final parsed = sizes.text
        .split(RegExp(r'[,\s]+'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    if (name.text.trim().isEmpty || parsed.isEmpty) {
      _snack(messenger, cubit, null,
          fallback: 'أدخل اسم المجموعة ومقاسًا واحدًا على الأقل');
      return;
    }
    final ok = await cubit.createSizeGroup(
      name: name.text.trim(),
      sizes: parsed,
    );
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تمت إضافة المجموعة' : null);
  }

  Future<void> _confirmDeleteSizeGroup(
    BuildContext context,
    CuttingCubit cubit,
    Map<String, dynamic> group,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف مجموعة المقاسات',
      message:
          'حذف منطقي. هل تريد حذف ${group['name'] ?? 'المجموعة'}؟',
      confirmLabel: 'حذف',
    );
    if (!confirmed || !mounted) return;
    final messenger = ScaffoldMessenger.of(this.context);
    final ok = await cubit.deleteSizeGroup(group['id']?.toString() ?? '');
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تم حذف المجموعة' : null);
  }

  // -------------------------------------------------------------------
  // حوار إنشاء أمر قص
  // -------------------------------------------------------------------

  Future<void> _showCreateDialog(BuildContext context, CuttingCubit cubit) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _CreateCuttingOrderDialog(cubit: cubit),
    );
  }

  /// رسالة موحدة: نجاح، أو خطأ الإجراء من الخادم إن وُجد.
  void _snack(
    ScaffoldMessengerState messenger,
    CuttingCubit cubit,
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

/// تحليل كود hex (#RRGGBB) إلى Color — يُعاد null عند الصيغة غير الصالحة.
Color? _parseHex(String? hex) {
  if (hex == null) return null;
  final clean = hex.startsWith('#') ? hex.substring(1) : hex;
  if (clean.length != 6) return null;
  final value = int.tryParse(clean, radix: 16);
  if (value == null) return null;
  return Color(0xFF000000 | value);
}

class _EmptyOrders extends StatelessWidget {
  const _EmptyOrders();

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0.5,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(24),
        child: Column(
          children: [
            const Icon(Icons.content_cut_rounded,
                size: 48, color: AppColors.textHint),
            const SizedBox(height: 10),
            const Text(
              'لا توجد أوامر قص في هذا المرشح',
              style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'أنشئ أمر قص جديدًا من الزر العائم — المسودة تخطيط بلا حركات',
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

/// حوار إنشاء أمر قص — نموذج كامل بعقد CreateCuttingOrderDto:
/// منتج (إلزامي) + مخزن (إلزامي) + عامل اختياري (يلزم لأجر القطعة) +
/// أجر القطعة + محرر بنود الرقصات (لون/مقاس/رقصات/قطع لكل رقصة) +
/// ملاحظات. الكميات والإجماليات تُحسب على الخادم — لا يرسل العميل
/// الكميات (قاعدة مجال مشتركة).
class _CreateCuttingOrderDialog extends StatefulWidget {
  const _CreateCuttingOrderDialog({required this.cubit});

  final CuttingCubit cubit;

  @override
  State<_CreateCuttingOrderDialog> createState() =>
      _CreateCuttingOrderDialogState();
}

class _CreateCuttingOrderDialogState extends State<_CreateCuttingOrderDialog> {
  List<Map<String, dynamic>> _products = const [];
  List<Map<String, dynamic>> _warehouses = const [];
  List<Map<String, dynamic>> _workers = const [];
  final List<_CutLineDraft> _lines = [];
  bool _loadingLookups = true;
  bool _saving = false;

  String? _productId;
  String? _warehouseId;
  String? _workerId;
  final _wagePerPiece = TextEditingController();
  final _notes = TextEditingController();

  @override
  void initState() {
    super.initState();
    _lines.add(_CutLineDraft());
    _loadLookups();
  }

  /// المنتجات/المخازن/العمال تُجلب لحظة الحوار — فشلها يعرض رسالة ويترك
  /// الحوار قادرًا على الإغلاق (إعادة المحاولة بإعادة الفتح).
  Future<void> _loadLookups() async {
    final cubit = widget.cubit;
    List<Map<String, dynamic>> products = const [];
    List<Map<String, dynamic>> warehouses = const [];
    List<Map<String, dynamic>> workers = const [];
    try {
      products = await cubit.fetchProducts();
    } catch (_) {}
    try {
      warehouses = await cubit.fetchWarehouses();
    } catch (_) {}
    try {
      workers = await cubit.fetchWorkers();
    } catch (_) {}
    if (!mounted) return;
    setState(() {
      _products = products;
      _warehouses = warehouses;
      _workers = workers;
      _loadingLookups = false;
    });
  }

  @override
  void dispose() {
    _wagePerPiece.dispose();
    _notes.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('أمر قص جديد'),
      content: SizedBox(
        width: double.maxFinite,
        child: _loadingLookups
            ? const SizedBox(
                height: 200,
                child: Center(child: CircularProgressIndicator()),
              )
            : SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _dropdown(
                      label: 'الموديل المقصوص',
                      icon: Icons.checkroom_rounded,
                      value: _productId,
                      items: _products,
                      onChanged: (v) => setState(() => _productId = v),
                    ),
                    const SizedBox(height: 12),
                    _dropdown(
                      label: 'المخزن',
                      icon: Icons.warehouse_rounded,
                      value: _warehouseId,
                      items: _warehouses,
                      onChanged: (v) => setState(() => _warehouseId = v),
                    ),
                    const SizedBox(height: 12),
                    _workerField(),
                    const SizedBox(height: 12),
                    _linesEditor(),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _notes,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: 'ملاحظات (اختياري)',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ],
                ),
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.content_cut_rounded),
          label: const Text('إنشاء الأمر'),
        ),
      ],
    );
  }

  Widget _dropdown({
    required String label,
    required IconData icon,
    required String? value,
    required List<Map<String, dynamic>> items,
    required ValueChanged<String?> onChanged,
  }) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        border: const OutlineInputBorder(),
      ),
      items: items
          .map(
            (item) => DropdownMenuItem<String>(
              value: item['id']?.toString(),
              child: Text(item['name']?.toString() ?? '—'),
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }

  /// عامل القص اختياري — يلزم مع أجر القطعة لحساب أمر الأجر.
  Widget _workerField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<String?>(
          initialValue: _workerId,
          isExpanded: true,
          decoration: const InputDecoration(
            labelText: 'عامل القص (اختياري)',
            prefixIcon: Icon(Icons.person_rounded),
            border: OutlineInputBorder(),
          ),
          items: [
            const DropdownMenuItem<String?>(value: null, child: Text('بلا عامل')),
            ..._workers.map(
              (worker) => DropdownMenuItem<String?>(
                value: worker['id']?.toString(),
                child: Text(worker['name']?.toString() ?? 'عامل'),
              ),
            ),
          ],
          onChanged: (v) => setState(() => _workerId = v),
        ),
        if (_workerId != null) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _wagePerPiece,
            keyboardType:
                const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'أجر القطعة (ج.م — اختياري مع العامل)',
              border: OutlineInputBorder(),
            ),
          ),
        ],
      ],
    );
  }

  /// محرر بنود الرقصات: صف لكل بند (اللون/المقاس/الرقصات/قطع الرقصة).
  Widget _linesEditor() {
    return Card(
      elevation: 0,
      color: AppColors.inputFill,
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsetsDirectional.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.layers_rounded,
                    size: 16, color: AppColors.primary),
                const SizedBox(width: 6),
                const Text(
                  'بنود القص',
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.add_circle_outline_rounded, size: 20),
                  tooltip: 'بند جديد',
                  onPressed: () =>
                      setState(() => _lines.add(_CutLineDraft())),
                ),
              ],
            ),
            ..._lines.asMap().entries.map(
                  (entry) => _lineTile(entry.key, entry.value),
                ),
          ],
        ),
      ),
    );
  }

  Widget _lineTile(int index, _CutLineDraft line) {
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SizedBox(
                width: 64,
                child: Text(
                  'بند ${index + 1}',
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 11,
                    color: Colors.grey.shade600,
                  ),
                ),
              ),
              Expanded(
                child: TextField(
                  controller: line.color,
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'اللون',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: TextField(
                  controller: line.size,
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'المقاس',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: TextField(
                  controller: line.layCount,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'الرقصات',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: TextField(
                  controller: line.piecesPerLay,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'قطع/رقصة',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              if (_lines.length > 1)
                IconButton(
                  icon: const Icon(Icons.remove_circle_outline_rounded,
                      size: 18, color: AppColors.error),
                  tooltip: 'حذف البند',
                  onPressed: () => setState(() {
                    line.dispose();
                    _lines.remove(line);
                  }),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _save() async {
    if (_productId == null || _warehouseId == null) {
      _toast('اختر الموديل والمخزن أولًا', isError: true);
      return;
    }
    final lines = <Map<String, dynamic>>[];
    for (final line in _lines) {
      final layCount = int.tryParse(line.layCount.text);
      final piecesPerLay = int.tryParse(line.piecesPerLay.text);
      final size = line.size.text.trim();
      final color = line.color.text.trim();
      if (size.isEmpty || layCount == null || layCount < 1 ||
          piecesPerLay == null || piecesPerLay < 1) {
        _toast('أكمل بنود القص: المقاس والرقصات وقطع الرقصة لكل بند', isError: true);
        return;
      }
      lines.add({
        if (color.isNotEmpty) 'color': color,
        'size': size,
        'layCount': layCount,
        'piecesPerLay': piecesPerLay,
      });
    }
    if (lines.isEmpty) {
      _toast('أمر القص يتطلب بندًا واحدًا على الأقل', isError: true);
      return;
    }
    final wage = double.tryParse(_wagePerPiece.text);
    setState(() => _saving = true);
    final ok = await widget.cubit.createOrder({
      'productId': _productId,
      'warehouseId': _warehouseId,
      if (_workerId != null) 'workerId': _workerId,
      if (_workerId != null && wage != null && wage > 0)
        'wagePerPiece': wage,
      'lines': lines,
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
    });
    if (!mounted) return;
    setState(() => _saving = false);
    _toast(ok ? 'تم إنشاء أمر القص (مسودة)' : null,
        isError: !ok,
        fallback: widget.cubit.lastActionError ?? 'تعذر إنشاء الأمر');
    if (ok && mounted) Navigator.of(context).pop();
  }

  void _toast(String? message, {bool isError = false, String? fallback}) {
    final text = message ?? fallback ?? 'تعذر تنفيذ العملية';
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(text, style: const TextStyle(fontFamily: 'Cairo')),
          backgroundColor: isError ? AppColors.error : AppColors.success,
        ),
      );
  }
}

/// مسودة بند قص قبل الحفظ (لون/مقاس/رقصات/قطع لكل رقصة).
class _CutLineDraft {
  final color = TextEditingController();
  final size = TextEditingController();
  final layCount = TextEditingController();
  final piecesPerLay = TextEditingController();

  void dispose() {
    color.dispose();
    size.dispose();
    layCount.dispose();
    piecesPerLay.dispose();
  }
}
