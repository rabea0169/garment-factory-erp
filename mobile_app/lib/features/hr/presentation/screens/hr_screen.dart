import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/router/app_router.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../production/presentation/widgets/outbox_pending_badge.dart';
import '../cubit/hr_cubit.dart';
import '../cubit/hr_state.dart';
import '../widgets/create_worker_dialog.dart';
import '../widgets/record_advance_dialog.dart';
import '../widgets/worker_nfc_button.dart';

class HrScreen extends StatefulWidget {
  const HrScreen({this.cubit, super.key});

  /// يُحقن في الاختبارات؛ الافتراضي cubit جديد يبدأ الجلب فورًا.
  final HrCubit? cubit;

  @override
  State<HrScreen> createState() => _HrScreenState();
}

class _HrScreenState extends State<HrScreen> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => widget.cubit ?? (HrCubit()..fetchWorkers()),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('الموارد البشرية والعمال'),
          actions: [
            // MOB-3: عدد تسجيلات الإنتاج المحفوظة محليًا بانتظار الاتصال.
            const OutboxPendingBadge(),
            // COMM-F05: تسجيل سلفة عامل (POST /hr/advances).
            Builder(
              builder: (ctx) => IconButton(
                tooltip: 'تسجيل سلفة',
                icon: const Icon(Icons.savings),
                onPressed: () => _showRecordAdvanceDialog(ctx),
              ),
            ),
            // MOB-8: اختصار شاشة حالة الرواتب.
            Builder(
              builder: (ctx) => IconButton(
                tooltip: 'كشوف الرواتب',
                icon: const Icon(Icons.payments),
                onPressed: () => ctx.push(AppRouter.hrPayrolls),
              ),
            ),
            Builder(
              builder: (ctx) => IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ctx.read<HrCubit>().fetchWorkers(),
              ),
            ),
          ],
        ),
        body: Column(
          children: [
            // MOB-4: حقل بحث بالاسم/الكود + زر قراءة بطاقة NFC.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _searchController,
                      decoration: const InputDecoration(
                        labelText: 'بحث بالاسم أو الكود',
                        prefixIcon: Icon(Icons.search),
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  Builder(
                    builder: (ctx) => WorkerNfcButton(
                      cubit: ctx.read<HrCubit>(),
                      searchController: _searchController,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: BlocBuilder<HrCubit, HrState>(
                builder: (context, state) {
                  if (state is HrLoading || state is HrInitial) {
                    return const AppLoadingView();
                  } else if (state is HrOffline) {
                    return AppOfflineView(
                      onRetry: () => context.read<HrCubit>().fetchWorkers(),
                    );
                  } else if (state is HrError) {
                    return AppErrorView(
                      message: state.message,
                      onRetry: () => context.read<HrCubit>().fetchWorkers(),
                    );
                  } else if (state is HrLoaded) {
                    final workers = filterWorkers(
                      state.workers,
                      _searchController.text,
                    );
                    return Column(
                      children: [
                        // MOB-3: بيانات من الكاش (لا اتصال) — شارة وضوح.
                        if (state.fromCache && state.cachedAt != null)
                          AppCachedDataBanner(cachedAt: state.cachedAt!),
                        Expanded(
                          child: workers.isEmpty
                              ? AppEmptyView(
                                  title: _searchController.text.trim().isEmpty
                                      ? 'لا يوجد عمال مسجلون'
                                      : 'لا نتائج مطابقة للبحث',
                                  actionLabel: 'إعادة التحميل',
                                  onAction: () =>
                                      context.read<HrCubit>().fetchWorkers(),
                                )
                              : _WorkersList(
                                  workers: workers,
                                  onRecordProduction:
                                      _showRecordProductionDialog,
                                  onRecordAttendance: _showAttendanceDialog,
                                ),
                        ),
                      ],
                    );
                  }
                  return const SizedBox();
                },
              ),
            ),
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () async {
            final saved = await showDialog<bool>(
              context: context,
              builder: (_) => CreateWorkerDialog(
                cubit: context.read<HrCubit>(),
              ),
            );
            if (saved == true && context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('تم حفظ العامل بنجاح')),
              );
            }
          },
          icon: const Icon(Icons.person_add),
          label: const Text('إضافة عامل'),
        ),
      ),
    );
  }

  /// COMM-F05: فتح حوار تسجيل سلفة — العامل من قائمة العمال المعروضة،
  /// وبعد النجاح snackbar + إعادة جلب fetchWorkers() (داخل recordAdvance).
  Future<void> _showRecordAdvanceDialog(BuildContext context) async {
    final cubit = context.read<HrCubit>();
    final state = cubit.state;
    final workers = state is HrLoaded
        ? state.workers
            .whereType<Map>()
            .map((worker) => Map<String, dynamic>.from(worker))
            .toList(growable: false)
        : <Map<String, dynamic>>[];
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => RecordAdvanceDialog(
        cubit: cubit,
        workers: workers,
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل السلفة بنجاح')),
      );
    }
  }

  Future<void> _showAttendanceDialog(
    BuildContext context,
    Map<String, dynamic> worker,
  ) async {
    final notesController = TextEditingController();
    final cubit = context.read<HrCubit>();
    var isPresent = true;
    // MOB-3: نتيجة الحفظ تُقرر رسالة التأكيد (فوري أم محفوظ محليًا).
    RecordAttendanceOutcome? outcome;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        var isSaving = false;
        return StatefulBuilder(
          builder: (context, setState) => AlertDialog(
            title: Text('تسجيل حضور - ${worker['name']}'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Text(
                    'التاريخ: ${DateFormat('yyyy-MM-dd').format(DateTime.now())}',
                    style: const TextStyle(fontFamily: 'Cairo'),
                  ),
                ),
                const SizedBox(height: 4),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'حاضر اليوم',
                    style: TextStyle(fontFamily: 'Cairo'),
                  ),
                  value: isPresent,
                  onChanged: (value) => setState(() => isPresent = value),
                ),
                TextField(
                  controller: notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'ملاحظات (اختياري)',
                    prefixIcon: Icon(Icons.notes),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: isSaving ? null : () => Navigator.pop(dialogContext),
                child: const Text('إلغاء'),
              ),
              FilledButton(
                onPressed: isSaving
                    ? null
                    : () async {
                        setState(() => isSaving = true);
                        outcome = await cubit.recordAttendance(
                          workerId: worker['id'].toString(),
                          isPresent: isPresent,
                          notes: notesController.text,
                        );
                        if (!context.mounted) return;
                        if (outcome == RecordAttendanceOutcome.failed) {
                          // فشل فعلي — أبقِ الحوار مفتوحًا.
                          setState(() => isSaving = false);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('تعذر تسجيل الحضور')),
                          );
                          return;
                        }
                        // أُرسل فورًا أو حُفظ في الطابور — أغلق الحوار
                        // (رسالة التأكيد المناسبة تظهر بعده).
                        if (dialogContext.mounted) {
                          Navigator.pop(dialogContext, true);
                        }
                      },
                child: Text(isSaving ? 'جاري الحفظ...' : 'حفظ'),
              ),
            ],
          ),
        );
      },
    );
    notesController.dispose();
    if (saved == true && context.mounted) {
      final message = switch (outcome) {
        RecordAttendanceOutcome.queued =>
          'لا يوجد اتصال — تم حفظ الحضور محليًا وسيُرسل تلقائيًا عند عودة الاتصال',
        _ => 'تم تسجيل الحضور بنجاح',
      };
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 4)),
      );
    }
  }

  Future<void> _showRecordProductionDialog(
    BuildContext context,
    Map<String, dynamic> worker,
  ) async {
    final piecesController = TextEditingController();
    final cubit = context.read<HrCubit>();
    // MOB-3: نتيجة الحفظ تُقرر رسالة التأكيد (فوري أم محفوظ محليًا).
    RecordProductionOutcome? outcome;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        var isSaving = false;
        return StatefulBuilder(
          builder: (context, setState) => AlertDialog(
            title: Text('تسجيل إنتاج - ${worker['name']}'),
            content: TextField(
              controller: piecesController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'عدد القطع المنجزة *',
                prefixIcon: Icon(Icons.checkroom),
              ),
            ),
            actions: [
              TextButton(
                onPressed: isSaving ? null : () => Navigator.pop(dialogContext),
                child: const Text('إلغاء'),
              ),
              FilledButton(
                onPressed: isSaving
                    ? null
                    : () async {
                        final pieces =
                            int.tryParse(piecesController.text.trim());
                        if (pieces == null || pieces <= 0) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('أدخل عددًا صحيحًا موجبًا')),
                          );
                          return;
                        }
                        setState(() => isSaving = true);
                        outcome = await cubit.recordProduction(
                          workerId: worker['id'].toString(),
                          piecesCount: pieces,
                        );
                        if (!context.mounted) return;
                        if (outcome == RecordProductionOutcome.failed) {
                          // فشل فعلي — أبقِ الحوار مفتوحًا لتصحيح البيانات.
                          setState(() => isSaving = false);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('تعذر تسجيل الإنتاج')),
                          );
                          return;
                        }
                        // أُرسل فورًا أو حُفظ في الطابور — أغلق الحوار
                        // (رسالة التأكيد المناسبة تظهر بعده).
                        if (dialogContext.mounted) {
                          Navigator.pop(dialogContext, true);
                        }
                      },
                child: Text(isSaving ? 'جاري الحفظ...' : 'حفظ'),
              ),
            ],
          ),
        );
      },
    );
    piecesController.dispose();
    if (saved == true && context.mounted) {
      final message = switch (outcome) {
        RecordProductionOutcome.queued =>
          'لا يوجد اتصال — تم حفظ التسجيل محليًا وسيُرسل تلقائيًا عند عودة الاتصال',
        _ => 'تم تسجيل الإنتاج بنجاح',
      };
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 4)),
      );
    }
  }
}

