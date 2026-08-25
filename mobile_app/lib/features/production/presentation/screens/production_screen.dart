import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/production_cubit.dart';
import '../cubit/production_state.dart';

class ProductionScreen extends StatelessWidget {
  const ProductionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => ProductionCubit()..fetchWorkflowData(),
      child: const _ProductionScreenView(),
    );
  }
}

class _ProductionScreenView extends StatelessWidget {
  const _ProductionScreenView();

  static const stages = <String>['CUTTING', 'SEWING', 'IRONING', 'PACKING'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('سير عمل الإنتاج'),
        actions: [
          IconButton(
            tooltip: 'تحديث',
            icon: const Icon(Icons.refresh),
            onPressed: () => context.read<ProductionCubit>().fetchWorkflowData(),
          ),
        ],
      ),
      body: BlocBuilder<ProductionCubit, ProductionState>(
        builder: (context, state) {
          if (state is ProductionLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state is ProductionError && state.previousWorkOrders.isEmpty) {
            return _ErrorView(
              message: state.message,
              onRetry: () => context.read<ProductionCubit>().fetchWorkflowData(),
            );
          }

          final orders = state is ProductionLoaded
              ? state.workOrders
              : state is ProductionError
                  ? state.previousWorkOrders
                  : const <dynamic>[];
          if (orders.isEmpty) {
            return _EmptyView(
              onRefresh: () => context.read<ProductionCubit>().fetchWorkflowData(),
            );
          }

          final loaded = state is ProductionLoaded ? state : null;
          return Column(
            children: [
              if (state is ProductionError)
                _InlineErrorBanner(message: state.message),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: context.read<ProductionCubit>().fetchWorkflowData,
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 100),
                    itemCount: orders.length,
                    itemBuilder: (context, index) {
                      final order = _asMap(orders[index]);
                      return _WorkOrderCard(
                        order: order,
                        stages: stages,
                        isBusy: loaded?.isBusy(_string(order['id'])) ?? false,
                        rawMaterials: loaded?.rawMaterials ?? const [],
                        warehouses: loaded?.warehouses ?? const [],
                        onTransition: (stage) => context
                            .read<ProductionCubit>()
                            .transitionStage(_string(order['id']), stage),
                        onRecordOutput: (payload) => context
                            .read<ProductionCubit>()
                            .recordStageOutput(_string(order['id']), payload),
                        onConsumeMaterial: (payload) => context
                            .read<ProductionCubit>()
                            .consumeMaterial(_string(order['id']), payload),
                        onFinalizeCost: () => context
                            .read<ProductionCubit>()
                            .finalizeCost(_string(order['id'])),
                      );
                    },
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  static Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  static String _string(dynamic value) => value?.toString() ?? '';
}

class _WorkOrderCard extends StatelessWidget {
  const _WorkOrderCard({
    required this.order,
    required this.stages,
    required this.isBusy,
    required this.rawMaterials,
    required this.warehouses,
    required this.onTransition,
    required this.onRecordOutput,
    required this.onConsumeMaterial,
    required this.onFinalizeCost,
  });

  final Map<String, dynamic> order;
  final List<String> stages;
  final bool isBusy;
  final List<dynamic> rawMaterials;
  final List<dynamic> warehouses;
  final ValueChanged<String> onTransition;
  final ValueChanged<Map<String, dynamic>> onRecordOutput;
  final ValueChanged<Map<String, dynamic>> onConsumeMaterial;
  final VoidCallback onFinalizeCost;

  @override
  Widget build(BuildContext context) {
    final variant = _asMap(order['variant']);
    final product = _asMap(variant['product']);
    final productName = _string(product['name']).isEmpty
        ? 'منتج غير محدد'
        : _string(product['name']);
    final status = _string(order['status']);
    final currentStage = _string(order['currentStage']);
    final nextStage = _nextStage(currentStage, status);
    final stageRun = _currentStageRun(currentStage);
    final isCompleted = status == 'COMPLETED';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        initiallyExpanded: currentStage.isNotEmpty && !isCompleted,
        leading: CircleAvatar(
          backgroundColor: _statusColor(status).withValues(alpha: 0.12),
          child: Icon(_statusIcon(status), color: _statusColor(status)),
        ),
        title: Text(
          productName,
          style: const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Cairo'),
        ),
        subtitle: Text(
          'أمر ${_string(order['code'])} • ${_string(order['quantity'])} قطعة • ${_translateStatus(status, currentStage)}',
          style: const TextStyle(fontFamily: 'Cairo'),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _OrderSummary(order: order, variant: variant),
                const SizedBox(height: 16),
                _StageTimeline(
                  stages: stages,
                  currentStage: currentStage,
                  stageRuns: _asList(order['stageRuns']),
                ),
                const SizedBox(height: 16),
                if (isBusy)
                  const Center(child: CircularProgressIndicator())
                else ...[
                  if (nextStage != null)
                    ElevatedButton.icon(
                      icon: const Icon(Icons.arrow_forward),
                      onPressed: () => onTransition(nextStage),
                      label: Text(
                        currentStage.isEmpty
                            ? 'بدء مرحلة ${_stageLabel(nextStage)}'
                            : 'الانتقال إلى ${_stageLabel(nextStage)}',
                        style: const TextStyle(fontFamily: 'Cairo'),
                      ),
                    ),
                  if (currentStage.isNotEmpty && !isCompleted && stageRun != null) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.fact_check_outlined),
                      onPressed: () => _showOutputDialog(context, stageRun),
                      label: const Text(
                        'تسجيل مخرجات المرحلة',
                        style: TextStyle(fontFamily: 'Cairo'),
                      ),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.inventory_2_outlined),
                      onPressed: () => _showConsumptionDialog(context, stageRun),
                      label: const Text(
                        'تسجيل استهلاك خامة',
                        style: TextStyle(fontFamily: 'Cairo'),
                      ),
                    ),
                  ],
                  if (isCompleted)
                    OutlinedButton.icon(
                      icon: const Icon(Icons.calculate_outlined),
                      onPressed: onFinalizeCost,
                      label: const Text(
                        'تثبيت تكلفة المواد',
                        style: TextStyle(fontFamily: 'Cairo'),
                      ),
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Map<String, dynamic>? _currentStageRun(String currentStage) {
    if (currentStage.isEmpty) return null;
    for (final item in _asList(order['stageRuns'])) {
      final run = _asMap(item);
      if (_string(run['stage']) == currentStage) return run;
    }
    return null;
  }

  String? _nextStage(String currentStage, String status) {
    if (status == 'COMPLETED' || status == 'CANCELLED') return null;
    if (currentStage.isEmpty) return stages.first;
    final index = stages.indexOf(currentStage);
    if (index < 0 || index + 1 >= stages.length) return null;
    return stages[index + 1];
  }

  Future<void> _showOutputDialog(
    BuildContext context,
    Map<String, dynamic> stageRun,
  ) async {
    final stage = _string(stageRun['stage']);
    final inputController = TextEditingController(
      text: _string(stageRun['inputQty']).isEmpty
          ? _string(order['quantity'])
          : _string(stageRun['inputQty']),
    );
    final acceptedController = TextEditingController();
    final rejectedController = TextEditingController(text: '0');
    final wasteController = TextEditingController(text: '0');
    String? warehouseId;
    final finishedWarehouses = warehouses
        .where((item) => _string(_asMap(item)['type']) == 'FINISHED_GOODS')
        .toList();

    final payload = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: Text('مخرجات ${_stageLabel(stage)}'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _numberField(inputController, 'كمية الإدخال'),
                _numberField(acceptedController, 'الكمية المقبولة'),
                _numberField(rejectedController, 'الكمية المرفوضة'),
                _numberField(wasteController, 'كمية الهدر'),
                if (stage == 'PACKING' && finishedWarehouses.isNotEmpty)
                  DropdownButtonFormField<String>(
                    initialValue: warehouseId,
                    decoration: const InputDecoration(
                      labelText: 'مخزن المنتج التام (اختياري)',
                    ),
                    items: finishedWarehouses.map((item) {
                      final warehouse = _asMap(item);
                      final id = _string(warehouse['id']);
                      return DropdownMenuItem(
                        value: id,
                        child: Text(_string(warehouse['name'])),
                      );
                    }).toList(),
                    onChanged: (value) => setState(() => warehouseId = value),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: () {
                final inputQty = int.tryParse(inputController.text);
                final acceptedQty = int.tryParse(acceptedController.text);
                final rejectedQty = int.tryParse(rejectedController.text);
                final wasteQty = int.tryParse(wasteController.text);
                if (inputQty == null ||
                    acceptedQty == null ||
                    rejectedQty == null ||
                    wasteQty == null ||
                    inputQty <= 0 ||
                    acceptedQty < 0 ||
                    rejectedQty < 0 ||
                    wasteQty < 0 ||
                    inputQty != acceptedQty + rejectedQty + wasteQty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('راجع الكميات: يجب أن يساوي الإدخال مجموع المخرجات')),
                  );
                  return;
                }
                Navigator.pop(dialogContext, {
                  'stage': stage,
                  'inputQty': inputQty,
                  'acceptedQty': acceptedQty,
                  'rejectedQty': rejectedQty,
                  'wasteQty': wasteQty,
                  if (warehouseId != null) 'finishedGoodsWarehouseId': warehouseId,
                });
              },
              child: const Text('حفظ'),
            ),
          ],
        ),
      ),
    );
    inputController.dispose();
    acceptedController.dispose();
    rejectedController.dispose();
    wasteController.dispose();
    if (payload != null) onRecordOutput(payload);
  }

  Future<void> _showConsumptionDialog(
    BuildContext context,
    Map<String, dynamic> stageRun,
  ) async {
    if (rawMaterials.isEmpty || warehouses.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('لا توجد خامات أو مخازن متاحة للاستهلاك')),
      );
      return;
    }
    final plannedController = TextEditingController();
    final actualController = TextEditingController();
    final wasteController = TextEditingController(text: '0');
    final unitController = TextEditingController(text: 'METER');
    String? rawMaterialId;
    String? warehouseId;

    final payload = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('استهلاك خامة'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: rawMaterialId,
                  decoration: const InputDecoration(labelText: 'الخامة'),
                  items: rawMaterials.map((item) {
                    final material = _asMap(item);
                    return DropdownMenuItem(
                      value: _string(material['id']),
                      child: Text(_string(material['name'])),
                    );
                  }).toList(),
                  onChanged: (value) => setState(() => rawMaterialId = value),
                ),
                DropdownButtonFormField<String>(
                  initialValue: warehouseId,
                  decoration: const InputDecoration(labelText: 'المخزن'),
                  items: warehouses.map((item) {
                    final warehouse = _asMap(item);
                    return DropdownMenuItem(
                      value: _string(warehouse['id']),
                      child: Text(_string(warehouse['name'])),
                    );
                  }).toList(),
                  onChanged: (value) => setState(() => warehouseId = value),
                ),
                _decimalField(plannedController, 'الكمية المخططة'),
                _decimalField(actualController, 'الكمية الفعلية'),
                _decimalField(wasteController, 'كمية الهدر'),
                TextField(
                  controller: unitController,
                  decoration: const InputDecoration(labelText: 'الوحدة'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: () {
                final planned = double.tryParse(plannedController.text);
                final actual = double.tryParse(actualController.text);
                final waste = double.tryParse(wasteController.text);
                if (rawMaterialId == null ||
                    warehouseId == null ||
                    planned == null ||
                    actual == null ||
                    waste == null ||
                    planned <= 0 ||
                    actual <= 0 ||
                    waste < 0 ||
                    waste > actual ||
                    unitController.text.trim().isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('أدخل بيانات الاستهلاك بصورة صحيحة')),
                  );
                  return;
                }
                Navigator.pop(dialogContext, {
                  'stageRunId': _string(stageRun['id']),
                  'rawMaterialId': rawMaterialId,
                  'warehouseId': warehouseId,
                  'plannedQuantity': planned,
                  'actualQuantity': actual,
                  'wasteQuantity': waste,
                  'unit': unitController.text.trim(),
                });
              },
              child: const Text('حفظ'),
            ),
          ],
        ),
      ),
    );
    plannedController.dispose();
    actualController.dispose();
    wasteController.dispose();
    unitController.dispose();
    if (payload != null) onConsumeMaterial(payload);
  }

  Widget _numberField(TextEditingController controller, String label) => TextField(
        controller: controller,
        keyboardType: TextInputType.number,
        decoration: InputDecoration(labelText: label),
      );

  Widget _decimalField(TextEditingController controller, String label) => TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(labelText: label),
      );

  static List<dynamic> _asList(dynamic value) => value is List ? value : const [];

  static Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  static String _string(dynamic value) => value?.toString() ?? '';

  static String _stageLabel(String stage) {
    switch (stage) {
      case 'CUTTING':
        return 'القص';
      case 'SEWING':
        return 'الخياطة';
      case 'IRONING':
        return 'الكي';
      case 'PACKING':
        return 'التعبئة';
      default:
        return stage;
    }
  }

  static String _translateStatus(String status, String currentStage) {
    if (status == 'PLANNED') return 'مخطط';
    if (status == 'COMPLETED') return 'مكتمل';
    if (status == 'CANCELLED') return 'ملغى';
    if (currentStage.isNotEmpty) return 'مرحلة ${_stageLabel(currentStage)}';
    return status;
  }

  static IconData _statusIcon(String status) {
    switch (status) {
      case 'PLANNED':
        return Icons.calendar_today;
      case 'COMPLETED':
        return Icons.check_circle;
      case 'CANCELLED':
        return Icons.cancel;
      default:
        return Icons.sync;
    }
  }

  static Color _statusColor(String status) {
    switch (status) {
      case 'PLANNED':
        return AppColors.statusPlanned;
      case 'COMPLETED':
        return AppColors.statusCompleted;
      case 'CANCELLED':
        return AppColors.statusCancelled;
      default:
        return AppColors.primary;
    }
  }
}

