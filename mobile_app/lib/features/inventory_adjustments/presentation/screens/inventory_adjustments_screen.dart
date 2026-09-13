import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart';
import '../../../../core/widgets/selim/status_chip_bar.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/inventory_adjustments_cubit.dart';
import 'inventory_adjustment_form_screen.dart';

/// شاشة تسويات الجرد (SELIM-ERP W1) — بنمط شاشات Selim:
///
/// 1. بطاقة العنوان المتدرجة التركوازية (عدد التسويات + المسودات
///    والمعتمدة).
/// 2. شريط شرائح الحالة: الكل / مسودة / معتمد / مرفوض — يمرر status
///    كمرشح استعلام للخادم.
/// 3. بطاقات كيانات قابلة للتوسيع تعرض المخزن والفروق والقيم.
/// 4. إجراءات المسودة: اعتماد (confirm يوضح تعديل أرصدة المخزون وقيود
///    المحاسبة)، رفض بسبب إلزامي، حذف.
///
/// شارات الحالة (نفس ألوان الخادم): DRAFT مسودة (رمادي)، APPROVED معتمد
/// (أخضر)، REJECTED مرفوض (أحمر).
class InventoryAdjustmentsScreen extends StatefulWidget {
  const InventoryAdjustmentsScreen({super.key});

  @override
  State<InventoryAdjustmentsScreen> createState() =>
      _InventoryAdjustmentsScreenState();
}

class _InventoryAdjustmentsScreenState extends State<InventoryAdjustmentsScreen> {
  String _filter = 'ALL';

