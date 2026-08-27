import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/constants/app_colors.dart';
import '../../domain/entities/production_commands.dart';
import '../../domain/entities/work_order.dart';
import '../../production_module.dart';
import '../cubit/production_cubit.dart';
import '../cubit/production_state.dart';

class ProductionScreen extends StatelessWidget {
  const ProductionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => createProductionCubit()..fetchWorkOrders(),
      child: const _ProductionView(),
    );
  }
}

class _ProductionView extends StatelessWidget {
  const _ProductionView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('الإنتاج وأوامر التشغيل'),
        actions: [
          IconButton(
            tooltip: 'تحديث',
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                context.read<ProductionCubit>().fetchWorkOrders(refresh: true),
          ),
        ],
      ),
      body: BlocConsumer<ProductionCubit, ProductionState>(
        listener: (context, state) {
          if (state is ProductionUnauthorized) {
            _showMessage(context, 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
          } else if (state is ProductionOffline) {
            _showMessage(context, 'تعذر الاتصال بالخادم، تحقق من الشبكة');
          } else if (state is ProductionFailure) {
            _showMessage(context, state.failure.message);
          }
        },
        builder: (context, state) {
          if (state is ProductionLoading || state is ProductionInitial) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is ProductionEmpty) {
            return _EmptyProductionView(
              onRefresh: () =>
                  context.read<ProductionCubit>().fetchWorkOrders(),
            );
          }
          if (state is ProductionLoaded) {
            return Stack(
              children: [
                _WorkOrderList(orders: state.workOrders),
                if (state.isRefreshing)
                  const Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    child: LinearProgressIndicator(),
                  ),
              ],
            );
          }
          if (state is ProductionFailure) {
            return _ErrorProductionView(
              message: state.failure.message,
              onRetry: () => context.read<ProductionCubit>().fetchWorkOrders(),
            );
          }
          if (state is ProductionOffline) {
            return _ErrorProductionView(
              message: 'لا يوجد اتصال بالخادم',
              onRetry: () => context.read<ProductionCubit>().fetchWorkOrders(),
            );
          }
          if (state is ProductionUnauthorized) {
            return const Center(child: Text('يرجى تسجيل الدخول للمتابعة'));
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }

  static void _showMessage(BuildContext context, String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }
}

class _WorkOrderList extends StatelessWidget {
  const _WorkOrderList({required this.orders});

  final List<WorkOrder> orders;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: orders.length,
      itemBuilder: (context, index) => _WorkOrderCard(order: orders[index]),
    );
  }
}

class _WorkOrderCard extends StatelessWidget {
  const _WorkOrderCard({required this.order});

  final WorkOrder order;

  @override
  Widget build(BuildContext context) {
    final nextStage = _nextStage(order);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        leading: _statusIcon(order.status),
        title: Text(
          '${order.productName} (مقاس: ${order.variantSize})',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text(
          'الكمية: ${order.quantity} قطعة | الحالة: ${_statusLabel(order.status)}',
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'رقم الأمر: ${order.code}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                Text(
                  'تاريخ الإضافة: ${DateFormat('yyyy-MM-dd').format(order.createdAt)}',
                ),
                if (order.currentStage != null &&
                    order.status != WorkOrderStatus.completed &&
                    order.status != WorkOrderStatus.cancelled) ...[
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.fact_check_outlined),
                      label: const Text('تسجيل مخرجات المرحلة'),
                      onPressed: () => showDialog<void>(
                        context: context,
                        builder: (_) => _RecordStageOutputDialog(
                          workOrder: order,
                          stage: order.currentStage!,
                        ),
                      ),
                    ),
                  ),
                ],
                if (nextStage != null) ...[
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      icon: const Icon(Icons.arrow_forward),
                      label: Text('الانتقال إلى ${_stageLabel(nextStage)}'),
                      onPressed: () =>
                          context.read<ProductionCubit>().transitionStage(
                                workOrderId: order.id,
                                stage: nextStage,
                              ),
                    ),
                  ),
                ],
                if (order.status == WorkOrderStatus.completed) ...[
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.calculate_outlined),
                      label: const Text('تثبيت تكلفة الإنتاج'),
                      onPressed: () => _finalizeCost(context, order.id),
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

  static ProductionStage? _nextStage(WorkOrder order) {
    if (order.status == WorkOrderStatus.completed ||
        order.status == WorkOrderStatus.cancelled) {
      return null;
    }
    final currentStage = order.currentStage ?? _stageFromStatus(order.status);
    if (currentStage == null) return ProductionStage.cutting;
    switch (currentStage) {
      case ProductionStage.cutting:
        return ProductionStage.sewing;
      case ProductionStage.sewing:
        return ProductionStage.ironing;
      case ProductionStage.ironing:
        return ProductionStage.packing;
      case ProductionStage.packing:
        return null;
    }
  }

  static ProductionStage? _stageFromStatus(WorkOrderStatus status) {
    switch (status) {
      case WorkOrderStatus.cutting:
        return ProductionStage.cutting;
      case WorkOrderStatus.sewing:
        return ProductionStage.sewing;
      case WorkOrderStatus.ironing:
        return ProductionStage.ironing;
      case WorkOrderStatus.packing:
        return ProductionStage.packing;
      default:
        return null;
    }
  }

  static Icon _statusIcon(WorkOrderStatus status) {
    switch (status) {
      case WorkOrderStatus.planned:
        return const Icon(Icons.calendar_today, color: Colors.blue);
      case WorkOrderStatus.completed:
        return const Icon(Icons.check_circle, color: AppColors.success);
      case WorkOrderStatus.cancelled:
        return const Icon(Icons.cancel, color: AppColors.error);
      default:
        return const Icon(Icons.sync, color: AppColors.warning);
    }
  }

  static String _statusLabel(WorkOrderStatus status) {
    switch (status) {
      case WorkOrderStatus.planned:
        return 'مخطط';
      case WorkOrderStatus.cutting:
        return 'القص';
      case WorkOrderStatus.sewing:
        return 'الخياطة';
      case WorkOrderStatus.ironing:
        return 'الكي';
      case WorkOrderStatus.packing:
        return 'التغليف';
      case WorkOrderStatus.inProgress:
        return 'قيد التنفيذ';
      case WorkOrderStatus.completed:
        return 'مكتمل';
      case WorkOrderStatus.cancelled:
        return 'ملغى';
    }
  }

  static Future<void> _finalizeCost(
    BuildContext context,
    String workOrderId,
  ) async {
    final result = await context.read<ProductionCubit>().finalizeCost(
          workOrderId: workOrderId,
        );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            result == null
                ? 'تعذر تثبيت التكلفة، تحقق من اكتمال مراحل الإنتاج'
                : 'تم تثبيت تكلفة الإنتاج بنجاح',
          ),
        ),
      );
  }

  static String _stageLabel(ProductionStage stage) {
    switch (stage) {
      case ProductionStage.cutting:
        return 'القص';
      case ProductionStage.sewing:
        return 'الخياطة';
      case ProductionStage.ironing:
        return 'الكي';
      case ProductionStage.packing:
        return 'التغليف';
    }
  }
}