class _OrderSummary extends StatelessWidget {
  const _OrderSummary({required this.order, required this.variant});

  final Map<String, dynamic> order;
  final Map<String, dynamic> variant;

  @override
  Widget build(BuildContext context) {
    final createdAt = DateTime.tryParse(_string(order['createdAt']));
    return Wrap(
      spacing: 16,
      runSpacing: 8,
      children: [
        _SummaryItem(
          icon: Icons.straighten,
          label: 'المقاس',
          value: _string(variant['size']),
        ),
        _SummaryItem(
          icon: Icons.palette_outlined,
          label: 'اللون',
          value: _string(variant['color']),
        ),
        if (createdAt != null)
          _SummaryItem(
            icon: Icons.event,
            label: 'تاريخ الإنشاء',
            value: DateFormat('yyyy-MM-dd').format(createdAt),
          ),
      ],
    );
  }

  static String _string(dynamic value) => value?.toString() ?? '';
}

class _SummaryItem extends StatelessWidget {
  const _SummaryItem({required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 18, color: AppColors.textSecondary),
        const SizedBox(width: 5),
        Text('$label: $value', style: const TextStyle(fontFamily: 'Cairo')),
      ],
    );
  }
}

class _StageTimeline extends StatelessWidget {
  const _StageTimeline({
    required this.stages,
    required this.currentStage,
    required this.stageRuns,
  });

