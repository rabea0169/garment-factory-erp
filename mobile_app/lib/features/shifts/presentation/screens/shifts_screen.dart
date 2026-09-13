import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/gradient_hero_card.dart';
import '../../../../core/widgets/selim/status_chip_bar.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/shifts_cubit.dart';

/// شاشة الورديات — نسخة الجوال من إدارة ورديات POS في Selim ERP.
///
/// البنية (نمط كل شاشات Selim الجديدة):
/// 1. بطاقة العنوان المتدرجة بحالة وردية الدرج الحالية (مفتوحة منذ
///    HH:MM أو «لا توجد وردية مفتوحة») مع الافتتاحي وعدد المفتوح الآن.
/// 2. شريط شرائح الحالة (الكل/مفتوحة/مغلقة) بعداداتها.
/// 3. قائمة بطاقات الورديات: الكود + الفاتح + البدء/الإغلاق + الفرق
///    (أخضر زيادة / أحمر عجز) + شارة الحالة.
///
/// الزر العائم سياقي: «فتح وردية» حين لا وردية مفتوحة، و«إنهاء
/// الوردية» حين تكون هناك وردية جارية — وكل الحسابات (المتوقع والفرق)
/// تجري على الخادم داخل معاملة الإغلاق.
class ShiftsScreen extends StatefulWidget {
  const ShiftsScreen({super.key});

  @override
  State<ShiftsScreen> createState() => _ShiftsScreenState();
}

class _ShiftsScreenState extends State<ShiftsScreen> {
  /// الأزرق المخضرّ المميز لوحدة الورديات في Selim.
  static const _teal = Color(0xFF00838F);

  String _filter = 'ALL';

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => ShiftsCubit()..fetch(),
      child: BlocBuilder<ShiftsCubit, ShiftsState>(
        builder: (context, state) {
          final cubit = context.read<ShiftsCubit>();
          final hasOpenShift =
              state is ShiftsLoaded && state.currentShift != null;
          return SelimShellScaffold(
            title: 'الورديات',
            // الزر سياقي: إنهاء الوردية الجارية أو فتح وردية جديدة.
            fab: FloatingActionButton.extended(
              onPressed: () => hasOpenShift
                  ? _showCloseDialog(context, cubit, state.currentShift!)
                  : _showOpenDialog(context, cubit),
              backgroundColor: hasOpenShift ? AppColors.error : _teal,
              icon: Icon(hasOpenShift
                  ? Icons.lock_clock_rounded
                  : Icons.play_arrow_rounded),
              label: Text(
                hasOpenShift ? 'إنهاء الوردية' : 'فتح وردية',
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            body: RefreshIndicator(
              onRefresh: () => cubit.fetch(),
              child: _body(context, state),
            ),
          );
        },
      ),
    );
  }