class _EmptyProductionView extends StatelessWidget {
  const _EmptyProductionView({required this.onRefresh});

  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.factory_outlined, size: 56, color: Colors.grey),
          const SizedBox(height: 12),
          const Text('لا توجد أوامر تشغيل حالياً'),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRefresh,
            icon: const Icon(Icons.refresh),
            label: const Text('إعادة المحاولة'),
          ),
        ],
      ),
    );
  }
}

class _ErrorProductionView extends StatelessWidget {
  const _ErrorProductionView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 52, color: AppColors.error),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
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

class _RecordStageOutputDialog extends StatefulWidget {
  const _RecordStageOutputDialog({
    required this.workOrder,
    required this.stage,
  });

  final WorkOrder workOrder;
  final ProductionStage stage;

  @override
  State<_RecordStageOutputDialog> createState() =>
      _RecordStageOutputDialogState();
}

class _RecordStageOutputDialogState extends State<_RecordStageOutputDialog> {
  final _formKey = GlobalKey<FormState>();
  final _inputController = TextEditingController();
  final _acceptedController = TextEditingController();
  final _rejectedController = TextEditingController(text: '0');
  final _wasteController = TextEditingController(text: '0');
  final _notesController = TextEditingController();
  bool _isSaving = false;

  @override
  void dispose() {
    _inputController.dispose();
    _acceptedController.dispose();
    _rejectedController.dispose();
    _wasteController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  String? _requiredInteger(String? value, String label) {
    final parsed = int.tryParse(value?.trim() ?? '');
    if (parsed == null || parsed < 0) return '$label يجب أن يكون عددًا صحيحًا';
    return null;
  }

  Future<void> _save() async {
    if (_isSaving || !(_formKey.currentState?.validate() ?? false)) return;
    final inputQty = int.parse(_inputController.text.trim());
    final acceptedQty = int.parse(_acceptedController.text.trim());
    final rejectedQty = int.parse(_rejectedController.text.trim());
    final wasteQty = int.parse(_wasteController.text.trim());
    if (inputQty != acceptedQty + rejectedQty + wasteQty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content:
              Text('يجب أن تساوي الكمية الداخلة مجموع المقبول والرفض والهالك'),
        ),
      );
      return;
    }

    setState(() => _isSaving = true);
    final result = await context.read<ProductionCubit>().recordStageOutput(
          RecordStageOutputCommand(
            workOrderId: widget.workOrder.id,
            stage: widget.stage,
            inputQty: inputQty,
            acceptedQty: acceptedQty,
            rejectedQty: rejectedQty,
            wasteQty: wasteQty,
            idempotencyKey: const Uuid().v4(),
            notes: _notesController.text.trim().isEmpty
                ? null
                : _notesController.text.trim(),
          ),
        );
    if (!mounted) return;
    if (result == null) {
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر تسجيل مخرجات المرحلة')),
      );
      return;
    }
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('مخرجات ${_WorkOrderCard._stageLabel(widget.stage)}'),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _inputController,
                decoration: const InputDecoration(labelText: 'الكمية الداخلة'),
                keyboardType: TextInputType.number,
                validator: (value) => _requiredInteger(value, 'الكمية الداخلة'),
              ),
              TextFormField(
                controller: _acceptedController,
                decoration: const InputDecoration(labelText: 'الكمية المقبولة'),
                keyboardType: TextInputType.number,
                validator: (value) =>
                    _requiredInteger(value, 'الكمية المقبولة'),
              ),
              TextFormField(
                controller: _rejectedController,
                decoration: const InputDecoration(labelText: 'الكمية المرفوضة'),
                keyboardType: TextInputType.number,
                validator: (value) =>
                    _requiredInteger(value, 'الكمية المرفوضة'),
              ),
              TextFormField(
                controller: _wasteController,
                decoration: const InputDecoration(labelText: 'كمية الهالك'),
                keyboardType: TextInputType.number,
                validator: (value) => _requiredInteger(value, 'كمية الهالك'),
              ),
              TextFormField(
                controller: _notesController,
                decoration:
                    const InputDecoration(labelText: 'ملاحظات (اختياري)'),
                maxLines: 2,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.pop(context),
          child: const Text('إلغاء'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('حفظ'),
        ),
      ],
    );
  }
}