class _WorkersList extends StatelessWidget {
  const _WorkersList({
    required this.workers,
    required this.onRecordProduction,
    required this.onRecordAttendance,
  });

  final List<Map<String, dynamic>> workers;
  final Future<void> Function(BuildContext, Map<String, dynamic>)
      onRecordProduction;

  /// MOB-3: تسجيل الحضور — يُرسل فوريًا أو يُدرج بالطابور بلا اتصال.
  final Future<void> Function(BuildContext, Map<String, dynamic>)
      onRecordAttendance;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: workers.length,
      itemBuilder: (context, index) {
        final worker = workers[index];
        return _WorkerCard(
          worker: worker,
          onRecordProduction: () =>
              onRecordProduction(context, Map<String, dynamic>.from(worker)),
          onRecordAttendance: () =>
              onRecordAttendance(context, Map<String, dynamic>.from(worker)),
        );
      },
    );
  }
}

class _WorkerCard extends StatelessWidget {
  const _WorkerCard({
    required this.worker,
    required this.onRecordProduction,
    required this.onRecordAttendance,
  });

  final Map<String, dynamic> worker;
  final VoidCallback onRecordProduction;

  /// MOB-3: فتح حوار تسجيل الحضور (فوري أو طابور عند فقد الاتصال).
  final VoidCallback onRecordAttendance;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: AppColors.primary,
          child: Icon(Icons.person, color: Colors.white),
        ),
        title: Text(worker['name']?.toString() ?? '',
            style: const TextStyle(
                fontWeight: FontWeight.bold, fontFamily: 'Cairo')),
        subtitle: Text(
            'كود: ${worker['code']} | التخصص: ${_specialtyLabel(worker['specialty']?.toString() ?? '')}'),
        // MOB-8: بطاقة العامل تفتح نشاطه (آخر السلف + آخر الإنتاج).
        onTap: () => context.push(
          '${AppRouter.hrWorkerActivity}/${worker['id']}'
          '?name=${Uri.encodeComponent(worker['name']?.toString() ?? '')}',
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            // MOB-3: تسجيل الحضور — بلا اتصال يُدرج بالطابور.
            IconButton(
              icon: const Icon(Icons.how_to_reg, color: AppColors.secondary),
              tooltip: 'تسجيل حضور',
              onPressed: onRecordAttendance,
            ),
            IconButton(
              icon: const Icon(Icons.add_task, color: AppColors.success),
              tooltip: 'تسجيل إنتاج',
              onPressed: onRecordProduction,
            ),
          ],
        ),
      ),
    );
  }

  static String _specialtyLabel(String specialty) {
    switch (specialty) {
      case 'CUTTING':
        return 'قص';
      case 'SEWING':
        return 'خياطة';
      case 'FINISHING':
        return 'تشطيب';
      case 'PACKAGING':
        return 'تعبئة';
      case 'IRONING':
        return 'كي';
      case 'QUALITY_CONTROL':
        return 'مراقبة جودة';
      case 'OTHER':
        return 'أخرى';
      default:
        return specialty;
    }
  }
}
