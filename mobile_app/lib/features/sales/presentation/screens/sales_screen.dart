import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/contacts/contact_import_service.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/contact_import_button.dart';
import '../cubit/sales_cubit.dart';

class SalesScreen extends StatelessWidget {
  const SalesScreen({
    super.key,
    this.cubit,
    this.contactImportService,
  });

  final SalesCubit? cubit;
  final ContactImportService? contactImportService;

  @override
  Widget build(BuildContext context) {
    final content = Builder(
      builder: (screenContext) => Scaffold(
        appBar: AppBar(
          title: const Text('المبيعات والعملاء'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'تحديث',
              onPressed: () => screenContext.read<SalesCubit>().fetchOrders(),
            ),
          ],
        ),
        body: BlocBuilder<SalesCubit, SalesState>(
          builder: (context, state) {
            if (state is SalesLoading) {
              return const AppLoadingView();
            }
            if (state is SalesError) {
              return AppErrorView(
                message: state.message,
                onRetry: () => context.read<SalesCubit>().fetchOrders(),
              );
            }
            if (state is SalesLoaded) {
              final orders = state.orders;
              if (orders.isEmpty) {
                return AppEmptyView(
                  title: 'لا توجد مبيعات مسجلة',
                  actionLabel: 'إعادة التحميل',
                  onAction: () => context.read<SalesCubit>().fetchOrders(),
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: orders.length,
                itemBuilder: (context, index) {
                  final order = orders[index];
                  final customer = order['customer'] as Map?;
                  final items = order['items'] as List? ?? const [];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ExpansionTile(
                      leading: const CircleAvatar(
                        backgroundColor: AppColors.success,
                        child: Icon(Icons.receipt_long, color: Colors.white),
                      ),
                      title: Text(
                        'طلب ${order['code'] ?? ''}',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontFamily: 'Cairo',
                        ),
                      ),
                      subtitle: Text(
                        'العميل: ${customer?['name'] ?? 'غير محدد'} | الإجمالي: ${order['totalAmount'] ?? 0} جنيه',
                      ),
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: items.map<Widget>((item) {
                              final itemMap = item as Map;
                              final variant = itemMap['variant'] as Map?;
                              final product = variant?['product'] as Map?;
                              final productName = product?['name'] ?? 'منتج';
                              final size = variant?['size'] ?? '-';
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Text(
                                  '- $productName (مقاس $size): ${itemMap['quantity'] ?? 0} قطعة × ${itemMap['unitPrice'] ?? 0} جنيه',
                                  style: const TextStyle(fontFamily: 'Cairo'),
                                ),
                              );
                            }).toList(),
                          ),
                        ),
                        if ('${order['status'] ?? ''}' == 'DRAFT')
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                            child: Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton.icon(
                                    onPressed: () =>
                                        _confirmOrder(screenContext, order),
                                    icon:
                                        const Icon(Icons.check_circle_outline),
                                    label: const Text('تأكيد'),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: TextButton.icon(
                                    onPressed: () =>
                                        _cancelOrder(screenContext, order),
                                    icon: const Icon(Icons.cancel_outlined),
                                    label: const Text('إلغاء'),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        if (_canReturnOrder(order))
                          Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: Padding(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                              child: OutlinedButton.icon(
                                onPressed: () =>
                                    _showReturnDialog(screenContext, order),
                                icon: const Icon(
                                    Icons.assignment_return_outlined),
                                label: const Text('تسجيل مرتجع'),
                              ),
                            ),
                          ),
                        if (_canCollectPayment(order, customer))
                          Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: Padding(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                              child: OutlinedButton.icon(
                                onPressed: () => _showPaymentDialog(
                                  screenContext,
                                  order,
                                  customer!,
                                ),
                                icon: const Icon(Icons.payments_outlined),
                                label: Text(
                                  'تحصيل دفعة — المتبقي ${_remainingAmount(order)} جنيه',
                                ),
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
        floatingActionButton: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            FloatingActionButton.extended(
              heroTag: 'create-sales-order',
              onPressed: () => _showCreateSalesOrderDialog(screenContext),
              icon: const Icon(Icons.add_shopping_cart),
              label: const Text('أمر بيع جديد'),
            ),
            const SizedBox(height: 10),
            FloatingActionButton.extended(
              heroTag: 'create-customer',
              onPressed: () => _showAddCustomerDialog(screenContext),
              icon: const Icon(Icons.person_add_alt_1),
              label: const Text('إضافة عميل'),
            ),
          ],
        ),
      ),
    );

    if (cubit != null) {
      return BlocProvider<SalesCubit>.value(value: cubit!, child: content);
    }
    return BlocProvider<SalesCubit>(
      create: (_) => SalesCubit()..fetchOrders(),
      child: content,
    );
  }

  bool _canReturnOrder(Map<String, dynamic> order) {
    final status = '${order['status'] ?? ''}';
    return order['id'] != null &&
        (status == 'CONFIRMED' || status == 'SHIPPED');
  }

  Future<bool> _confirmAction(BuildContext context, String title) async {
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text(title),
            content: const Text('هل تريد تنفيذ هذه العملية؟'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('إلغاء'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('تأكيد'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _confirmOrder(
    BuildContext context,
    Map<String, dynamic> order,
  ) async {
    final salesCubit = context.read<SalesCubit>();
    if (!await _confirmAction(context, 'تأكيد أمر البيع')) return;
    try {
      await salesCubit.confirmOrder('${order['id']}');
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تأكيد أمر البيع وصرف المخزون')),
      );
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiClient.instance.messageFor(error))),
      );
    }
  }

  Future<void> _cancelOrder(
    BuildContext context,
    Map<String, dynamic> order,
  ) async {
    final salesCubit = context.read<SalesCubit>();
    if (!await _confirmAction(context, 'إلغاء أمر البيع')) return;
    try {
      await salesCubit.cancelOrder('${order['id']}');
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إلغاء أمر البيع')),
      );
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiClient.instance.messageFor(error))),
      );
    }
  }

  Future<void> _showReturnDialog(
    BuildContext context,
    Map<String, dynamic> order,
  ) async {
    final items = (order['items'] as List?)
            ?.whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .where((item) => item['id'] != null)
            .toList() ??
        const <Map<String, dynamic>>[];
    if (items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('لا توجد بنود صالحة لتسجيل المرتجع')),
      );
      return;
    }
    final returned = await showDialog<bool>(
      context: context,
      builder: (_) => _SalesReturnDialog(
        salesCubit: context.read<SalesCubit>(),
        orderId: '${order['id']}',
        items: items,
      ),
    );
    if (returned == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل المرتجع بنجاح')),
      );
    }
  }

  Future<void> _showCreateSalesOrderDialog(BuildContext context) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _CreateSalesOrderDialog(
        salesCubit: context.read<SalesCubit>(),
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إنشاء أمر البيع بنجاح')),
      );
    }
  }

  bool _canCollectPayment(Map<String, dynamic> order, Map? customer) {
    final status = '${order['status'] ?? ''}';
    return customer?['id'] != null &&
        (status == 'CONFIRMED' || status == 'SHIPPED') &&
        _remainingAmount(order) > 0;
  }

  double _remainingAmount(Map<String, dynamic> order) {
    final total = double.tryParse('${order['totalAmount'] ?? 0}') ?? 0;
    final paid = double.tryParse('${order['paidAmount'] ?? 0}') ?? 0;
    return (total - paid).clamp(0, double.infinity);
  }

  Future<void> _showPaymentDialog(
    BuildContext context,
    Map<String, dynamic> order,
    Map customer,
  ) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _CustomerPaymentDialog(
        salesCubit: context.read<SalesCubit>(),
        customerId: '${customer['id']}',
        salesOrderId: '${order['id']}',
        remainingAmount: _remainingAmount(order),
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل الدفعة بنجاح')),
      );
    }
  }

  Future<void> _showAddCustomerDialog(BuildContext context) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _AddCustomerDialog(
        salesCubit: context.read<SalesCubit>(),
        contactImportService: contactImportService,
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حفظ العميل بنجاح')),
      );
    }
  }
}