  final List<String> stages;
  final String currentStage;
  final List<dynamic> stageRuns;

  @override
  Widget build(BuildContext context) {
    final currentIndex = stages.indexOf(currentStage);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'مراحل أمر التشغيل',
          style: TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Cairo'),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            for (var index = 0; index < stages.length; index++) ...[
              Expanded(child: _stageNode(index)),
              if (index < stages.length - 1)
                Expanded(
                  child: Container(
                    height: 2,
                    color: index < currentIndex
                        ? AppColors.success
                        : AppColors.divider,
                  ),
                ),
            ],
          ],
        ),
      ],
    );
  }

  Widget _stageNode(int index) {
    final stage = stages[index];
    Map<String, dynamic>? run;
    for (final item in stageRuns) {
      final candidate = _asMap(item);
      if (_string(candidate['stage']) == stage) {
        run = candidate;
        break;
      }
    }
    final isCompleted = _string(run?['status']) == 'COMPLETED';
    final isCurrent = stage == currentStage;
    final color = isCompleted
        ? AppColors.success
        : isCurrent
            ? AppColors.primary
            : AppColors.divider;
    return Column(
      children: [
        CircleAvatar(
          radius: 15,
          backgroundColor: color,
          child: Icon(
            isCompleted ? Icons.check : Icons.factory_outlined,
            size: 16,
            color: isCompleted || isCurrent ? Colors.white : AppColors.textSecondary,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          _stageLabel(stage),
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 11,
            fontFamily: 'Cairo',
            fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
            color: isCurrent ? AppColors.primary : AppColors.textSecondary,
          ),
        ),
      ],
    );
  }

  static Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  static String _string(dynamic value) => value?.toString() ?? '';

  static String _stageLabel(String stage) {
    switch (stage) {
      case 'CUTTING':
        return 'قص';
      case 'SEWING':
        return 'خياطة';
      case 'IRONING':
        return 'كي';
      case 'PACKING':
        return 'تعبئة';
      default:
        return stage;
    }
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: AppColors.error, size: 58),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontFamily: 'Cairo', color: AppColors.error),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      ),
    );
  }
}

class _InlineErrorBanner extends StatelessWidget {
  const _InlineErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: AppColors.error.withValues(alpha: 0.08),
      padding: const EdgeInsets.all(10),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style: const TextStyle(color: AppColors.error, fontFamily: 'Cairo'),
      ),
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView({required this.onRefresh});

  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.precision_manufacturing_outlined, size: 60, color: AppColors.textSecondary),
          const SizedBox(height: 12),
          const Text('لا توجد أوامر تشغيل حالياً', style: TextStyle(fontFamily: 'Cairo')),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onRefresh,
            icon: const Icon(Icons.refresh),
            label: const Text('تحديث'),
          ),
        ],
      ),
    );
  }
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

