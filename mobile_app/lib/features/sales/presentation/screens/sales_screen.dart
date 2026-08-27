import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
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
                  final order = orders[index] as Map<String, dynamic>;
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
          onPressed: () => _showAddCustomerDialog(screenContext),
          icon: const Icon(Icons.person_add_alt_1),
          label: const Text(
            'إضافة عميل',
            style: TextStyle(fontFamily: 'Cairo'),
          ),
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