class _AddCustomerDialog extends StatefulWidget {
  const _AddCustomerDialog({
    required this.salesCubit,
    required this.contactImportService,
  });

  final SalesCubit salesCubit;
  final ContactImportService? contactImportService;

  @override
  State<_AddCustomerDialog> createState() => _AddCustomerDialogState();
}

class _AddCustomerDialogState extends State<_AddCustomerDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _addressController = TextEditingController();
  bool _isSaving = false;

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _addressController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.salesCubit.createCustomer(
        name: _nameController.text.trim(),
        phone: _phoneController.text.trim(),
        email: _emailController.text.trim(),
        address: _addressController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'تعذر حفظ العميل. تحقق من الصلاحيات والاتصال ثم حاول مرة أخرى.',
          ),
        ),
      );
    }
  }

  void _applyImportedContact(ImportedContactData data) {
    setState(() {
      if (data.name.isNotEmpty) _nameController.text = data.name;
      if (data.phone.isNotEmpty) _phoneController.text = data.phone;
      if (data.email.isNotEmpty) _emailController.text = data.email;
      if (data.address != null) _addressController.text = data.address!;
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('إضافة عميل جديد'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ContactImportButton(
                  service: widget.contactImportService ??
                      const ContactImportService(),
                  onImported: _applyImportedContact,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: 'اسم العميل *',
                    prefixIcon: Icon(Icons.person_outline),
                  ),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'اسم العميل مطلوب'
                      : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'رقم الهاتف',
                    prefixIcon: Icon(Icons.phone_outlined),
                  ),
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(
                    labelText: 'البريد الإلكتروني',
                    prefixIcon: Icon(Icons.email_outlined),
                  ),
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _addressController,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'العنوان',
                    prefixIcon: Icon(Icons.location_on_outlined),
                  ),
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

class _CreateSalesOrderDialog extends StatefulWidget {
  const _CreateSalesOrderDialog({required this.salesCubit});

  final SalesCubit salesCubit;

  @override
  State<_CreateSalesOrderDialog> createState() =>
      _CreateSalesOrderDialogState();
}

class _CreateSalesOrderDialogState extends State<_CreateSalesOrderDialog> {
  final _formKey = GlobalKey<FormState>();
  final _quantityController = TextEditingController(text: '1');
  final _discountController = TextEditingController(text: '0');
  late final Future<_SalesOrderOptions> _optionsFuture;
  String? _customerId;
  String? _variantId;
  var _paymentType = 'CASH';
  var _isSaving = false;

  @override
  void initState() {
    super.initState();
    _optionsFuture = _loadOptions();
  }

  Future<_SalesOrderOptions> _loadOptions() async {
    final results = await Future.wait([
      widget.salesCubit.fetchCustomers(),
      widget.salesCubit.fetchProducts(),
    ]);
    final customers = results[0].cast<dynamic>();
    final products = results[1].cast<dynamic>();
    final variants = <Map<String, dynamic>>[];
    for (final product in products) {
      if (product is! Map) continue;
      final productName = product['name']?.toString() ?? 'منتج';
      final retailPrice = product['retailPrice'];
      final productVariants = product['variants'] as List? ?? const [];
      for (final variant in productVariants) {
        if (variant is! Map || variant['id'] == null) continue;
        variants.add({
          'id': variant['id'].toString(),
          'label':
              '$productName — ${variant['size'] ?? '-'} / ${variant['color'] ?? '-'}',
          'price': variant['retailPrice'] ?? retailPrice ?? 0,
        });
      }
    }
    return _SalesOrderOptions(customers: customers, variants: variants);
  }

  @override
  void dispose() {
    _quantityController.dispose();
    _discountController.dispose();
    super.dispose();
  }

  Future<void> _save(_SalesOrderOptions options) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final selectedVariant =
        options.variants.cast<Map<String, dynamic>?>().firstWhere(
              (variant) => variant?['id'] == _variantId,
              orElse: () => null,
            );
    if (_customerId == null || _variantId == null || selectedVariant == null) {
      return;
    }

    setState(() => _isSaving = true);
    try {
      await widget.salesCubit.createSalesOrder(
        customerId: _customerId!,
        paymentType: _paymentType,
        discount: double.parse(_discountController.text.trim()),
        items: [
          {
            'productVariantId': _variantId,
            'quantity': int.parse(_quantityController.text.trim()),
          },
        ],
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تعذر إنشاء أمر البيع. تحقق من المخزون والصلاحيات.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('إنشاء أمر بيع جديد'),
      content: SizedBox(
        width: 460,
        child: FutureBuilder<_SalesOrderOptions>(
          future: _optionsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const SizedBox(
                height: 120,
                child: AppLoadingView(),
              );
            }
            if (snapshot.hasError) {
              return const Text(
                  'تعذر تحميل العملاء والمنتجات. أغلق الحوار وحاول مرة أخرى.');
            }
            final options = snapshot.data!;
            if (options.customers.isEmpty || options.variants.isEmpty) {
              return Text(
                options.customers.isEmpty
                    ? 'أضف عميلًا أولًا قبل إنشاء أمر البيع.'
                    : 'أضف منتجًا بمتغير واحد على الأقل قبل إنشاء أمر البيع.',
              );
            }
            return SingleChildScrollView(
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: _customerId,
                      decoration: const InputDecoration(labelText: 'العميل *'),
                      items: options.customers
                          .whereType<Map>()
                          .where((customer) => customer['id'] != null)
                          .map(
                            (customer) => DropdownMenuItem<String>(
                              value: customer['id'].toString(),
                              child: Text('${customer['name'] ?? 'عميل'}'),
                            ),
                          )
                          .toList(),
                      onChanged: _isSaving
                          ? null
                          : (value) => setState(() => _customerId = value),
                      validator: (value) =>
                          value == null ? 'اختر العميل' : null,
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      initialValue: _variantId,
                      decoration:
                          const InputDecoration(labelText: 'المنتج والمتغير *'),
                      items: options.variants
                          .map(
                            (variant) => DropdownMenuItem<String>(
                              value: variant['id'] as String,
                              child: Text('${variant['label']}'),
                            ),
                          )
                          .toList(),
                      onChanged: _isSaving
                          ? null
                          : (value) => setState(() => _variantId = value),
                      validator: (value) =>
                          value == null ? 'اختر المنتج' : null,
                    ),
                    const SizedBox(height: 10),
                    TextFormField(
                      controller: _quantityController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'الكمية *'),
                      validator: (value) {
                        final quantity = int.tryParse(value?.trim() ?? '');
                        return quantity == null || quantity <= 0
                            ? 'أدخل كمية صحيحة موجبة'
                            : null;
                      },
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      initialValue: _paymentType,
                      decoration:
                          const InputDecoration(labelText: 'نوع الدفع *'),
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
                      controller: _discountController,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'الخصم'),
                      validator: (value) {
                        final discount = double.tryParse(value?.trim() ?? '');
                        return discount == null || discount < 0
                            ? 'أدخل خصمًا صحيحًا غير سالب'
                            : null;
                      },
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        FutureBuilder<_SalesOrderOptions>(
          future: _optionsFuture,
          builder: (context, snapshot) {
            if (!snapshot.hasData) return const SizedBox.shrink();
            return FilledButton.icon(
              onPressed: _isSaving ? null : () => _save(snapshot.data!),
              icon: _isSaving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined),
              label: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ'),
            );
          },
        ),
      ],
    );
  }
}

