import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../cubit/purchasing_cubit.dart';

class PurchasingScreen extends StatelessWidget {
  const PurchasingScreen({super.key, this.cubit});

  final PurchasingCubit? cubit;

  @override
  Widget build(BuildContext context) {
    final content = Builder(
      builder: (screenContext) => Scaffold(
        appBar: AppBar(
          title: const Text('المشتريات والاستلام'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'تحديث',
              onPressed: () =>
                  screenContext.read<PurchasingCubit>().fetchData(),
            ),
          ],
        ),
        body: BlocBuilder<PurchasingCubit, PurchasingState>(
          builder: (context, state) {
            if (state is PurchasingInitial || state is PurchasingLoading) {
              return const AppLoadingView();
            }
            if (state is PurchasingError) {
              return AppErrorView(
                message: state.message,
                onRetry: () => context.read<PurchasingCubit>().fetchData(),
              );
            }
            if (state is PurchasingLoaded) {
              if (state.orders.isEmpty) {
                return AppEmptyView(
                  title: 'لا توجد أوامر شراء',
                  actionLabel: 'إعادة التحميل',
                  onAction: () => context.read<PurchasingCubit>().fetchData(),
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: state.orders.length,
                itemBuilder: (context, index) {
                  final order = state.orders[index] as Map;
                  final supplier = order['supplier'] as Map?;
                  final items = order['items'] as List? ?? const [];
                  final status = '${order['status'] ?? ''}';
                  // الاستلام متاح للأوامر APPROVED فقط (خادميًا) — إظهار
                  // الزر لغيرها كان يضمن رسالة 400 مضللة.
                  final canReceive = status == 'APPROVED';
                  final canApprove = status == 'DRAFT';
                  final canCancel = status == 'DRAFT';
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ExpansionTile(
                      leading: const CircleAvatar(
                        child: Icon(Icons.inventory_2_outlined),
                      ),
                      title: Text('${order['code'] ?? 'أمر شراء'}'),
                      subtitle: Text(
                        'المورد: ${supplier?['name'] ?? order['supplierId'] ?? 'غير محدد'} | '
                        'الإجمالي: ${order['totalAmount'] ?? 0} جنيه\n'
                        'الحالة: ${_translateStatus(status)}',
                      ),
                      children: [
                        ...items.map<Widget>((item) {
                          final itemMap = item as Map;
                          final material = itemMap['rawMaterial'] as Map?;
                          final received =
                              (itemMap['receivedQuantity'] as num?) ?? 0;
                          return ListTile(
                            dense: true,
                            leading: const Icon(Icons.category_outlined),
                            title: Text(
                                'خامة: ${material?['name'] ?? itemMap['rawMaterialId'] ?? 'غير محددة'}'),
                            subtitle: Text(
                              'الكمية: ${itemMap['quantity'] ?? 0} | المستلم: $received | تكلفة الوحدة: ${itemMap['unitCost'] ?? 0}',
                            ),
                          );
                        }),
                        if (canApprove)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                            child: SizedBox(
                              width: double.infinity,
                              child: FilledButton.icon(
                                onPressed: () => _approveOrder(
                                  screenContext,
                                  '${order['id']}',
                                ),
                                icon: const Icon(Icons.verified_outlined),
                                label: const Text('اعتماد أمر الشراء'),
                              ),
                            ),
                          ),
                        if (canCancel)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                            child: SizedBox(
                              width: double.infinity,
                              child: OutlinedButton.icon(
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.red.shade700,
                                ),
                                onPressed: () => _cancelOrder(
                                  screenContext,
                                  '${order['id']}',
                                ),
                                icon: const Icon(Icons.cancel_outlined),
                                label: const Text('إلغاء المسودة'),
                              ),
                            ),
                          ),
                        if (canReceive)
                          Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: Padding(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                              child: OutlinedButton.icon(
                                onPressed: () => _showReceiveDialog(
                                  screenContext,
                                  order,
                                ),
                                icon: const Icon(Icons.move_to_inbox_outlined),
                                label: const Text('تسجيل استلام'),
                              ),
                            ),
                          ),
                        if (status != 'DRAFT' && status != 'CANCELLED')
                          Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: Padding(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                              child: OutlinedButton.icon(
                                onPressed: () => _showReturnDialog(
                                  screenContext,
                                  order,
                                ),
                                icon: const Icon(
                                    Icons.assignment_return_outlined),
                                label: const Text('مرتجع للمورد'),
                              ),
                            ),
                          ),
                      ],
                    ),
                  );
                },
              );
            }
            return const SizedBox.shrink();
          },
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => _showCreateOrderDialog(screenContext),
          icon: const Icon(Icons.add_business),
          label: const Text('أمر شراء جديد'),
        ),
      ),
    );

    if (cubit != null) {
      return BlocProvider<PurchasingCubit>.value(value: cubit!, child: content);
    }
    return BlocProvider<PurchasingCubit>(
      create: (_) => PurchasingCubit()..fetchData(),
      child: content,
    );
  }

  Future<void> _showCreateOrderDialog(BuildContext context) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _CreatePurchaseOrderDialog(
        cubit: context.read<PurchasingCubit>(),
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إنشاء أمر الشراء')),
      );
    }
  }

  Future<void> _approveOrder(BuildContext context, String orderId) async {
    final error = await context
        .read<PurchasingCubit>()
        .approvePurchaseOrder(purchaseOrderId: orderId);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          error ?? 'تم اعتماد أمر الشراء — صار الاستلام متاحًا',
        ),
        backgroundColor: error == null ? Colors.green.shade700 : null,
      ),
    );
  }

  Future<void> _cancelOrder(BuildContext context, String orderId) async {
    // نقرأ الـ cubit قبل أي فجوة async (قاعدة use_build_context_synchronously).
    final cubit = context.read<PurchasingCubit>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('إلغاء مسودة أمر الشراء'),
        content: const Text('هل تريد إلغاء هذه المسودة؟ لا يمكن التراجع.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('تراجع'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: Colors.red.shade700),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('إلغاء المسودة'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final error = await cubit.cancelPurchaseOrder(purchaseOrderId: orderId);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(error ?? 'تم إلغاء مسودة أمر الشراء'),
        backgroundColor: error == null ? Colors.green.shade700 : null,
      ),
    );
  }

  Future<void> _showReturnDialog(BuildContext context, Map order) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _ReturnToSupplierDialog(
        cubit: context.read<PurchasingCubit>(),
        order: order,
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل مرتجع المورد وتحديث المخزون')),
      );
    }
  }

  Future<void> _showReceiveDialog(BuildContext context, Map order) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _ReceivePurchaseDialog(
        cubit: context.read<PurchasingCubit>(),
        order: order,
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل الاستلام وتحديث المخزون')),
      );
    }
  }

  static String _translateStatus(String status) {
    switch (status) {
      case 'DRAFT':
        return 'مسودة — بانتظار الاعتماد';
      case 'APPROVED':
        return 'معتمد — جاهز للاستلام';
      case 'PENDING':
        return 'استلام جزئي';
      case 'RECEIVED':
        return 'مستلم بالكامل';
      case 'CANCELLED':
        return 'ملغى';
      default:
        return status.isEmpty ? 'غير محددة' : status;
    }
  }
}