  /// اللون المميز للوحدة — تركوازي داكن (نفس لونها في درج الأقسام).
  static const _teal = Color(0xFF00838F);

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => InventoryAdjustmentsCubit()..fetch(),
      child: BlocBuilder<InventoryAdjustmentsCubit, InventoryAdjustmentsState>(
        builder: (context, state) {
          return SelimShellScaffold(
            title: 'تسويات الجرد',
            fab: FloatingActionButton.extended(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<bool>(
                  fullscreenDialog: true,
                  builder: (_) => const InventoryAdjustmentFormScreen(),
                ),
              ),
              icon: const Icon(Icons.rule_rounded),
              label: const Text(
                'تسوية جديدة',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            body: RefreshIndicator(
              onRefresh: () =>
                  context.read<InventoryAdjustmentsCubit>().fetch(),
              child: _body(context, state),
            ),
          );
        },
      ),
    );
  }

  Widget _body(BuildContext context, InventoryAdjustmentsState state) {
    if (state is InventoryAdjustmentsLoading ||
        state is InventoryAdjustmentsInitial) {
      return const AppLoadingView(message: 'جاري تحميل التسويات...');
    }
    if (state is InventoryAdjustmentsError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<InventoryAdjustmentsCubit>().fetch(),
      );
    }
    if (state is InventoryAdjustmentsLoaded) {
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _hero(state),
          const SizedBox(height: 12),
          _chips(state),
          const SizedBox(height: 12),
          if (state.adjustments.isEmpty)
            AppEmptyView(
              title: _filter == 'ALL'
                  ? 'لا توجد تسويات جرد'
                  : 'لا توجد تسويات في هذه الحالة',
              actionLabel: 'إنشاء تسوية',
              onAction: () => Navigator.of(context).push(
                MaterialPageRoute<bool>(
                  fullscreenDialog: true,
                  builder: (_) => const InventoryAdjustmentFormScreen(),
                ),
              ),
            )
          else
            ...state.adjustments.map((a) => _adjustmentCard(context, a)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Widget _hero(InventoryAdjustmentsLoaded state) {
    final stats = state.stats;
    return GradientHeroCard(
      title: 'تسويات الجرد',
      value: count(asNum(stats['total'])),
      icon: Icons.rule_rounded,
      gradient: const LinearGradient(
        colors: [_teal, Color(0xFF00ACC1)],
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
      ),
      stats: [
        HeroStat('مسودة', count(asNum(stats['draft'])), Icons.edit_note_rounded),
        HeroStat(
          'معتمدة',
          count(asNum(stats['approved'])),
          Icons.check_circle_rounded,
        ),
        HeroStat('مرفوضة', count(asNum(stats['rejected'])), Icons.cancel_rounded),
      ],
    );
  }

  Widget _chips(InventoryAdjustmentsLoaded state) {
    final stats = state.stats;
    return StatusChipBar(
      selected: _filter,
      onSelected: (value) => setState(() {
        _filter = value;
        context.read<InventoryAdjustmentsCubit>().fetch(status: value);
      }),
      chips: [
        StatusChip(
          label: 'الكل',
          count: asNum(stats['total']).toInt(),
          color: _teal,
          value: 'ALL',
        ),
        StatusChip(
          label: 'مسودة',
          count: asNum(stats['draft']).toInt(),
          color: AppColors.statusPlanned,
          value: 'DRAFT',
        ),
        StatusChip(
          label: 'معتمد',
          count: asNum(stats['approved']).toInt(),
          color: AppColors.success,
          value: 'APPROVED',
        ),
        StatusChip(
          label: 'مرفوض',
          count: asNum(stats['rejected']).toInt(),
          color: AppColors.error,
          value: 'REJECTED',
        ),
      ],
    );
  }

  Widget _adjustmentCard(BuildContext context, Map<String, dynamic> a) {
    final status = a['status']?.toString() ?? 'DRAFT';
    final badge = _badgeFor(status);
    final warehouse = a['warehouse'] as Map?;
    final itemsCount = ((a['_count'] as Map?)?['items'] as num?)?.toInt() ??
        (a['items'] as List?)?.length ??
        0;
    return EntityCard(
      leadingIcon: Icons.rule_rounded,
      iconColor: badge.color,
      title:
          '${a['code']?.toString() ?? ''} · ${warehouse?['name']?.toString() ?? 'مخزن'}',
      badge: badge,
      subtitle: 'جرد ${date(a['date'] ?? a['createdAt'])}',
      meta: itemsCount > 0 ? '$itemsCount بند جرد' : null,
      expandRows: [
        ExpandRow('المخزن', '${warehouse?['code'] ?? ''} · ${warehouse?['name'] ?? '—'}'),
        ExpandRow(
          'أنشئها',
          (a['createdBy'] as Map?)?['name']?.toString() ?? '—',
        ),
        if (status == 'APPROVED')
          ExpandRow('اعتمدها', (a['approvedBy'] as Map?)?['name']?.toString() ?? '—'),
        if (status == 'APPROVED' && a['approvedAt'] != null)
          ExpandRow('وقت الاعتماد', dateTime(a['approvedAt'])),
        if (status == 'REJECTED' && a['rejectedReason'] != null)
          ExpandRow('سبب الرفض', a['rejectedReason'].toString()),
        if (a['notes'] != null) ExpandRow('ملاحظات', a['notes'].toString()),
        ...?_itemsRows(a),
      ],
      actions: _actionsFor(context, a, status),
    );
  }

  /// بنود التسوية عند توفرها (استجابة التفاصيل تحمل items كاملة).
  List<ExpandRow>? _itemsRows(Map<String, dynamic> a) {
    final items = a['items'] as List?;
    if (items == null || items.isEmpty) return null;
    return items
        .whereType<Map>()
        .map((item) {
          final difference = asNum(item['difference']).toDouble();
          final direction = difference > 0
              ? 'زيادة'
              : (difference < 0 ? 'نقص' : 'متطابق');
          return ExpandRow(
            item['itemName']?.toString() ?? 'صنف',
            '$direction ${qty(difference.abs())} ${item['unit']?.toString() ?? ''} · '
                '${money(asNum(item['valueDifference']).abs().toDouble())}',
          );
        })
        .toList();
  }

  List<EntityAction> _actionsFor(
    BuildContext context,
    Map<String, dynamic> a,
    String status,
  ) {
    final id = a['id']?.toString() ?? '';
    final cubit = context.read<InventoryAdjustmentsCubit>();
    final actions = <EntityAction>[];
    if (status == 'DRAFT') {
      actions.add(EntityAction(
        'اعتماد',
        Icons.check_circle_rounded,
        () => _confirmApprove(context, cubit, id, a['code']?.toString() ?? ''),
        color: AppColors.success,
      ));
      actions.add(EntityAction(
        'رفض',
        Icons.cancel_rounded,
        () => _rejectDialog(context, cubit, id),
        color: AppColors.error,
      ));
      actions.add(EntityAction(
        'حذف',
        Icons.delete_rounded,
        () => _confirmDelete(context, cubit, id, a['code']?.toString() ?? ''),
        color: AppColors.statusPlanned,
      ));
    }
    return actions;
  }

  Future<void> _confirmApprove(
    BuildContext context,
    InventoryAdjustmentsCubit cubit,
    String id,
    String code,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'اعتماد التسوية $code',
      message:
          'سيتم تعديل أرصدة المخزون وقيود المحاسبة وفق فروق الجرد — العملية '
          'نهائية ولا يمكن التراجع عنها. هل تريد الاعتماد؟',
      confirmLabel: 'اعتماد',
    );
    if (confirmed && mounted) {
      await _run(this.context, cubit.approve(id), 'تم اعتماد التسوية وترحيل فروقها');
    }
  }

  Future<void> _confirmDelete(
    BuildContext context,
    InventoryAdjustmentsCubit cubit,
    String id,
    String code,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف التسوية $code',
      message: 'يمكن حذف المسودات فقط (بلا أثر مخزوني). هل تريد الحذف؟',
      confirmLabel: 'حذف',
    );
    if (confirmed && mounted) {
      await _run(this.context, cubit.delete(id), 'تم حذف مسودة التسوية');
    }
  }

  /// حوار الرفض — السبب إلزامي في عقد الخادم (RejectAdjustmentDto).
  Future<void> _rejectDialog(
    BuildContext context,
    InventoryAdjustmentsCubit cubit,
    String id,
  ) async {
    final reasonController = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('رفض التسوية'),
        content: TextField(
          controller: reasonController,
          autofocus: true,
          maxLines: 2,
          decoration: const InputDecoration(
            labelText: 'سبب الرفض (إلزامي)',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(reasonController.text.trim()),
            child: const Text('رفض'),
          ),
        ],
      ),
    );
    reasonController.dispose();
    if (reason == null || reason.isEmpty) return;
    if (!mounted) return;
    await _run(this.context, cubit.reject(id, reason), 'تم رفض التسوية');
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

  EntityBadge _badgeFor(String status) {
    switch (status) {
      case 'DRAFT':
        return EntityBadge('مسودة', AppColors.statusPlanned);
      case 'APPROVED':
        return EntityBadge('معتمد', AppColors.success);
      case 'REJECTED':
        return EntityBadge('مرفوض', AppColors.error);
    }
    return EntityBadge(status, AppColors.statusPlanned);
  }
}
