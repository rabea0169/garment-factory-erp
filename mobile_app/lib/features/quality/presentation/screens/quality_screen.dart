import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../cubit/quality_cubit.dart';
import '../cubit/quality_state.dart';

class QualityScreen extends StatelessWidget {
  /// DEV-PQ3: حقن اختياري — [cubit] و[dio] يُستخدمان في اختبارات الـ
  /// widget؛ الافتراضي إنشاء cubit جديد وعميل التطبيق المشترك.
  const QualityScreen({super.key, this.cubit, this.dio});

  final QualityCubit? cubit;
  final Dio? dio;

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
      builder: (_) => _AddQualityCheckDialog(
        cubit: context.read<QualityCubit>(),
        dio: dio,
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل تقرير الجودة')),
      );
    }
  }

  /// DEV-PQ3: ترجمة حالة أمر التشغيل في قائمة الحوار (قيم WorkOrderStatus
  /// الخادمية — PACKAGING وPACKING كلاهما للتغليف).
  static String _translateOrderStatus(String status) {
    switch (status.toUpperCase()) {
      case 'PLANNED':
        return 'مخطط';
      case 'CUTTING':
        return 'قص';
      case 'SEWING':
        return 'خياطة';
      case 'IRONING':
        return 'كي';
      case 'PACKAGING':
      case 'PACKING':
        return 'تغليف';
      case 'IN_PROGRESS':
        return 'قيد التنفيذ';
      case 'COMPLETED':
        return 'مكتمل';
      case 'CANCELLED':
        return 'ملغى';
      default:
        return status.isEmpty ? 'غير معروفة' : status;
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

/// DEV-PQ3: حوار تسجيل فحص الجودة — يبدأ باختيار أمر التشغيل من قائمة
/// حية (GET /production/work-orders?limit=100: الرمز + المنتج + الحالة)
/// ثم مرحلة الفحص (المراحل الخادمية الثابتة CUTTING/SEWING/IRONING/
/// PACKING مع تمييز المراحل المفحوصة سلفًا من GET /quality?workOrderId=).
/// stageRunId يُستنتج من سجل مرحلات التشغيل المحلي المشترك مع الإنتاج —
/// لا حقول UUID نصية يدوية إطلاقًا.
class _AddQualityCheckDialog extends StatefulWidget {
  const _AddQualityCheckDialog({required this.cubit, this.dio});

  final QualityCubit cubit;

  /// يُحقن في الاختبارات؛ الافتراضي عميل التطبيق المشترك.
  final Dio? dio;

  @override
  State<_AddQualityCheckDialog> createState() => _AddQualityCheckDialogState();
}

class _AddQualityCheckDialogState extends State<_AddQualityCheckDialog> {
  static const List<String> _stageValues = [
    'CUTTING',
    'SEWING',
    'IRONING',
    'PACKING',
  ];

  final _formKey = GlobalKey<FormState>();
  final _checkedController = TextEditingController();
  final _passedController = TextEditingController();
  final _rejectedController = TextEditingController(text: '0');
  final _wasteController = TextEditingController(text: '0');
  final _notesController = TextEditingController();

  List<Map<String, dynamic>> _workOrders = const [];
  Set<String> _checkedStages = const {};
  String? _selectedWorkOrderId;
  String _stage = 'CUTTING';
  String? _rejectionReason;
  String? _wasteReason;
  String? _resolvedStageRunId;
  bool _loadingWorkOrders = true;
  bool _loadingOrderDetails = false;
  String? _workOrdersError;
  String? _submitError;
  var _isSaving = false;

  Dio get _dio => widget.dio ?? ApiClient.instance.dio;

  @override
  void initState() {
    super.initState();
    _loadWorkOrders();
  }

  @override
  void dispose() {
    _checkedController.dispose();
    _passedController.dispose();
    _rejectedController.dispose();
    _wasteController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _loadWorkOrders() async {
    setState(() {
      _loadingWorkOrders = true;
      _workOrdersError = null;
    });
    try {
      final response = await _dio.get<dynamic>(
        '/production/work-orders',
        queryParameters: {'limit': 100},
      );
      final orders = ApiClient.extractPaginatedData(response.data)
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .where((order) => order['id'] != null)
          .toList(growable: false);
      if (!mounted) return;
      setState(() {
        _workOrders = orders;
        _loadingWorkOrders = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingWorkOrders = false;
        _workOrdersError = ApiClient.instance.messageFor(error);
      });
    }
  }

  /// عند اختيار الأمر: اجلب فحوصه القائمة (لتعطيل مراحلها — الخادم يرفض
  /// فحصًا ثانيًا لنفس التشغيل بـ409) وحلّ مرحلة افتراضية: آخر مرحلة
  /// مكتملة غالبًا = المرحلة السابقة للمرحلة الجارية (currentStage).
  Future<void> _onWorkOrderChanged(String? workOrderId) async {
    if (workOrderId == null || workOrderId == _selectedWorkOrderId) return;
    setState(() {
      _selectedWorkOrderId = workOrderId;
      _checkedStages = const {};
      _resolvedStageRunId = null;
      _loadingOrderDetails = true;
      _submitError = null;
    });
    Set<String> checkedStages = const {};
    try {
      final response = await _dio.get<dynamic>(
        '/quality',
        queryParameters: {'workOrderId': workOrderId, 'limit': 100},
      );
      checkedStages = {
        for (final check in ApiClient.extractPaginatedData(response.data)
            .whereType<Map>())
          if (check['stage'] is String) check['stage'] as String,
      };
    } catch (_) {
      // أفضل-جهد: المراحل المفحوصة تحسين UX فقط — الفشل لا يمنع التسجيل.
    }
    final order = _workOrders
        .where((item) => item['id'] == workOrderId)
        .firstOrNull;
    final defaultStage = _defaultStageFor(order, checkedStages);
    if (!mounted) return;
    setState(() {
      _checkedStages = checkedStages;
      _stage = defaultStage;
      _loadingOrderDetails = false;
    });
    await _onStageChanged(defaultStage);
  }

  /// المرحلة الافتراضية: السابقة للمرحلة الجارية (تلك غالبًا آخر مرحلة
  /// مكتملة بانتظار فحصها) ما لم تكن مفحوصة سلفًا — وإلا أول مرحلة غير
  /// مفحوصة (الخادم يرفض فحصًا ثانيًا لنفس التشغيل بـ 409).
  String _defaultStageFor(
    Map<String, dynamic>? order,
    Set<String> checkedStages,
  ) {
    final currentStage = order?['currentStage'];
    if (currentStage is String) {
      final normalized = currentStage.toUpperCase();
      final index = _stageValues.indexOf(
        normalized == 'PACKAGING' ? 'PACKING' : normalized,
      );
      if (index > 0) {
        final previous = _stageValues[index - 1];
        if (!checkedStages.contains(previous)) return previous;
      }
    }
    for (final stage in _stageValues) {
      if (!checkedStages.contains(stage)) return stage;
    }
    return _stageValues.first;
  }

  Future<void> _onStageChanged(String stage) async {
    setState(() => _stage = stage);
    final workOrderId = _selectedWorkOrderId;
    if (workOrderId == null) return;
    final stageRunId =
        await widget.cubit.resolveStageRunId(workOrderId, stage);
    if (!mounted) return;
    setState(() => _resolvedStageRunId = stageRunId);
  }

  int _number(TextEditingController controller) =>
      int.tryParse(controller.text.trim()) ?? -1;

  Future<void> _save() async {
    if (_isSaving || !(_formKey.currentState?.validate() ?? false)) return;
    final checked = _number(_checkedController);
    final passed = _number(_passedController);
    final rejected = _number(_rejectedController);
    final waste = _number(_wasteController);
    if (checked != passed + rejected + waste) {
      setState(() => _submitError =
          'يجب أن يساوي المفحوص مجموع السليم والمرفوض والهالك');
      return;
    }
    // عقد CreateQualityCheckDto: أسباب إلزامية عند وجود رفض/هالك (وإلا 400).
    if (rejected > 0 && (_rejectionReason == null || _rejectionReason!.isEmpty)) {
      setState(() => _submitError = 'يلزم اختيار سبب الرفض عند وجود كميات مرفوضة');
      return;
    }
    if (waste > 0 && (_wasteReason == null || _wasteReason!.isEmpty)) {
      setState(() => _submitError = 'يلزم اختيار سبب الهالك عند وجود كميات هالك');
      return;
    }
    setState(() {
      _isSaving = true;
      _submitError = null;
    });
    try {
      await widget.cubit.submitQualityCheck(
        workOrderId: _selectedWorkOrderId!,
        stageRunId: _resolvedStageRunId!,
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
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isSaving = false;
        _submitError =
            'تعذر تسجيل تقرير الجودة: ${ApiClient.instance.messageFor(error)}';
      });
    }
  }

  String? _nonNegative(String? value) {
    final parsed = int.tryParse(value?.trim() ?? '');
    return parsed == null || parsed < 0 ? 'أدخل عددًا صحيحًا غير سالب' : null;
  }

  String _workOrderLabel(Map<String, dynamic> order) {
    final variant = order['variant'] is Map
        ? Map<String, dynamic>.from(order['variant'] as Map)
        : const <String, dynamic>{};
    final product = variant['product'] is Map
        ? Map<String, dynamic>.from(variant['product'] as Map)
        : const <String, dynamic>{};
    final productName = product['name'] as String? ?? '';
    final code = order['code'] as String? ?? order['id'].toString();
    final status = QualityScreen._translateOrderStatus('${order['status'] ?? ''}');
    return productName.isEmpty
        ? '$code ($status)'
        : '$code — $productName ($status)';
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

    Widget content;
    if (_loadingWorkOrders) {
      content = const SizedBox(
        height: 220,
        child: AppLoadingView(message: 'جاري تحميل أوامر التشغيل...'),
      );
    } else if (_workOrdersError != null) {
      content = SizedBox(
        height: 220,
        child: AppErrorView(
          message: _workOrdersError!,
          onRetry: _loadWorkOrders,
        ),
      );
    } else {
      content = SizedBox(
        width: double.maxFinite,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
            DropdownButtonFormField<String>(
              initialValue: _selectedWorkOrderId,
              decoration: const InputDecoration(
                labelText: 'أمر التشغيل *',
                helperText: 'الرمز — المنتج (الحالة)',
              ),
              items: _workOrders
                  .map(
                    (order) => DropdownMenuItem<String>(
                      value: order['id'].toString(),
                      child: Text(
                        _workOrderLabel(order),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving ? null : _onWorkOrderChanged,
              validator: (value) => value == null ? 'اختر أمر التشغيل' : null,
            ),
            const SizedBox(height: 10),
            if (_loadingOrderDetails) const LinearProgressIndicator(minHeight: 2),
            if (_loadingOrderDetails) const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _stage,
              decoration: const InputDecoration(labelText: 'مرحلة الفحص *'),
              items: [
                for (final stage in _stageValues)
                  DropdownMenuItem<String>(
                    value: stage,
                    enabled: !_checkedStages.contains(stage),
                    child: Text(
                      QualityScreen._translateStage(stage) +
                          (_checkedStages.contains(stage) ? ' (تم فحصها)' : ''),
                    ),
                  ),
              ],
              onChanged: _isSaving ? null : (value) {
                if (value != null) _onStageChanged(value);
              },
              validator: (value) => value == null ? 'اختر مرحلة الفحص' : null,
            ),
            if (_selectedWorkOrderId != null &&
                !_loadingOrderDetails &&
                _resolvedStageRunId == null) ...[
              const SizedBox(height: 10),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: AppColors.warning.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline,
                          color: AppColors.warning, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'لا يتوفر تشغيل مرحلة مكتمل لهذه المرحلة على هذا '
                          'الجهاز. سجّل مخرجات المرحلة من شاشة الإنتاج أولًا '
                          'ثم أعد المحاولة.',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 10),
            TextFormField(
              controller: _checkedController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'إجمالي المفحوص *'),
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
              // قيم QualityWasteReason في الخادم (schema.prisma):
              // NATURAL_LOSS, DEFECT_RELATED, HUMAN_ERROR, MATERIAL_DEFECT, OTHER
              items: const [
                DropdownMenuItem(
                    value: 'NATURAL_LOSS', child: Text('فاقد طبيعي')),
                DropdownMenuItem(
                    value: 'DEFECT_RELATED', child: Text('مرتبط بعيوب')),
                DropdownMenuItem(
                    value: 'HUMAN_ERROR', child: Text('خطأ بشري')),
                DropdownMenuItem(
                    value: 'MATERIAL_DEFECT', child: Text('عيب خامة')),
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
            if (_submitError != null) ...[
              const SizedBox(height: 12),
              Text(
                _submitError!,
                style: const TextStyle(color: AppColors.error),
                textAlign: TextAlign.center,
              ),
            ],
              ],
            ),
          ),
        ),
      );
    }

    return AlertDialog(
      title: const Text('إضافة تقرير جودة'),
      content: SizedBox(width: 460, child: content),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        FilledButton(
          onPressed:
              _isSaving || _loadingWorkOrders || _resolvedStageRunId == null
                  ? null
                  : _save,
          child: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ'),
        ),
      ],
    );
  }
}