class _CreatePurchaseOrderDialog extends StatefulWidget {
  const _CreatePurchaseOrderDialog({required this.cubit});

  final PurchasingCubit cubit;

  @override
  State<_CreatePurchaseOrderDialog> createState() =>
      _CreatePurchaseOrderDialogState();
}

class _CreatePurchaseOrderDialogState
    extends State<_CreatePurchaseOrderDialog> {
  final _formKey = GlobalKey<FormState>();
  final _quantityController = TextEditingController(text: '1');
  final _unitCostController = TextEditingController();
  final _notesController = TextEditingController();
  String? _supplierId;
  String? _rawMaterialId;
  var _paymentType = 'CASH';
  var _isSaving = false;

  @override
  void dispose() {
    _quantityController.dispose();
    _unitCostController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save(PurchasingLoaded state) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.createPurchaseOrder(
        supplierId: _supplierId!,
        paymentType: _paymentType,
        notes: _notesController.text.trim(),
        items: [
          {
            'rawMaterialId': _rawMaterialId,
            'quantity': double.parse(_quantityController.text.trim()),
            'unitCost': double.parse(_unitCostController.text.trim()),
          },
        ],
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      // P2 (audit-FE2): رسالة الخادم الفعلية (validation/403/409) بدل عامة.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(
                'تعذر إنشاء أمر الشراء: ${ApiClient.instance.messageFor(e)}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.cubit.state;
    if (state is! PurchasingLoaded) {
      return const AlertDialog(
          content: Text(
              'بيانات الموردين والخامات غير متاحة. حدّث الشاشة وحاول مرة أخرى.'));
    }
    return AlertDialog(
      title: const Text('إنشاء أمر شراء'),
      content: SizedBox(
        width: 460,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _supplierId,
                  decoration: const InputDecoration(labelText: 'المورد *'),
                  items: state.suppliers
                      .whereType<Map>()
                      .where((supplier) => supplier['id'] != null)
                      .map((supplier) => DropdownMenuItem<String>(
                            value: supplier['id'].toString(),
                            child: Text('${supplier['name'] ?? 'مورد'}'),
                          ))
                      .toList(),
                  onChanged: _isSaving
                      ? null
                      : (value) => setState(() => _supplierId = value),
                  validator: (value) => value == null ? 'اختر المورد' : null,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _rawMaterialId,
                  decoration: const InputDecoration(labelText: 'الخامة *'),
                  items: state.rawMaterials
                      .whereType<Map>()
                      .where((material) => material['id'] != null)
                      .map((material) => DropdownMenuItem<String>(
                            value: material['id'].toString(),
                            child: Text(
                                '${material['name'] ?? material['code'] ?? 'خامة'}'),
                          ))
                      .toList(),
                  onChanged: _isSaving
                      ? null
                      : (value) => setState(() => _rawMaterialId = value),
                  validator: (value) => value == null ? 'اختر الخامة' : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _quantityController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'الكمية *'),
                  validator: (value) {
                    final quantity = double.tryParse(value?.trim() ?? '');
                    return quantity == null || quantity <= 0
                        ? 'أدخل كمية موجبة'
                        : null;
                  },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _unitCostController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration:
                      const InputDecoration(labelText: 'تكلفة الوحدة *'),
                  validator: (value) {
                    final cost = double.tryParse(value?.trim() ?? '');
                    return cost == null || cost < 0 ? 'أدخل تكلفة صحيحة' : null;
                  },
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _paymentType,
                  decoration: const InputDecoration(labelText: 'نوع الدفع'),
                  items: const [
                    DropdownMenuItem(value: 'CASH', child: Text('نقدي')),
                    DropdownMenuItem(value: 'CREDIT', child: Text('آجل')),
                    DropdownMenuItem(value: 'PARTIAL', child: Text('جزئي')),
                  ],
                  onChanged: _isSaving
                      ? null
                      : (value) {
                          if (value != null) {
                            setState(() => _paymentType = value);
                          }
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
          onPressed: _isSaving ? null : () => _save(state),
          child: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ'),
        ),
      ],
    );
  }
}

