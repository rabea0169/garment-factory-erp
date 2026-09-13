import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/entity_card.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/status_chip_bar.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/printing_cubit.dart';

/// شاشة مركز الطباعة — نسخة الجوال من Printing في Selim ERP.
///
/// تبويبان (TabBar):
/// 1. «القوالب»: شريط شرائح نوع المستند (الكل + 8 مستندات) + بطاقات
///    القوالب (الاسم + شارتا المستند/حجم الورق + نجمة الافتراضي) مع
///    إجراءي «تعيين افتراضي» و«حذف» — والزر العائم يهيّئ القوالب
///    العربية (POST /templates/seed idempotent) ويعرض عدد المنشأ.
/// 2. «سجل الطباعة»: سجل التدقيق (نوع المستند + الرقم + المستخدم +
///    القناة + النسخ + شارة إعادة الطباعة + التوقيت).
///
/// ثابت Selim: قالب افتراضي واحد لكل (مستند × حجم ورق) — تعيين
/// الافتراضية يزيلها عن غيره خادميًا داخل معاملة واحدة.
class PrintingScreen extends StatefulWidget {
  const PrintingScreen({super.key});

  @override
  State<PrintingScreen> createState() => _PrintingScreenState();
}

class _PrintingScreenState extends State<PrintingScreen>
    with SingleTickerProviderStateMixin {
  /// البرتقالي المميز لوحدة الطباعة في Selim.
  static const _orange = Color(0xFFE65100);

  late final TabController _tabController;
  String _filter = 'ALL';

  /// الكيوبت مملوك للـ State — مستمع التبويبات يحتاجه خارج شجرة
  /// BlocProvider (السياق أعلاه لا يرى مزودًا)، فيُنشأ هنا ويُقدم
  /// للشجرة عبر BlocProvider.value ويُغلق في dispose.
  late final PrintingCubit _cubit;

  /// أنواع المستندات المدعومة (عقد الوحدة الخادمية) بتسمياتها العربية.
  static const Map<String, String> _documentTypeLabels = {
    'INVOICE': 'فاتورة مبيعات',
    'PURCHASE': 'أمر شراء',
    'PRODUCTION_ORDER': 'أمر إنتاج',
    'MATERIAL_ISSUE': 'إذن صرف خامات',
    'RECEIPT': 'سند قبض',
    'QUOTATION': 'عرض سعر',
    'VOUCHER': 'سند صرف/قبض',
    'CUTTING': 'أمر قص',
  };

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _cubit = PrintingCubit()
      ..fetchTemplates()
      ..fetchLog();
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        // تحميل سجل الطباعة عند دخول تبويبه (تدقيق كسول).
        if (_tabController.index == 1) {
          _cubit.fetchLog();
        }
        if (mounted) setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: BlocBuilder<PrintingCubit, PrintingState>(
        builder: (context, state) {
          final cubit = _cubit;
          final onTemplatesTab = _tabController.index == 0;
          return SelimShellScaffold(
            title: 'مركز الطباعة',
            actions: onTemplatesTab
                ? [
                    IconButton(
                      icon: const Icon(Icons.add_circle_outline_rounded),
                      tooltip: 'قالب جديد',
                      onPressed: () => _showCreateDialog(context, cubit),
                    ),
                  ]
                : null,
            fab: onTemplatesTab
                ? FloatingActionButton.extended(
                    onPressed: () => _confirmSeed(context, cubit),
                    icon: const Icon(Icons.auto_awesome_rounded),
                    label: const Text(
                      'تهيئة القوالب العربية',
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
                    labelColor: _orange,
                    unselectedLabelColor: Colors.grey.shade600,
                    indicatorColor: _orange,
                    labelStyle: const TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                    ),
                    tabs: const [
                      Tab(
                        icon: Icon(Icons.print_rounded),
                        text: 'القوالب',
                      ),
                      Tab(
                        icon: Icon(Icons.history_rounded),
                        text: 'سجل الطباعة',
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      RefreshIndicator(
                        onRefresh: () => cubit.fetchTemplates(),
                        child: _templatesBody(context, state),
                      ),
                      RefreshIndicator(
                        onRefresh: () => cubit.fetchLog(),
                        child: _logBody(context, state),
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
  // تبويب القوالب
  // -------------------------------------------------------------------

  Widget _templatesBody(BuildContext context, PrintingState state) {
    if (state is PrintingLoading || state is PrintingInitial) {
      return const AppLoadingView(message: 'جاري تحميل قوالب الطباعة...');
    }
    if (state is PrintingError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<PrintingCubit>().fetchTemplates(),
      );
    }
    if (state is PrintingLoaded) {
      final templates = state.templates.where((template) {
        if (_filter == 'ALL') return true;
        return template['documentType']?.toString() == _filter;
      }).toList();
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _chips(context, state),
          const SizedBox(height: 12),
          if (templates.isEmpty)
            const _EmptyTemplates()
          else
            ...templates.map((template) => _templateCard(context, template)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  /// شرائح فلترة نوع المستند (الكل + 8 مستندات) — الفلترة عميلية على
  /// الصفحة المحمّلة (الخادم يرقّم بـ 20/صفحة، والشريحة تعيد الاستعلام).
  Widget _chips(BuildContext context, PrintingLoaded state) {
    int countFor(String type) {
      if (type == 'ALL') return state.templatesTotal;
      return state.templates
          .where((t) => t['documentType']?.toString() == type)
          .length;
    }

    return StatusChipBar(
      selected: _filter,
      onSelected: (value) {
        setState(() => _filter = value);
        context.read<PrintingCubit>().fetchTemplates(documentType: value);
      },
      chips: [
        StatusChip(label: 'الكل', count: countFor('ALL'), color: _orange, value: 'ALL'),
        ..._documentTypeLabels.entries.map(
          (entry) => StatusChip(
            label: entry.value,
            count: countFor(entry.key),
            color: AppColors.primary,
            value: entry.key,
          ),
        ),
      ],
    );
  }

  /// بطاقة قالب: الاسم + شارتا المستند/الورق + نجمة الافتراضي.
  Widget _templateCard(BuildContext context, Map<String, dynamic> template) {
    final cubit = context.read<PrintingCubit>();
    final documentType = template['documentType']?.toString() ?? '';
    final isDefault = template['isDefault'] == true;
    final isActive = template['isActive'] != false;
    return EntityCard(
      leadingIcon: Icons.print_rounded,
      iconColor: isDefault ? _orange : AppColors.primary,
      title: template['name']?.toString() ?? 'قالب',
      badge: isDefault
          ? EntityBadge('افتراضي', _orange)
          : (isActive
              ? const EntityBadge('نشط', AppColors.success)
              : const EntityBadge('معطّل', AppColors.statusPlanned)),
      subtitle:
          '${_documentTypeLabels[documentType] ?? documentType} · ${template['paperSize'] ?? ''}',
      meta: isDefault ? '★ القالب الافتراضي لهذا المستند × الورق' : null,
      expandRows: [
        ExpandRow('نوع المستند',
            _documentTypeLabels[documentType] ?? documentType),
        ExpandRow('حجم الورق', template['paperSize']?.toString() ?? '—'),
        ExpandRow('الافتراضي', isDefault ? 'نعم' : 'لا'),
        ExpandRow('الحالة', isActive ? 'نشط' : 'معطّل'),
        if (template['createdAt'] != null)
          ExpandRow('أُنشئ', date(template['createdAt'])),
      ],
      actions: [
        if (!isDefault && isActive)
          EntityAction(
            'تعيين افتراضي',
            Icons.star_rounded,
            () => _run(
              context,
              cubit,
              cubit.setDefault(template['id']?.toString() ?? ''),
              'تم تعيين القالب افتراضيًا',
            ),
            color: _orange,
          ),
        if (isActive)
          EntityAction(
            'حذف',
            Icons.delete_rounded,
            () => _confirmDeleteTemplate(
              context,
              cubit,
              template['id']?.toString() ?? '',
              template['name']?.toString() ?? '',
            ),
            color: AppColors.error,
          ),
      ],
    );
  }

  // -------------------------------------------------------------------
  // تبويب سجل الطباعة
  // -------------------------------------------------------------------

  Widget _logBody(BuildContext context, PrintingState state) {
    if (state is PrintingInitial) {
      return const AppLoadingView(message: 'جاري تحميل سجل الطباعة...');
    }
    if (state is PrintingError) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<PrintingCubit>().fetchLog(),
      );
    }
    if (state is PrintingLoaded) {
      return ListView(
        padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
        children: [
          _logHeader(state),
          const SizedBox(height: 12),
          if (state.logEntries.isEmpty)
            const _EmptyLog()
          else
            ...state.logEntries.map((entry) => _logCard(entry)),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Widget _logHeader(PrintingLoaded state) {
    return Card(
      elevation: 0.5,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(14, 10, 14, 10),
        child: Row(
          children: [
            const Icon(Icons.history_rounded, color: _orange, size: 20),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'سجل الطباعة (تدقيق)',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Text(
              '${count(state.logTotal)} عملية',
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12,
                color: Colors.grey,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// بطاقة سجل طباعة: المستند + الرقم + المستخدم + القناة + النسخ.
  Widget _logCard(Map<String, dynamic> entry) {
    final documentType = entry['documentType']?.toString() ?? '';
    final isReprint = entry['isReprint'] == true;
    final channel = entry['channel']?.toString() ?? '';
    final channelLabel = switch (channel) {
      'app_pdf' => 'PDF داخل التطبيق',
      'thermal' => 'طابعة حرارية',
      'external' => 'نظام خارجي',
      _ => channel,
    };
    final copies = asNum(entry['copies']);
    return EntityCard(
      leadingIcon: Icons.print_rounded,
      iconColor: isReprint ? AppColors.warning : AppColors.primary,
      title: entry['documentNumber']?.toString() ??
          _documentTypeLabels[documentType] ??
          'مستند',
      badge: isReprint
          ? const EntityBadge('إعادة طباعة', AppColors.warning)
          : null,
      subtitle:
          '${_documentTypeLabels[documentType] ?? documentType} · ${dateTime(entry['createdAt'])}',
      meta: entry['userName']?.toString(),
      expandRows: [
        ExpandRow('المستخدم', entry['userName']?.toString() ?? '—'),
        ExpandRow('القناة', channelLabel),
        ExpandRow('حجم الورق', entry['paperSize']?.toString() ?? '—'),
        ExpandRow('عدد النسخ', count(copies)),
        if (entry['templateName'] != null)
          ExpandRow('القالب', entry['templateName'].toString()),
        if (entry['documentId'] != null)
          ExpandRow('معرف المستند', entry['documentId'].toString()),
        ExpandRow('إعادة طباعة', isReprint ? 'نعم' : 'لا'),
      ],
    );
  }

  // -------------------------------------------------------------------
  // إجراءات
  // -------------------------------------------------------------------

  /// تهيئة القوالب العربية (بذرة idempotent) بتأكيد + عدد المنشأ.
  Future<void> _confirmSeed(BuildContext context, PrintingCubit cubit) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'تهيئة القوالب العربية',
      message:
          'تنشئ البذرة قالبًا عربيًا افتراضيًا لكل (مستند × حجم ورق) ناقص — '
          'الاستدعاء المتكرر لا يكرر الإنشاء. هل تريد التهيئة الآن؟',
      confirmLabel: 'تهيئة',
    );
    if (!confirmed || !mounted) return;
    final created = await cubit.seed();
    if (!mounted) return;
    if (created != null) {
      await cubit.fetchTemplates();
    }
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(this.context);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            created != null
                ? (created > 0
                    ? 'تمت تهيئة $created قالبًا عربيًا جديدًا'
                    : 'القوالب مهيأة مسبقًا — لا يوجد نقص')
                : (cubit.lastActionError ?? 'تعذرت تهيئة القوالب'),
            style: const TextStyle(fontFamily: 'Cairo'),
          ),
          backgroundColor:
              created != null ? AppColors.success : AppColors.error,
          duration: const Duration(seconds: 3),
        ),
      );
  }

  Future<void> _confirmDeleteTemplate(
    BuildContext context,
    PrintingCubit cubit,
    String id,
    String name,
  ) async {
    final confirmed = await confirmAppAction(
      context,
      title: 'حذف قالب الطباعة',
      message:
          'حذف ناعم (يُعطّل القالب) — سجل الطباعة التاريخي يظل مقروءًا. '
          'هل تريد حذف «$name»؟',
      confirmLabel: 'حذف',
    );
    if (!confirmed || !mounted) return;
    await _run(
      this.context,
      cubit,
      cubit.deleteTemplate(id),
      'تم حذف القالب',
    );
  }

  /// حوار إنشاء قالب: اسم + نوع مستند + حجم ورق + افتراضي (اختياري).
  Future<void> _showCreateDialog(
    BuildContext context,
    PrintingCubit cubit,
  ) async {
    final name = TextEditingController();
    String documentType = 'INVOICE';
    String paperSize = 'A4';
    bool isDefault = false;
    final messenger = ScaffoldMessenger.of(context);
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('قالب طباعة جديد'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'اسم القالب',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: documentType,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'نوع المستند',
                  border: OutlineInputBorder(),
                ),
                items: _documentTypeLabels.entries
                    .map(
                      (entry) => DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(entry.value),
                      ),
                    )
                    .toList(),
                onChanged: (value) =>
                    setDialogState(() => documentType = value ?? documentType),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: paperSize,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'حجم الورق',
                  border: OutlineInputBorder(),
                ),
                items: ['58mm', '80mm', 'A4', 'A5', 'A6']
                    .map((size) => DropdownMenuItem<String>(
                          value: size,
                          child: Text(size),
                        ))
                    .toList(),
                onChanged: (value) =>
                    setDialogState(() => paperSize = value ?? paperSize),
              ),
              const SizedBox(height: 10),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text(
                  'قالب افتراضي لهذا المستند × الورق',
                  style: TextStyle(fontFamily: 'Cairo', fontSize: 13),
                ),
                value: isDefault,
                onChanged: (value) => setDialogState(() => isDefault = value),
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
              child: const Text('إنشاء'),
            ),
          ],
        ),
      ),
    );
    if (saved != true || !mounted) return;
    if (name.text.trim().isEmpty) {
      _snack(messenger, cubit, null, fallback: 'أدخل اسم القالب');
      return;
    }
    final ok = await cubit.createTemplate(
      name: name.text.trim(),
      documentType: documentType,
      paperSize: paperSize,
      isDefault: isDefault,
    );
    if (!mounted) return;
    _snack(messenger, cubit, ok ? 'تم إنشاء القالب' : null);
  }

  Future<void> _run(
    BuildContext context,
    PrintingCubit cubit,
    Future<bool> future,
    String successMessage,
  ) async {
    // نلتقط الـ messenger قبل الانتظار — الاستخدام الآمن للسياق عبر فجوات
    // الانتظار (نمط الشاشة المرجعية quotations).
    final messenger = ScaffoldMessenger.of(context);
    final ok = await future;
    if (!mounted) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            ok
                ? successMessage
                : (cubit.lastActionError ?? 'تعذر تنفيذ العملية — حاول مجددًا'),
            style: const TextStyle(fontFamily: 'Cairo'),
          ),
          backgroundColor: ok ? AppColors.success : AppColors.error,
          duration: const Duration(seconds: 3),
        ),
      );
  }

  void _snack(
    ScaffoldMessengerState messenger,
    PrintingCubit cubit,
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
                : (cubit.lastActionError ?? fallback ?? 'تعذر تنفيذ العملية'),
            style: const TextStyle(fontFamily: 'Cairo'),
          ),
          backgroundColor: ok ? AppColors.success : AppColors.error,
          duration: const Duration(seconds: 3),
        ),
      );
  }
}

class _EmptyTemplates extends StatelessWidget {
  const _EmptyTemplates();

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0.5,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(24),
        child: Column(
          children: [
            const Icon(Icons.print_rounded, size: 48, color: AppColors.textHint),
            const SizedBox(height: 10),
            const Text(
              'لا توجد قوالب طباعة',
              style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'استخدم زر «تهيئة القوالب العربية» لإنشاء القوالب الافتراضية',
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

class _EmptyLog extends StatelessWidget {
  const _EmptyLog();

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0.5,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(24),
        child: Column(
          children: [
            const Icon(Icons.history_rounded, size: 48, color: AppColors.textHint),
            const SizedBox(height: 10),
            const Text(
              'لا توجد عمليات طباعة مسجلة',
              style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}
