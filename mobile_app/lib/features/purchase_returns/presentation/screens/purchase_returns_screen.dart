import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart';
import '../../../../core/widgets/selim/status_chip_bar.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/purchase_returns_cubit.dart';
import 'purchase_return_form_screen.dart';

/// شاشة مرتجعات المشتريات (SELIM-ERP W1) — بنمط شاشات Selim:
///
/// 1. بطاقة العنوان المتدرجة البرتقالية: إجمالي قيمة المرتجعات + العدد
///    + مرتجعات اليوم + طريقتا الاسترداد.
/// 2. شريط شرائح طريقة الاسترداد (الكل / إشعار دائن / نقدي) — فلترة على
///    العميل لأن الخادم لا يوفر مرشح refundMethod (عقد SELIM-B1).
/// 3. حقل بحث (رقم المرتجع / اسم المورد) → يمرر search للخادم.
/// 4. بطاقات كيانات قابلة للتوسيع بإجراء حذف (يعكس القيد ويستعيد
///    المخزون خادميًا — confirmAppAction قبل التنفيذ).
class PurchaseReturnsScreen extends StatefulWidget {
  const PurchaseReturnsScreen({super.key});

  @override
  State<PurchaseReturnsScreen> createState() => _PurchaseReturnsScreenState();
}

class _PurchaseReturnsScreenState extends State<PurchaseReturnsScreen> {
  final _search = TextEditingController();
  String _filter = 'ALL';

