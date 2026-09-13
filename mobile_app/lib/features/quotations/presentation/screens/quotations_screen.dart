import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart';
import '../../../../core/widgets/selim/status_chip_bar.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/quotations_cubit.dart';

/// شاشة عروض الأسعار — أول شاشات النسخة المقلدة من Selim ERP.
///
/// البنية (نمط كل شاشات Selim الجديدة):
/// 1. بطاقة العنوان المتدرجة (إجمالي القيمة + مؤشرات الحالة).
/// 2. شريط شرائح الحالة بعداداتها (الكل/مسودة/مُرسَل/مقبول/مرفوض/محوّل).
/// 3. حقل بحث (رقم العرض/اسم العميل).
/// 4. قائمة بطاقات كيانات قابلة للتوسيع بإجراءات كاملة.
///
/// الإجراءات: إرسال، قبول، رفض، تحويل لأمر بيع، حذف (مسودة فقط).
class QuotationsScreen extends StatefulWidget {
  const QuotationsScreen({super.key});

  @override
  State<QuotationsScreen> createState() => _QuotationsScreenState();
}

class _QuotationsScreenState extends State<QuotationsScreen> {
  final _search = TextEditingController();
  String _filter = 'ALL';

  static const _indigo = Color(0xFF3949AB);

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => QuotationsCubit()..fetch(),
      child: BlocBuilder<QuotationsCubit, QuotationsState>(
        builder: (context, state) {
          return SelimShellScaffold(
            title: 'عروض الأسعار',
            fab: FloatingActionButton.extended(
              onPressed: () => context.push('/quotations/new'),
              icon: const Icon(Icons.add_rounded),
              label: const Text(
                'عرض جديد',
                style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700),
              ),
            ),
            body: RefreshIndicator(
              onRefresh: () =>
                  context.read<QuotationsCubit>().fetch(),
              child: _body(context, state),
            ),
          );
        },
      ),
    );
  }

  Widget _body(BuildContext context, QuotationsState state) {
    if (state is QuotationsLoading || state is QuotationsInitial) {
      return const AppLoadingView(message: 'جاري تحميل عروض الأسعار...');
    }
    if (state is QuotationsError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<QuotationsCubit>().fetch(),
      );
    }
    if (state is QuotationsLoaded) {
      if (state.quotations.isEmpty) {
        return AppEmptyView(
          title: 'لا توجد عروض أسعار',
          actionLabel: 'إنشاء عرض جديد',
          onAction: () => context.push('/quotations/new'),
        );
      }
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _hero(state),
          const SizedBox(height: 12),
          _chips(state),
          const SizedBox(height: 10),
          _searchField(context),
          const SizedBox(height: 12),
          ...state.quotations.map((q) => _quotationCard(context, q)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Widget _hero(QuotationsLoaded state) {
    final stats = state.stats;
    final byStatus = (stats['byStatus'] as Map<String, dynamic>?) ?? const {};
    int statusCount(String key) =>
        ((byStatus[key] as Map<String, dynamic>?)?['count'] as num?)?.toInt() ?? 0;
    return GradientHeroCard(
      title: 'إجمالي قيمة عروض الأسعار',
      value: money(asNum(stats['totalValue'])),
      icon: Icons.request_quote_rounded,
      gradient: const LinearGradient(
        colors: [Color(0xFF3949AB), Color(0xFF5C6BC0)],
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
      ),
      stats: [
        HeroStat('إجمالي العروض', count(asNum(stats['total'])), Icons.description_rounded),
        HeroStat('مقبولة', count(statusCount('ACCEPTED')), Icons.check_circle_rounded),
        HeroStat('محوّلة لأوامر', count(statusCount('CONVERTED')), Icons.swap_horiz_rounded),
      ],
    );
  }

  Widget _chips(QuotationsLoaded state) {
    final byStatus = (state.stats['byStatus'] as Map<String, dynamic>?) ?? const {};
    int statusCount(String key) =>
        ((byStatus[key] as Map<String, dynamic>?)?['count'] as num?)?.toInt() ?? 0;
    return StatusChipBar(
      selected: _filter,
      onSelected: (value) => setState(() {
        _filter = value;
        context.read<QuotationsCubit>().fetch(status: value);
      }),
      chips: [
        StatusChip(
          label: 'الكل',
          count: asNum(state.stats['total']).toInt(),
          color: const Color(0xFF1565C0),
          value: 'ALL',
        ),
        StatusChip(label: 'مسودة', count: statusCount('DRAFT'), color: AppColors.statusPlanned, value: 'DRAFT'),
        StatusChip(label: 'مُرسَل', count: statusCount('SENT'), color: AppColors.info, value: 'SENT'),
        StatusChip(label: 'مقبول', count: statusCount('ACCEPTED'), color: AppColors.success, value: 'ACCEPTED'),
        StatusChip(label: 'مرفوض', count: statusCount('REJECTED'), color: AppColors.error, value: 'REJECTED'),
        StatusChip(label: 'محوّل', count: statusCount('CONVERTED'), color: _indigo, value: 'CONVERTED'),
      ],
    );
  }

  Widget _searchField(BuildContext context) {
    return TextField(
      controller: _search,
      onSubmitted: (value) => context.read<QuotationsCubit>().fetch(search: value),
      decoration: InputDecoration(
        hintText: 'بحث برقم العرض أو اسم العميل...',
        hintStyle: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
        prefixIcon: const Icon(Icons.search_rounded),
        suffixIcon: IconButton(
          icon: const Icon(Icons.filter_alt_rounded),
          tooltip: 'بحث',
          onPressed: () => context.read<QuotationsCubit>().fetch(search: _search.text),
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

  Widget _quotationCard(BuildContext context, Map<String, dynamic> q) {
    final status = q['status']?.toString() ?? 'DRAFT';
    final badge = _badgeFor(status);
    final itemsCount = (q['items'] as List?)?.length ?? 0;
    return EntityCard(
      leadingIcon: Icons.request_quote_rounded,
      iconColor: badge.color,
      title: q['customerName']?.toString() ?? 'عميل',
      badge: badge,
      subtitle: '${q['quotationNo'] ?? ''} · ${date(q['createdAt'])}',
      amount: money(asNum(q['total'])),
      meta: itemsCount > 0 ? '$itemsCount بندًا' : null,
      expandRows: [
        ExpandRow('المجموع قبل الخصم', money(asNum(q['subtotal']))),
        ExpandRow('الخصم', money(asNum(q['discount']))),
        ExpandRow('الضريبة (${(asNum(q['vatRate']) * 100).toStringAsFixed(0)}%)', money(asNum(q['vatAmount']))),
        if (q['validUntil'] != null) ExpandRow('صالح حتى', date(q['validUntil'])),
        if (q['notes'] != null) ExpandRow('ملاحظات', q['notes'].toString()),
      ],
      actions: _actionsFor(context, q, status),
    );
  }

  List<EntityAction> _actionsFor(BuildContext context, Map<String, dynamic> q, String status) {
    final id = q['id']?.toString() ?? '';
    final cubit = context.read<QuotationsCubit>();
    final actions = <EntityAction>[];
    if (status == 'DRAFT') {
      actions.add(EntityAction(
        'إرسال',
        Icons.send_rounded,
        () => _run(context, cubit.updateStatus(id, 'SENT'), 'تم إرسال العرض'),
        color: AppColors.info,
      ));
      actions.add(EntityAction(
        'حذف',
        Icons.delete_rounded,
        () => _confirmDelete(context, cubit, id),
        color: AppColors.error,
      ));
    }
    if (status == 'SENT') {
      actions.add(EntityAction(
        'قبول',
        Icons.check_circle_rounded,
        () => _run(context, cubit.updateStatus(id, 'ACCEPTED'), 'تم قبول العرض'),
        color: AppColors.success,
      ));
      actions.add(EntityAction(
        'رفض',
        Icons.cancel_rounded,
        () => _run(context, cubit.updateStatus(id, 'REJECTED'), 'تم رفض العرض'),
        color: AppColors.error,
      ));
    }
    if (status == 'ACCEPTED' || status == 'SENT') {
      actions.add(EntityAction(
        'تحويل لأمر بيع',
        Icons.swap_horiz_rounded,
        () => _run(context, cubit.convert(id), 'تم تحويل العرض لأمر بيع'),
        color: _indigo,
      ));
    }
    return actions;
  }

  Future<void> _run(BuildContext context, Future<bool> future, String successMessage) async {
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

  Future<void> _confirmDelete(
    BuildContext context,
    QuotationsCubit cubit,
    String id,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف عرض السعر',
      message: 'يمكن حذف العروض في حالة المسودة فقط. هل تريد الحذف؟',
      confirmLabel: 'حذف',
    );
    if (confirmed && mounted) {
      await _run(this.context, cubit.delete(id), 'تم حذف عرض السعر');
    }
  }

  EntityBadge _badgeFor(String status) {
    switch (status) {
      case 'DRAFT':
        return EntityBadge('مسودة', AppColors.statusPlanned);
      case 'SENT':
        return EntityBadge('مُرسَل', AppColors.info);
      case 'ACCEPTED':
        return EntityBadge('مقبول', AppColors.success);
      case 'REJECTED':
        return EntityBadge('مرفوض', AppColors.error);
      case 'CONVERTED':
        return EntityBadge('محوّل لأمر بيع', _indigo);
    }
    return EntityBadge(status, AppColors.statusPlanned);
  }
}
