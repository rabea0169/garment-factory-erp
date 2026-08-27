import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/contacts/contact_import_service.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/contact_import_button.dart';
import '../cubit/suppliers_cubit.dart';

class SuppliersScreen extends StatelessWidget {
  const SuppliersScreen({
    super.key,
    this.cubit,
    this.contactImportService,
  });

  final SuppliersCubit? cubit;
  final ContactImportService? contactImportService;

  @override
  Widget build(BuildContext context) {
    final content = Builder(
      builder: (screenContext) => Scaffold(
        appBar: AppBar(
          title: const Text('الموردون'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'تحديث',
              onPressed: () =>
                  screenContext.read<SuppliersCubit>().fetchSuppliers(),
            ),
          ],
        ),
        body: BlocBuilder<SuppliersCubit, SuppliersState>(
          builder: (context, state) {
            if (state is SuppliersLoading || state is SuppliersInitial) {
              return const AppLoadingView();
            }
            if (state is SuppliersError) {
              return AppErrorView(
                message: state.message,
                onRetry: () => context.read<SuppliersCubit>().fetchSuppliers(),
              );
            }
            if (state is SuppliersLoaded) {
              if (state.suppliers.isEmpty) {
                return AppEmptyView(
                  title: 'لا يوجد موردون مسجلون',
                  actionLabel: 'إعادة التحميل',
                  onAction: () =>
                      context.read<SuppliersCubit>().fetchSuppliers(),
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: state.suppliers.length,
                itemBuilder: (context, index) {
                  final supplier = state.suppliers[index] as Map;
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ListTile(
                      leading: const CircleAvatar(
                        child: Icon(Icons.business_outlined),
                      ),
                      title: Text('${supplier['name'] ?? ''}'),
                      subtitle: Text(
                        'كود: ${supplier['code'] ?? '-'}'
                        '${supplier['phone'] == null ? '' : ' | ${supplier['phone']}'}',
                      ),
                      trailing: Text(
                        '${supplier['balance'] ?? 0} جنيه',
                        style: const TextStyle(fontWeight: FontWeight.w600),
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
          onPressed: () => _showAddSupplierDialog(screenContext),
          icon: const Icon(Icons.business_center_outlined),
          label: const Text('إضافة مورد'),
        ),
      ),
    );

    if (cubit != null) {
      return BlocProvider<SuppliersCubit>.value(value: cubit!, child: content);
    }
    return BlocProvider<SuppliersCubit>(
      create: (_) => SuppliersCubit()..fetchSuppliers(),
      child: content,
    );
  }

  Future<void> _showAddSupplierDialog(BuildContext context) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _AddSupplierDialog(
        cubit: context.read<SuppliersCubit>(),
        contactImportService: contactImportService,
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حفظ المورد بنجاح')),
      );
    }
  }
}

class _AddSupplierDialog extends StatefulWidget {
  const _AddSupplierDialog({
    required this.cubit,
    required this.contactImportService,
  });

  final SuppliersCubit cubit;
  final ContactImportService? contactImportService;

  @override
  State<_AddSupplierDialog> createState() => _AddSupplierDialogState();
}

class _AddSupplierDialogState extends State<_AddSupplierDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _addressController = TextEditingController();
  final _notesController = TextEditingController();
  var _isSaving = false;

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _addressController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _applyContact(ImportedContactData data) {
    setState(() {
      if (data.name.isNotEmpty) _nameController.text = data.name;
      if (data.phone.isNotEmpty) _phoneController.text = data.phone;
      if (data.email.isNotEmpty) _emailController.text = data.email;
      if (data.address != null) _addressController.text = data.address!;
    });
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.createSupplier(
        name: _nameController.text.trim(),
        phone: _phoneController.text.trim(),
        email: _emailController.text.trim(),
        address: _addressController.text.trim(),
        notes: _notesController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'تعذر حفظ المورد. تحقق من الصلاحيات والاتصال ثم حاول مرة أخرى.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('إضافة مورد جديد'),
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
                  onImported: _applyContact,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(labelText: 'اسم المورد *'),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'اسم المورد مطلوب'
                      : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'رقم الهاتف'),
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration:
                      const InputDecoration(labelText: 'البريد الإلكتروني'),
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _addressController,
                  decoration: const InputDecoration(labelText: 'العنوان'),
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