class _SalesOrderOptions {
  const _SalesOrderOptions({required this.customers, required this.variants});

  final List<dynamic> customers;
  final List<Map<String, dynamic>> variants;
}

class _CustomerPaymentDialog extends StatefulWidget {
  const _CustomerPaymentDialog({
    required this.salesCubit,
    required this.customerId,
    required this.salesOrderId,
    required this.remainingAmount,
  });

  final SalesCubit salesCubit;
  final String customerId;
  final String salesOrderId;
  final double remainingAmount;

  @override
  State<_CustomerPaymentDialog> createState() => _CustomerPaymentDialogState();
}

class _CustomerPaymentDialogState extends State<_CustomerPaymentDialog> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _notesController = TextEditingController();
  var _isSaving = false;

  @override
  void dispose() {
    _amountController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.salesCubit.createCustomerPayment(
        customerId: widget.customerId,
        salesOrderId: widget.salesOrderId,
        amount: double.parse(_amountController.text.trim()),
        notes: _notesController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('تعذر تسجيل الدفعة. تحقق من المبلغ والصلاحيات.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('تحصيل دفعة من العميل'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('المتبقي: ${widget.remainingAmount} جنيه'),
            const SizedBox(height: 12),
            TextFormField(
              controller: _amountController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'قيمة الدفعة *'),
              validator: (value) {
                final amount = double.tryParse(value?.trim() ?? '');
                if (amount == null || amount <= 0) return 'أدخل قيمة موجبة';
                if (amount > widget.remainingAmount) {
                  return 'القيمة تتجاوز المتبقي';
                }
                return null;
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
        FilledButton.icon(
          onPressed: _isSaving ? null : _save,
          icon: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.payments_outlined),
          label: Text(_isSaving ? 'جاري الحفظ...' : 'تحصيل'),
        ),
      ],
    );
  }
}