class _ReceivePurchaseDialog extends StatefulWidget {
  const _ReceivePurchaseDialog({required this.cubit, required this.order});

  final PurchasingCubit cubit;
  final Map order;

  @override
  State<_ReceivePurchaseDialog> createState() => _ReceivePurchaseDialogState();
}

class _ReceivePurchaseDialogState extends State<_ReceivePurchaseDialog> {
  final _formKey = GlobalKey<FormState>();
  final _quantityController = TextEditingController(text: '1');
  final _notesController = TextEditingController();
  String? _itemId;
  var _isSaving = false;

  List<Map> get _items => (widget.order['items'] as List? ?? const [])
      .whereType<Map>()
      .where((item) => item['id'] != null)
      .toList();

  /// PUR-2: كميات كسرية حتى 4 منازل (Decimal 10,4 خادميًا) —
  /// int.tryParse كان يحوّل «2.5» إلى null/failure صامت.
  double _remaining(Map item) {
    final ordered = double.tryParse('${item['quantity'] ?? 0}') ?? 0;
    final received =
        double.tryParse('${item['receivedQuantity'] ?? 0}') ?? 0;
    return (ordered - received).clamp(0, ordered);
  }

  String _remainingLabel(Map item) {
    final remaining = _remaining(item);
    // أزل الأصفار الزائدة: 3.0 → «3» و2.5 → «2.5».
    final text = remaining == remaining.roundToDouble()
        ? '${remaining.toInt()}'
        : remaining.toStringAsFixed(4).replaceAll(RegExp(r'0+$'), '').replaceAll(RegExp(r'\.$'), '');
    return text;
  }

