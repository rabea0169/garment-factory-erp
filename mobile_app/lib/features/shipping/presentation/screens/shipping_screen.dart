import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../cubit/shipping_cubit.dart';
import '../cubit/shipping_state.dart';

class ShippingScreen extends StatelessWidget {
  const ShippingScreen({super.key, this.cubit});

  final ShippingCubit? cubit;

  @override
  Widget build(BuildContext context) {
    final content = Builder(
      builder: (screenContext) => Scaffold(
        appBar: AppBar(
          title: const Text('الشحن والتوصيل'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'تحديث',
              onPressed: () =>
                  screenContext.read<ShippingCubit>().fetchShipments(),
            ),
          ],
        ),
        body: BlocBuilder<ShippingCubit, ShippingState>(
          builder: (context, state) {
            if (state is ShippingLoading || state is ShippingInitial) {
              return const AppLoadingView();
            }
            if (state is ShippingError) {
              return AppErrorView(
                message: state.message,
                onRetry: () => context.read<ShippingCubit>().fetchShipments(),
              );
            }
            if (state is ShippingLoaded) {
              if (state.shipments.isEmpty) {
                return AppEmptyView(
                  title: 'لا توجد شحنات مسجلة حاليًا',
                  actionLabel: 'إعادة التحميل',
                  onAction: () =>
                      context.read<ShippingCubit>().fetchShipments(),
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: state.shipments.length,
                itemBuilder: (context, index) {
                  final shipment = state.shipments[index] as Map;
                  final tracking = shipment['trackingNumber']?.toString();
                  final shippingCompanyId =
                      shipment['shippingCompanyId']?.toString();
                  final salesOrder = shipment['salesOrder'] as Map?;
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ListTile(
                      leading: const CircleAvatar(
                        backgroundColor: AppColors.primary,
                        child: Icon(Icons.local_shipping, color: Colors.white),
                      ),
                      title: Text(
                        tracking == null || tracking.isEmpty
                            ? 'شحنة ${shipment['code'] ?? ''}'
                            : 'تتبع: $tracking',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontFamily: 'Cairo',
                        ),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                              'شركة الشحن: ${shippingCompanyId ?? 'غير محددة'}'),
                          Text(
                              'أمر البيع: ${salesOrder?['code'] ?? 'غير متوفر'}'),
                          Text(
                              'الحالة: ${_translateStatus('${shipment['status'] ?? ''}')}'),
                          Text(_formatDate(shipment['createdAt'])),
                        ],
                      ),
                      trailing: IconButton(
                        icon:
                            const Icon(Icons.edit, color: AppColors.secondary),
                        tooltip: 'تحديث الحالة',
                        onPressed: () => _showUpdateStatusDialog(
                          screenContext,
                          shipment,
                        ),
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
          onPressed: () => _showCreateShipmentDialog(screenContext),
          icon: const Icon(Icons.add_box),
          label: const Text('شحنة جديدة'),
        ),
      ),
    );

    if (cubit != null) {
      return BlocProvider<ShippingCubit>.value(value: cubit!, child: content);
    }
    return BlocProvider<ShippingCubit>(
      create: (_) => ShippingCubit()..fetchShipments(),
      child: content,
    );
  }

  Future<void> _showCreateShipmentDialog(BuildContext context) async {
    final cubit = context.read<ShippingCubit>();
    try {
      final orders = await cubit.fetchConfirmedSalesOrders();
      if (!context.mounted) return;
      if (orders.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('لا توجد أوامر بيع مؤكدة جاهزة للشحن')),
        );
        return;
      }
      final saved = await showDialog<bool>(
        context: context,
        builder: (_) => _CreateShipmentDialog(
          cubit: cubit,
          confirmedOrders: orders,
        ),
      );
      if (saved == true && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إنشاء الشحنة بنجاح')),
        );
      }
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(
                'تعذر تحميل أوامر البيع: ${ApiClient.instance.messageFor(error)}')),
      );
    }
  }

  Future<void> _showUpdateStatusDialog(
    BuildContext context,
    Map shipment,
  ) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _UpdateShipmentDialog(
        cubit: context.read<ShippingCubit>(),
        shipment: shipment,
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تحديث حالة الشحنة')),
      );
    }
  }

  static String _formatDate(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '');
    if (date == null) return 'التاريخ غير متوفر';
    return DateFormat('yyyy-MM-dd hh:mm a').format(date.toLocal());
  }

  static String _translateStatus(String status) {
    switch (status) {
      case 'PREPARING':
        return 'تجهيز';
      case 'SHIPPED':
        return 'تم الشحن';
      case 'IN_TRANSIT':
        return 'في الطريق';
      case 'DELIVERED':
        return 'تم التسليم';
      case 'RETURNED':
        return 'مرتجع';
      default:
        return status.isEmpty ? 'غير محددة' : status;
    }
  }
}

class _CreateShipmentDialog extends StatefulWidget {
  const _CreateShipmentDialog({
    required this.cubit,
    required this.confirmedOrders,
  });

  final ShippingCubit cubit;
  final List<Map<String, dynamic>> confirmedOrders;

  @override
  State<_CreateShipmentDialog> createState() => _CreateShipmentDialogState();
}

