import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../cubit/quality_cubit.dart';
import '../cubit/quality_state.dart';

class QualityScreen extends StatelessWidget {
  const QualityScreen({super.key, this.cubit});

  final QualityCubit? cubit;

  @override
  Widget build(BuildContext context) {
    final content = Builder(
      builder: (screenContext) => Scaffold(
        appBar: AppBar(
          title: const Text('مراقبة الجودة'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'تحديث',
              onPressed: () =>
                  screenContext.read<QualityCubit>().fetchQualityChecks(),
            ),
          ],
        ),
        body: BlocBuilder<QualityCubit, QualityState>(
          builder: (context, state) {
            if (state is QualityInitial || state is QualityLoading) {
              return const AppLoadingView();
            }
            if (state is QualityError) {
              return AppErrorView(
                message: state.message,
                onRetry: () =>
                    context.read<QualityCubit>().fetchQualityChecks(),
              );
            }
            if (state is QualityLoaded) {
              if (state.qualityChecks.isEmpty) {
                return AppEmptyView(
                  title: 'لا توجد تقارير جودة مسجلة',
                  actionLabel: 'إعادة التحميل',
                  onAction: () =>
                      context.read<QualityCubit>().fetchQualityChecks(),
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: state.qualityChecks.length,
                itemBuilder: (context, index) {
                  final check = state.qualityChecks[index] as Map;
                  final rejected =
                      int.tryParse('${check['rejectedQty'] ?? 0}') ?? 0;
                  final workOrder = check['workOrder'] as Map?;
                  final checkedAt =
                      DateTime.tryParse('${check['checkedAt'] ?? ''}');
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ListTile(
                      leading: Icon(
                        rejected > 0
                            ? Icons.warning_amber_rounded
                            : Icons.check_circle,
                        color:
                            rejected > 0 ? AppColors.error : AppColors.success,
                        size: 32,
                      ),
                      title: Text(
                        'أمر تشغيل: ${workOrder?['code'] ?? check['workOrderId'] ?? 'غير معروف'}',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'المرحلة: ${_translateStage('${check['stage'] ?? ''}')} | '
                            'فحص: ${check['checkedQty'] ?? 0} | سليم: ${check['passedQty'] ?? 0} | '
                            'مرفوض: $rejected | هالك: ${check['wasteQty'] ?? 0}',
                          ),
                          if (check['rejectionReason'] != null)
                            Text(
                              'سبب الرفض: ${_translateReason('${check['rejectionReason']}')}',
                              style: const TextStyle(color: AppColors.error),
                            ),
                          if (checkedAt != null)
                            Text(DateFormat('yyyy-MM-dd hh:mm a')
                                .format(checkedAt.toLocal())),
                        ],
                      ),
                    ),
                  );
                },
              );
            }
            return const SizedBox.shrink();
          },
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => _showAddQualityCheckDialog(screenContext),
          icon: const Icon(Icons.playlist_add_check),
          label: const Text('تقرير جديد'),
        ),
      ),
    );

    if (cubit != null) {
      return BlocProvider<QualityCubit>.value(value: cubit!, child: content);
    }
    return BlocProvider<QualityCubit>(
      create: (_) => QualityCubit()..fetchQualityChecks(),
      child: content,
    );
  }

  Future<void> _showAddQualityCheckDialog(BuildContext context) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) =>
          _AddQualityCheckDialog(cubit: context.read<QualityCubit>()),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل تقرير الجودة')),
      );
    }
  }

  static String _translateStage(String stage) {
    switch (stage) {
      case 'CUTTING':
        return 'القص';
      case 'SEWING':
        return 'الخياطة';
      case 'IRONING':
        return 'الكي';
      case 'PACKING':
        return 'التغليف';
      default:
        return stage.isEmpty ? 'غير محددة' : stage;
    }
  }

  static String _translateReason(String reason) {
    switch (reason) {
      case 'SEWING_DEFECT':
        return 'عيب خياطة';
      case 'CUTTING_DEFECT':
        return 'عيب قص';
      case 'FABRIC_DEFECT':
        return 'عيب قماش';
      case 'FINISHING_DEFECT':
        return 'عيب تشطيب';
      case 'PACKAGING_DEFECT':
        return 'عيب تغليف';
      case 'OTHER':
        return 'أخرى';
      default:
        return reason;
    }
  }
}

class _AddQualityCheckDialog extends StatefulWidget {
  const _AddQualityCheckDialog({required this.cubit});

  final QualityCubit cubit;

  @override
  State<_AddQualityCheckDialog> createState() => _AddQualityCheckDialogState();
}

class _AddQualityCheckDialogState extends State<_AddQualityCheckDialog> {
  final _formKey = GlobalKey<FormState>();
  final _workOrderController = TextEditingController();
  final _stageRunController = TextEditingController();
  final _checkedController = TextEditingController();
  final _passedController = TextEditingController();
  final _rejectedController = TextEditingController(text: '0');
  final _wasteController = TextEditingController(text: '0');
  final _notesController = TextEditingController();
  String _stage = 'CUTTING';
  String? _rejectionReason;
  String? _wasteReason;
  var _isSaving = false;