  Widget _body(BuildContext context, ShiftsState state) {
    if (state is ShiftsLoading || state is ShiftsInitial) {
      return const AppLoadingView(message: 'جاري تحميل الورديات...');
    }
    if (state is ShiftsError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<ShiftsCubit>().fetch(),
      );
    }
    if (state is ShiftsLoaded) {
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _hero(state),
          const SizedBox(height: 12),
          _chips(context, state),
          const SizedBox(height: 12),
          if (state.shifts.isEmpty)
            const _EmptyShifts()
          else
            ...state.shifts.map((shift) => _shiftCard(context, shift)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  /// بطاقة العنوان: حالة وردية الدرج الحالية للمستخدم.
  Widget _hero(ShiftsLoaded state) {
    final current = state.currentShift;
    final String value;
    final List<HeroStat> stats;
    if (current != null) {
      value = 'مفتوحة · منذ ${_clock(current['startTime'])}';
      stats = [
        HeroStat('كود الوردية', current['code']?.toString() ?? '—',
            Icons.tag_rounded),
        HeroStat(
          'الافتتاحي',
          money(asNum(current['startCash'])),
          Icons.account_balance_wallet_rounded,
        ),
        HeroStat('مفتوحة الآن', count(state.openCount), Icons.timer_rounded),
      ];
    } else {
      value = 'لا توجد وردية مفتوحة';
      stats = [
        HeroStat('إجمالي الورديات', count(state.total),
            Icons.schedule_rounded),
        HeroStat('مفتوحة الآن', count(state.openCount), Icons.timer_rounded),
        HeroStat('الافتتاحي', '—', Icons.account_balance_wallet_rounded),
      ];
    }
    return GradientHeroCard(
      title: 'وردية الدرج الحالية',
      value: value,
      icon: Icons.schedule_rounded,
      gradient: const LinearGradient(
        colors: [_teal, Color(0xFF00ACC1)],
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
      ),
      stats: stats,
    );
  }

  Widget _chips(BuildContext context, ShiftsLoaded state) {
    final openCount = state.shifts
        .where((s) => s['status']?.toString() == 'OPEN')
        .length;
    return StatusChipBar(
      selected: _filter,
      onSelected: (value) {
        setState(() => _filter = value);
        context.read<ShiftsCubit>().fetch(status: value);
      },
      chips: [
        StatusChip(
          label: 'الكل',
          count: state.total,
          color: _teal,
          value: 'ALL',
        ),
        StatusChip(
          label: 'مفتوحة',
          count: openCount,
          color: AppColors.success,
          value: 'OPEN',
        ),
        StatusChip(
          label: 'مغلقة',
          count: state.shifts.length - openCount,
          color: AppColors.statusPlanned,
          value: 'CLOSED',
        ),
      ],
    );
  }

  /// بطاقة وردية واحدة: الكود + الفاتح + البدء/الإغلاق + الفرق.
  Widget _shiftCard(BuildContext context, Map<String, dynamic> shift) {
    final status = shift['status']?.toString() ?? 'OPEN';
    final isOpen = status == 'OPEN';
    final difference = asNum(shift['difference']);
    return EntityCard(
      leadingIcon: Icons.schedule_rounded,
      iconColor: isOpen ? _teal : AppColors.statusPlanned,
      title: shift['openedByName']?.toString() ?? 'فاتح الوردية',
      badge: isOpen
          ? EntityBadge('مفتوحة', _teal)
          : const EntityBadge('مغلقة', AppColors.statusPlanned),
      subtitle:
          '${shift['code'] ?? ''} · ${dateTime(shift['startTime'])}',
      // المفتوحة تعرض الافتتاحي؛ والمغلقة تعرض الفرق (أخضر زيادة / أحمر
      // عجز) — نفس دلالة Selim لفرق الدرج.
      amount: isOpen
          ? money(asNum(shift['startCash']))
          : money(difference),
      amountColor: isOpen ? null : (difference >= 0 ? AppColors.success : AppColors.error),
      meta: _durationLabel(shift),
      expandRows: [
        ExpandRow('البدء', dateTime(shift['startTime'])),
        ExpandRow('الإغلاق', dateTime(shift['endTime'])),
        ExpandRow('نقدية الافتتاح', money(asNum(shift['startCash']))),
        if (shift['expectedCash'] != null)
          ExpandRow('المتوقع', money(asNum(shift['expectedCash']))),
        if (shift['endCash'] != null)
          ExpandRow('الفعلي', money(asNum(shift['endCash']))),
        if (!isOpen)
          ExpandRow(
            'الفرق',
            money(difference),
          ),
        if (shift['notes'] != null) ExpandRow('ملاحظات', shift['notes'].toString()),
      ],
    );
  }

  /// مدة الوردية (م) أو زمن الجارية حتى الآن — يظهر تحت العنوان.
  String? _durationLabel(Map<String, dynamic> shift) {
    final start = DateTime.tryParse(shift['startTime']?.toString() ?? '');
    if (start == null) return null;
    final end = DateTime.tryParse(shift['endTime']?.toString() ?? '') ??
        DateTime.now();
    final minutes = end.difference(start).inMinutes;
    if (minutes < 0) return null;
    final hours = minutes ~/ 60;
    final mins = minutes % 60;
    if (hours > 0) return '${count(hours)} س ${count(mins)} د';
    return '${count(mins)} د';
  }

  /// حوار فتح وردية: رصيد افتتاحي رقمي اختياري + ملاحظات.
  Future<void> _showOpenDialog(BuildContext context, ShiftsCubit cubit) async {
    final startCash = TextEditingController(text: '0');
    final notes = TextEditingController();
    try {
      final messenger = ScaffoldMessenger.of(context);
      final ok = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('فتح وردية'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: startCash,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'نقدية الافتتاح (ج.م)',
                  prefixIcon: Icon(Icons.account_balance_wallet_rounded),
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
              child: const Text('فتح'),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;
      final cash = double.tryParse(startCash.text) ?? 0;
      final result = await cubit.open(
        startCash: cash,
        notes: notes.text.trim().isEmpty ? null : notes.text,
      );
      if (!mounted) return;
      _snack(messenger, cubit, result ? 'تم فتح الوردية بنجاح' : null);
    } finally {
      startCash.dispose();
      notes.dispose();
    }
  }

  /// حوار إغلاق الوردية: النقدية الفعلية + الفرق المحسوب حيًّا.
  ///
  /// المتوقع النهائي (الافتتاحي + المبيعات النقدية للوردية) يُحسب على
  /// الخادم لحظة الإغلاق؛ قبلها نعرض الفرق عن الافتتاحي كمرجع حي —
  /// يُطلب GET /shifts/:id لقراءة لقطة الوردية المرتقبة (متوقع إن وُجد
  /// وإلا الافتتاحي) كما في عقد الخدمة.
  Future<void> _showCloseDialog(
    BuildContext context,
    ShiftsCubit cubit,
    Map<String, dynamic> current,
  ) async {
    final id = current['id']?.toString() ?? '';
    final endCash = TextEditingController();
    final notes = TextEditingController();
    final messenger = ScaffoldMessenger.of(context);
    // لقطة الوردية من الخادم (أفضل من نسخة القائمة التي قد تكون قديمة).
    final shift = await cubit.loadShift(id);
    if (!mounted) return;
    final startCash = shift == null
        ? asNum(current['startCash'])
        : asNum(shift['startCash']);
    // المتوقع المرجعي: expectedCash إن حُفظ سابقًا، وإلا الافتتاحي —
    // الفرق النهائي يُحسب خادميًا من مبيعات الوردية الفعلية.
    final reference = shift != null && shift['expectedCash'] != null
        ? asNum(shift['expectedCash'])
        : startCash;
    final ok = await showDialog<bool>(
      context: this.context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('إنهاء الوردية'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _dialogRow('كود الوردية', current['code']?.toString() ?? '—'),
              _dialogRow('الافتتاحي', money(startCash)),
              _dialogRow('المرجع المتوقع*', money(reference)),
              TextField(
                controller: endCash,
                autofocus: true,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setDialogState(() {}),
                decoration: const InputDecoration(
                  labelText: 'النقدية الفعلية المعدودة (ج.م)',
                  prefixIcon: Icon(Icons.point_of_sale_rounded),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              // الفرق الحي عن المرجع — يُحدَّث مع كل ضغطة (أخضر/أحمر).
              Directionality(
                textDirection: TextDirection.ltr,
                child: Text(
                  _liveDifference(endCash.text, reference),
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: (double.tryParse(endCash.text) ?? reference) >= reference
                        ? AppColors.success
                        : AppColors.error,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                '* المتوقع النهائي (الافتتاحي + مبيعات الوردية النقدية) '
                'يُحسب على الخادم لحظة الإغلاق.',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 10.5,
                  color: Colors.grey,
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: notes,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'ملاحظات الإغلاق (اختياري)',
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
              child: const Text('إغلاق الوردية'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final cash = double.tryParse(endCash.text);
    if (cash == null || cash < 0) {
      _snack(messenger, cubit, null, fallback: 'أدخل نقدية الإغلاق الصحيحة');
      return;
    }
    final result = await cubit.closeShift(
      id,
      endCash: cash,
      notes: notes.text.trim().isEmpty ? null : notes.text,
    );
    if (!mounted) return;
    _snack(messenger, cubit, result ? 'تم إغلاق الوردية وحساب الفرق' : null);
  }

  String _liveDifference(String text, num reference) {
    final cash = double.tryParse(text);
    if (cash == null) return 'الفرق: —';
    final diff = cash - reference;
    return 'الفرق عن المرجع: ${money(diff)}';
  }

  Widget _dialogRow(String label, String value) {
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12,
                color: Colors.grey.shade600,
              ),
            ),
          ),
          Expanded(
            child: Directionality(
              textDirection: TextDirection.ltr,
              child: SizedBox(
                width: double.infinity,
                child: Text(
                  value,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// رسالة موحدة: نجاح، أو خطأ الإجراء من الخادم إن وُجد.
  void _snack(
    ScaffoldMessengerState messenger,
    ShiftsCubit cubit,
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
                : (cubit.lastActionError ?? fallback ?? 'تعذر تنفيذ العملية — حاول مجددًا'),
            style: const TextStyle(fontFamily: 'Cairo'),
          ),
          backgroundColor: ok ? AppColors.success : AppColors.error,
          duration: const Duration(seconds: 3),
        ),
      );
  }
}

/// «HH:MM م/ص» — لعرض «مفتوحة منذ 02:30 م» في بطاقة العنوان.
String _clock(Object? value) {
  final dt = value is DateTime
      ? value
      : DateTime.tryParse(value?.toString() ?? '');
  if (dt == null) return '—';
  final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  final minute = dt.minute.toString().padLeft(2, '0');
  return '$hour:$minute ${dt.hour >= 12 ? 'م' : 'ص'}';
}

class _EmptyShifts extends StatelessWidget {
  const _EmptyShifts();

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0.5,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(24),
        child: Column(
          children: [
            const Icon(Icons.schedule_rounded,
                size: 48, color: AppColors.textHint),
            const SizedBox(height: 10),
            const Text(
              'لا توجد ورديات في هذا المرشح',
              style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'افتح وردية من الزر العائم لبدء تتبع درج النقدية',
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