  /// اللون المميز للوحدة — برتقالي داكن (نفس لونها في درج الأقسام).
  static const _orange = Color(0xFFE65100);

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => PurchaseReturnsCubit()..fetch(),
      child: BlocBuilder<PurchaseReturnsCubit, PurchaseReturnsState>(
        builder: (context, state) {
          return SelimShellScaffold(
            title: 'مرتجع المشتريات',
            fab: FloatingActionButton.extended(
              // نموذج ملء الشاشة عبر Navigator (المسار ليس جزءًا من الروتر —
              // الفورم موديول داخل الوحدة) — نفس سلوك نماذج الحوار في Selim.
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<bool>(
                  fullscreenDialog: true,
                  builder: (_) => const PurchaseReturnFormScreen(),
                ),
              ),
              icon: const Icon(Icons.assignment_return_rounded),
              label: const Text(
                'مرتجع جديد',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            body: RefreshIndicator(
              onRefresh: () =>
                  context.read<PurchaseReturnsCubit>().fetch(),
              child: _body(context, state),
            ),
          );
        },
      ),
    );
  }

  Widget _body(BuildContext context, PurchaseReturnsState state) {
    if (state is PurchaseReturnsLoading || state is PurchaseReturnsInitial) {
      return const AppLoadingView(message: 'جاري تحميل المرتجعات...');
    }
    if (state is PurchaseReturnsError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<PurchaseReturnsCubit>().fetch(),
      );
    }
    if (state is PurchaseReturnsLoaded) {
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _hero(state),
          const SizedBox(height: 12),
          _chips(state),
          const SizedBox(height: 10),
          _searchField(context),
          const SizedBox(height: 12),
          if (state.returns.isEmpty)
            AppEmptyView(
              title: _filter == 'ALL' && _search.text.trim().isEmpty
                  ? 'لا توجد مرتجعات مشتريات'
                  : 'لا نتائج مطابقة للفلاتر الحالية',
              actionLabel: 'إنشاء مرتجع',
              onAction: () => Navigator.of(context).push(
                MaterialPageRoute<bool>(
                  fullscreenDialog: true,
                  builder: (_) => const PurchaseReturnFormScreen(),
                ),
              ),
            )
          else
            ...state.returns.map((r) => _returnCard(context, r)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Widget _hero(PurchaseReturnsLoaded state) {
    final stats = state.stats;
    return GradientHeroCard(
      title: 'إجمالي قيمة مرتجعات المشتريات',
      value: money(asNum(stats['totalValue'])),
      icon: Icons.assignment_return_rounded,
      gradient: const LinearGradient(
        colors: [Color(0xFFE65100), Color(0xFFFB8C00)],
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
      ),
      stats: [
        HeroStat('عدد المرتجعات', count(asNum(stats['total'])),
            Icons.receipt_long_rounded),
        HeroStat('مرتجعات اليوم', count(asNum(stats['todayCount'])),
            Icons.today_rounded),
        HeroStat(
          'استرداد نقدي',
          count(asNum(stats['cashCount'])),
          Icons.payments_rounded,
        ),
      ],
    );
  }

  Widget _chips(PurchaseReturnsLoaded state) {
    final stats = state.stats;
    return StatusChipBar(
      selected: _filter,
      onSelected: (value) => setState(() {
        _filter = value;
        context.read<PurchaseReturnsCubit>().fetch(refundMethod: value);
      }),
      chips: [
        StatusChip(
          label: 'الكل',
          count: asNum(stats['total']).toInt(),
          color: _orange,
          value: 'ALL',
        ),
        StatusChip(
          label: 'إشعار دائن',
          count: asNum(stats['creditCount']).toInt(),
          color: AppColors.info,
          value: 'credit',
        ),
        StatusChip(
          label: 'استرداد نقدي',
          count: asNum(stats['cashCount']).toInt(),
          color: AppColors.success,
          value: 'cash',
        ),
      ],
    );
  }

  Widget _searchField(BuildContext context) {
    return TextField(
      controller: _search,
      onSubmitted: (value) => context.read<PurchaseReturnsCubit>().fetch(search: value),
      decoration: InputDecoration(
        hintText: 'بحث برقم المرتجع أو اسم المورد...',
        hintStyle: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
        prefixIcon: const Icon(Icons.search_rounded),
        suffixIcon: IconButton(
          icon: const Icon(Icons.filter_alt_rounded),
          tooltip: 'بحث',
          onPressed: () =>
              context.read<PurchaseReturnsCubit>().fetch(search: _search.text),
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

  Widget _returnCard(BuildContext context, Map<String, dynamic> r) {
    final method = r['refundMethod']?.toString() ?? 'credit';
    final isCash = method == 'cash';
    final itemsCount =
        ((r['_count'] as Map?)?['items'] as num?)?.toInt() ??
        (r['items'] as List?)?.length ??
        0;
    final po = r['purchaseOrder'] as Map?;
    final journal = r['journalEntry'] as Map?;
    return EntityCard(
      leadingIcon: Icons.assignment_return_rounded,
      iconColor: isCash ? AppColors.success : _orange,
      title: r['supplierName']?.toString() ?? r['supplier']?['name']?.toString() ?? 'مورد',
      badge: EntityBadge(isCash ? 'استرداد نقدي' : 'إشعار دائن',
          isCash ? AppColors.success : AppColors.info),
      subtitle: '${r['returnNumber'] ?? ''} · ${date(r['date'] ?? r['createdAt'])}',
      amount: money(asNum(r['total'])),
      meta: itemsCount > 0
          ? '$itemsCount بندًا · ${po?['code']?.toString() ?? ''}'
          : po?['code']?.toString(),
      expandRows: [
        ExpandRow('مجموع البنود', money(asNum(r['subtotal']))),
        ExpandRow('الخصم', money(asNum(r['discountAmount']))),
        ExpandRow('الضريبة', money(asNum(r['taxAmount']))),
        ExpandRow('أمر الشراء', po?['code']?.toString() ?? '—'),
        ExpandRow('إعادة للمخزون', (r['restockItems'] as bool? ?? true) ? 'نعم' : 'لا'),
        if (journal != null && journal['code'] != null)
          ExpandRow('القيد المالي', journal['code'].toString()),
        if (r['reason'] != null) ExpandRow('السبب', r['reason'].toString()),
        if (r['notes'] != null) ExpandRow('ملاحظات', r['notes'].toString()),
      ],
      actions: [
        EntityAction(
          'حذف',
          Icons.delete_rounded,
          () => _confirmDelete(context, r),
          color: AppColors.error,
        ),
      ],
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    Map<String, dynamic> r,
  ) async {
    final cubit = context.read<PurchaseReturnsCubit>();
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف المرتجع ${r['returnNumber'] ?? ''}',
      message:
          'سيُعكس القيد المالي وتُستعاد الكميات للمخزن داخل معاملة واحدة. هل تريد الحذف؟',
      confirmLabel: 'حذف',
    );
    if (confirmed && mounted) {
      await _run(this.context, cubit.delete(r['id']?.toString() ?? ''),
          'تم حذف المرتجع واستعادة المخزون');
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