  @override
  void dispose() {
    _workOrderController.dispose();
    _stageRunController.dispose();
    _checkedController.dispose();
    _passedController.dispose();
    _rejectedController.dispose();
    _wasteController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  int _number(TextEditingController controller) =>
      int.tryParse(controller.text.trim()) ?? -1;

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final checked = _number(_checkedController);
    final passed = _number(_passedController);
    final rejected = _number(_rejectedController);
    final waste = _number(_wasteController);
    if (checked != passed + rejected + waste) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content:
                Text('يجب أن يساوي المفحوص مجموع السليم والمرفوض والهالك')),
      );
      return;
    }

    setState(() => _isSaving = true);
    try {
      await widget.cubit.submitQualityCheck(
        workOrderId: _workOrderController.text.trim(),
        stageRunId: _stageRunController.text.trim(),
        stage: _stage,
        checkedQty: checked,
        passedQty: passed,
        rejectedQty: rejected,
        wasteQty: waste,
        rejectionReason: _rejectionReason,
        wasteReason: _wasteReason,
        notes: _notesController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content:
                Text('تعذر تسجيل تقرير الجودة. تحقق من المرحلة والكميات.')),
      );
    }
  }

  String? _required(String? value) =>
      value == null || value.trim().isEmpty ? 'هذا الحقل مطلوب' : null;

  String? _nonNegative(String? value) {
    final parsed = int.tryParse(value?.trim() ?? '');
    return parsed == null || parsed < 0 ? 'أدخل عددًا صحيحًا غير سالب' : null;
  }

  @override
  Widget build(BuildContext context) {
    const reasons = [
      DropdownMenuItem(value: 'SEWING_DEFECT', child: Text('عيب خياطة')),
      DropdownMenuItem(value: 'CUTTING_DEFECT', child: Text('عيب قص')),
      DropdownMenuItem(value: 'FABRIC_DEFECT', child: Text('عيب قماش')),
      DropdownMenuItem(value: 'FINISHING_DEFECT', child: Text('عيب تشطيب')),
      DropdownMenuItem(value: 'PACKAGING_DEFECT', child: Text('عيب تغليف')),
      DropdownMenuItem(value: 'OTHER', child: Text('أخرى')),
    ];
    return AlertDialog(
      title: const Text('إضافة تقرير جودة'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: _workOrderController,
                  decoration: const InputDecoration(
                    labelText: 'معرف أمر التشغيل *',
                    helperText: 'يجب أن يكون أمر التشغيل موجودًا',
                  ),
                  validator: _required,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _stageRunController,
                  decoration: const InputDecoration(
                    labelText: 'معرف تشغيل المرحلة *',
                    helperText: 'يجب أن تكون المرحلة مكتملة',
                  ),
                  validator: _required,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _stage,
                  decoration: const InputDecoration(labelText: 'المرحلة *'),
                  items: const [
                    DropdownMenuItem(value: 'CUTTING', child: Text('القص')),
                    DropdownMenuItem(value: 'SEWING', child: Text('الخياطة')),
                    DropdownMenuItem(value: 'IRONING', child: Text('الكي')),
                    DropdownMenuItem(value: 'PACKING', child: Text('التغليف')),
                  ],
                  onChanged: _isSaving
                      ? null
                      : (value) {
                          if (value != null) setState(() => _stage = value);
                        },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _checkedController,
                  keyboardType: TextInputType.number,
                  decoration:
                      const InputDecoration(labelText: 'إجمالي المفحوص *'),
                  validator: _nonNegative,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _passedController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'السليم *'),
                  validator: _nonNegative,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _rejectedController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'المرفوض'),
                  validator: _nonNegative,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _rejectionReason,
                  decoration: const InputDecoration(labelText: 'سبب الرفض'),
                  items: reasons,
                  onChanged: _isSaving
                      ? null
                      : (value) {
                          setState(() => _rejectionReason = value);
                        },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _wasteController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'الهالك'),
                  validator: _nonNegative,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _wasteReason,
                  decoration: const InputDecoration(labelText: 'سبب الهالك'),
                  items: const [
                    DropdownMenuItem(value: 'DAMAGE', child: Text('تلف')),
                    DropdownMenuItem(
                        value: 'PROCESS_LOSS', child: Text('فاقد تشغيل')),
                    DropdownMenuItem(value: 'OTHER', child: Text('أخرى')),
                  ],
                  onChanged: _isSaving
                      ? null
                      : (value) {
                          setState(() => _wasteReason = value);
                        },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _notesController,
                  decoration: const InputDecoration(labelText: 'ملاحظات'),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ'),
        ),
      ],
    );
  }
}