class _CreateShipmentDialogState extends State<_CreateShipmentDialog> {
  final _formKey = GlobalKey<FormState>();
  String? _selectedSalesOrderId;
  final _shippingCompanyIdController = TextEditingController();
  final _shippingCostController = TextEditingController();
  final _trackingController = TextEditingController();
  final _notesController = TextEditingController();
  var _isSaving = false;

  @override
  void dispose() {
    _shippingCompanyIdController.dispose();
    _shippingCostController.dispose();
    _trackingController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.createShipment(
        salesOrderId: _selectedSalesOrderId!,
        shippingCompanyId: _shippingCompanyIdController.text.trim(),
        shippingCost: double.tryParse(_shippingCostController.text.trim()),
        trackingNumber: _trackingController.text.trim(),
        notes: _notesController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تعذر إنشاء الشحنة. تحقق من أمر البيع والصلاحيات.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('إنشاء شحنة جديدة'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _selectedSalesOrderId,
                  decoration: const InputDecoration(
                    labelText: 'أمر البيع المؤكد *',
                    helperText: 'اختر أمرًا مؤكدًا من القائمة',
                  ),
                  items: widget.confirmedOrders
                      .where((order) => order['id'] != null)
                      .map(
                        (order) => DropdownMenuItem<String>(
                          value: '${order['id']}',
                          child: Text(
                            '${order['code'] ?? order['id']} — ${order['customer']?['name'] ?? 'عميل'}',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: _isSaving
                      ? null
                      : (value) =>
                          setState(() => _selectedSalesOrderId = value),
                  validator: (value) => value == null ? 'اختر أمر البيع' : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _shippingCompanyIdController,
                  decoration: const InputDecoration(
                    labelText: 'معرف شركة الشحن',
                  ),
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _shippingCostController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'تكلفة الشحن'),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) return null;
                    final cost = double.tryParse(value.trim());
                    return cost == null || cost < 0
                        ? 'أدخل تكلفة صحيحة غير سالبة'
                        : null;
                  },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _trackingController,
                  decoration: const InputDecoration(labelText: 'رقم التتبع'),
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _notesController,
                  maxLines: 2,
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
        FilledButton.icon(
          onPressed: _isSaving ? null : _save,
          icon: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_outlined),
          label: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ'),
        ),
      ],
    );
  }
}

class _UpdateShipmentDialog extends StatefulWidget {
  const _UpdateShipmentDialog({required this.cubit, required this.shipment});

  final ShippingCubit cubit;
  final Map shipment;

  @override
  State<_UpdateShipmentDialog> createState() => _UpdateShipmentDialogState();
}

class _UpdateShipmentDialogState extends State<_UpdateShipmentDialog> {
  final _formKey = GlobalKey<FormState>();
  final _proofController = TextEditingController();
  late final String _currentStatus;
  late String _nextStatus;
  var _isSaving = false;

  @override
  void initState() {
    super.initState();
    _currentStatus = '${widget.shipment['status'] ?? 'PREPARING'}';
    _nextStatus =
        _availableStatusesFor(_currentStatus).firstOrNull ?? _currentStatus;
  }

  @override
  void dispose() {
    _proofController.dispose();
    super.dispose();
  }

  List<String> get _nextStatuses => _availableStatusesFor(_currentStatus);

  static List<String> _availableStatusesFor(String status) {
    switch (status) {
      case 'PREPARING':
        return ['SHIPPED'];
      case 'SHIPPED':
        return ['IN_TRANSIT'];
      case 'IN_TRANSIT':
        return ['DELIVERED', 'RETURNED'];
      default:
        return [];
    }
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.updateShipmentStatus(
        shipmentId: '${widget.shipment['id']}',
        status: _nextStatus,
        proofOfDelivery: _proofController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('تعذر تحديث حالة الشحنة. تحقق من الانتقال.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final options = _nextStatuses;
    return AlertDialog(
      title: const Text('تحديث حالة الشحنة'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
                'الحالة الحالية: ${ShippingScreen._translateStatus(_currentStatus)}'),
            const SizedBox(height: 12),
            if (options.isEmpty)
              const Text('لا توجد انتقالات متاحة لهذه الحالة.')
            else ...[
              DropdownButtonFormField<String>(
                initialValue: _nextStatus,
                decoration: const InputDecoration(labelText: 'الحالة الجديدة'),
                items: options
                    .map(
                      (value) => DropdownMenuItem(
                        value: value,
                        child: Text(ShippingScreen._translateStatus(value)),
                      ),
                    )
                    .toList(),
                onChanged: _isSaving
                    ? null
                    : (value) {
                        if (value != null) setState(() => _nextStatus = value);
                      },
              ),
              const SizedBox(height: 10),
              TextFormField(
                controller: _proofController,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'إثبات التسليم',
                  helperText: 'مطلوب عند اختيار تم التسليم',
                ),
                validator: (value) => _nextStatus == 'DELIVERED' &&
                        (value == null || value.trim().isEmpty)
                    ? 'إثبات التسليم مطلوب'
                    : null,
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        if (options.isNotEmpty)
          FilledButton(
            onPressed: _isSaving ? null : _save,
            child: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ'),
          ),
      ],
    );
  }
}