class _SalesReturnDialog extends StatefulWidget {
  const _SalesReturnDialog({
    required this.salesCubit,
    required this.orderId,
    required this.items,
  });

  final SalesCubit salesCubit;
  final String orderId;
  final List<Map<String, dynamic>> items;

  @override
  State<_SalesReturnDialog> createState() => _SalesReturnDialogState();
}

class _SalesReturnDialogState extends State<_SalesReturnDialog> {
  final _formKey = GlobalKey<FormState>();
  final _reasonController = TextEditingController();
  late final List<TextEditingController> _quantityControllers;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _quantityControllers = widget.items
        .map((_) => TextEditingController(text: '0'))
        .toList(growable: false);
  }

  @override
  void dispose() {
    _reasonController.dispose();
    for (final controller in _quantityControllers) {
      controller.dispose();
    }
    super.dispose();
  }

  int _availableQuantity(Map<String, dynamic> item) {
    final quantity = int.tryParse('${item['quantity'] ?? 0}') ?? 0;
    final returned = int.tryParse('${item['returnedQuantity'] ?? 0}') ?? 0;
    return (quantity - returned).clamp(0, quantity);
  }

  Future<void> _save() async {
    if (_isSaving || !(_formKey.currentState?.validate() ?? false)) return;
    final payload = <Map<String, dynamic>>[];
    for (var index = 0; index < widget.items.length; index++) {
      final quantity = int.parse(_quantityControllers[index].text.trim());
      if (quantity > 0) {
        payload.add({
          'salesOrderItemId': '${widget.items[index]['id']}',
          'quantity': quantity,
        });
      }
    }
    if (payload.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل كمية مرتجعة لبند واحد على الأقل')),
      );
      return;
    }

    setState(() => _isSaving = true);
    try {
      await widget.salesCubit.createSalesReturn(
        orderId: widget.orderId,
        items: payload,
        reason: _reasonController.text.trim(),
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiClient.instance.messageFor(error))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('تسجيل مرتجع بيع'),
      content: SizedBox(
        width: 440,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ...List.generate(widget.items.length, (index) {
                  final item = widget.items[index];
                  final available = _availableQuantity(item);
                  return TextFormField(
                    controller: _quantityControllers[index],
                    enabled: !_isSaving && available > 0,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText:
                          'كمية مرتجعة للبند ${index + 1} (المتاح $available)',
                    ),
                    validator: (value) {
                      final quantity = int.tryParse(value?.trim() ?? '');
                      if (quantity == null || quantity < 0) {
                        return 'أدخل عددًا صحيحًا غير سالب';
                      }
                      if (quantity > available) {
                        return 'الكمية تتجاوز المتاح للمرتجع';
                      }
                      return null;
                    },
                  );
                }),
                TextFormField(
                  controller: _reasonController,
                  enabled: !_isSaving,
                  decoration:
                      const InputDecoration(labelText: 'سبب المرتجع (اختياري)'),
                  maxLines: 2,
                ),
              ],
            ),
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
