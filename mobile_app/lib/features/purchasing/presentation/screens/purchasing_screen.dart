import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

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
                  final canReceive =
                      status != 'RECEIVED' && status != 'CANCELLED';
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
                          return ListTile(
                            dense: true,
                            leading: const Icon(Icons.category_outlined),
                            title: Text(
                                'خامة: ${itemMap['rawMaterialId'] ?? 'غير محددة'}'),
                            subtitle: Text(
                              'الكمية: ${itemMap['quantity'] ?? 0} | تكلفة الوحدة: ${itemMap['unitCost'] ?? 0}',
                            ),
                          );
                        }),
                        if (canReceive)
                          Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: Padding(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
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
        return 'مسودة';
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
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content:
                Text('تعذر إنشاء أمر الشراء. تحقق من البيانات والصلاحيات.')),
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
            'quantity': int.parse(_quantityController.text.trim()),
          },
        ],
        notes: _notesController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('تعذر تسجيل الاستلام. تحقق من الكمية المتبقية.')),
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
                  .map((item) => DropdownMenuItem<String>(
                        value: item['id'].toString(),
                        child: Text(
                            'خامة ${item['rawMaterialId'] ?? ''} — ${item['quantity'] ?? 0}'),
                      ))
                  .toList(),
              onChanged:
                  _isSaving ? null : (value) => setState(() => _itemId = value),
              validator: (value) => value == null ? 'اختر بندًا' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _quantityController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'كمية الاستلام *'),
              validator: (value) {
                final quantity = int.tryParse(value?.trim() ?? '');
                return quantity == null || quantity <= 0
                    ? 'أدخل عددًا صحيحًا موجبًا'
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