  @override
  void dispose() {
    _quantityController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.receivePurchaseOrder(
        purchaseOrderId: '${widget.order['id']}',
        items: [
          {
            'purchaseOrderItemId': _itemId,
            'quantity': double.parse(_quantityController.text.trim()),
          },
        ],
        notes: _notesController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      // رسالة الخادم الفعلية (تجاوز المتبقي/عدم الاعتماد) بدل رسالة عامة.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(
                'تعذر تسجيل الاستلام: ${ApiClient.instance.messageFor(error)}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('تسجيل استلام'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _itemId,
              decoration: const InputDecoration(labelText: 'بند أمر الشراء *'),
              items: _items
                  .map((item) {
                    final material = item['rawMaterial'] as Map?;
                    return DropdownMenuItem<String>(
                      value: item['id'].toString(),
                      child: Text(
                          '${material?['name'] ?? item['rawMaterialId'] ?? ''} — متبقي ${_remainingLabel(item)}'),
                    );
                  })
                  .toList(),
              onChanged:
                  _isSaving ? null : (value) => setState(() => _itemId = value),
              validator: (value) => value == null ? 'اختر بندًا' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _quantityController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                  labelText: 'كمية الاستلام *',
                  hintText: 'يقبل كسورًا حتى 4 منازل، مثل 2.5'),
              validator: (value) {
                final quantity = double.tryParse(value?.trim() ?? '');
                if (quantity == null || quantity <= 0) {
                  return 'أدخل عددًا موجبًا (كسورًا مسموحة)';
                }
                final item = _items.cast<Map?>().firstWhere(
                      (item) => item?['id']?.toString() == _itemId,
                      orElse: () => null,
                    );
                final remaining = item == null ? 0.0 : _remaining(item);
                return quantity > remaining
                    ? 'الكمية تتجاوز المتبقي (${item == null ? '0' : _remainingLabel(item)})'
                    : null;
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

class _ReturnToSupplierDialog extends StatefulWidget {
  const _ReturnToSupplierDialog({required this.cubit, required this.order});

  final PurchasingCubit cubit;
  final Map order;

  @override
  State<_ReturnToSupplierDialog> createState() =>
      _ReturnToSupplierDialogState();
}

class _ReturnToSupplierDialogState extends State<_ReturnToSupplierDialog> {
  final _formKey = GlobalKey<FormState>();
  final _quantityController = TextEditingController(text: '1');
  final _notesController = TextEditingController();
  String? _itemId;
  var _isSaving = false;

  List<Map> get _items => (widget.order['items'] as List? ?? const [])
      .whereType<Map>()
      .where((item) => item['id'] != null)
      .toList();

  /// receivedQuantity أصبح متاحًا من إسقاط PUR-6 المُحسّن (UAT-FIX)
  /// خادميًا — كان قبل الإصلاح غير موجود فتُعرض القائمة فارغة دائمًا.
  double _received(Map item) {
    return double.tryParse('${item['receivedQuantity'] ?? 0}') ?? 0;
  }

  String _receivedLabel(Map item) {
    final received = _received(item);
    return received == received.roundToDouble()
        ? '${received.toInt()}'
        : received.toStringAsFixed(4).replaceAll(RegExp(r'0+$'), '').replaceAll(RegExp(r'\.$'), '');
  }

  @override
  void dispose() {
    _quantityController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_isSaving || !(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.returnToSupplier(
        purchaseOrderId: '${widget.order['id']}',
        purchaseOrderItemId: _itemId!,
        quantity: double.parse(_quantityController.text.trim()),
        notes: _notesController.text.trim(),
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(
                'تعذر تسجيل المرتجع: ${ApiClient.instance.messageFor(error)}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('مرتجع إلى المورد'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _itemId,
              decoration: const InputDecoration(labelText: 'البند المستلم *'),
              items: _items
                  .where((item) => _received(item) > 0)
                  .map(
                    (item) {
                      final material = item['rawMaterial'] as Map?;
                      return DropdownMenuItem<String>(
                        value: '${item['id']}',
                        child: Text(
                          '${material?['name'] ?? item['rawMaterialId'] ?? ''} — مستلم ${_receivedLabel(item)}',
                        ),
                      );
                    },
                  )
                  .toList(),
              onChanged:
                  _isSaving ? null : (value) => setState(() => _itemId = value),
              validator: (value) => value == null ? 'اختر بندًا مستلمًا' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _quantityController,
              enabled: !_isSaving,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'كمية المرتجع *'),
              validator: (value) {
                final quantity = double.tryParse(value?.trim() ?? '');
                if (quantity == null || quantity <= 0) {
                  return 'أدخل كمية موجبة';
                }
                final item = _items.cast<Map?>().firstWhere(
                      (item) => item?['id']?.toString() == _itemId,
                      orElse: () => null,
                    );
                final received = item == null ? 0.0 : _received(item);
                return quantity > received
                    ? 'الكمية تتجاوز المستلم (${item == null ? received : _receivedLabel(item)})'
                    : null;
              },
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _notesController,
              enabled: !_isSaving,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'ملاحظات'),
            ),
          ],
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
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('حفظ المرتجع'),
        ),
      ],
    );
  }
}
