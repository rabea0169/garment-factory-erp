import 'package:flutter/material.dart';

import '../../../../core/contacts/contact_import_service.dart';
import '../../../../core/widgets/contact_import_button.dart';
import '../cubit/hr_cubit.dart';

class CreateWorkerDialog extends StatefulWidget {
  const CreateWorkerDialog({
    required this.cubit,
    this.contactImportService,
    super.key,
  });

  final HrCubit cubit;
  final ContactImportService? contactImportService;

  @override
  State<CreateWorkerDialog> createState() => _CreateWorkerDialogState();
}

class _CreateWorkerDialogState extends State<CreateWorkerDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _nationalIdController = TextEditingController();
  final _pieceRateController = TextEditingController();
  var _specialty = 'SEWING';
  var _isSaving = false;

  static const _specialties = <String, String>{
    'CUTTING': 'قص',
    'SEWING': 'خياطة',
    'FINISHING': 'تشطيب',
    'PACKAGING': 'تعبئة',
    'IRONING': 'كي',
    'QUALITY_CONTROL': 'جودة',
    'OTHER': 'أخرى',
  };

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _nationalIdController.dispose();
    _pieceRateController.dispose();
    super.dispose();
  }

  void _applyContact(ImportedContactData data) {
    setState(() {
      if (data.name.isNotEmpty) _nameController.text = data.name;
      if (data.phone.isNotEmpty) _phoneController.text = data.phone;
    });
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.createWorker(
        name: _nameController.text.trim(),
        phone: _phoneController.text.trim(),
        nationalId: _nationalIdController.text.trim(),
        specialty: _specialty,
        pieceRate: double.tryParse(_pieceRateController.text.trim()),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'تعذر حفظ العامل. تحقق من الصلاحيات والاتصال ثم حاول مرة أخرى.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('إضافة عامل جديد'),
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
                  decoration: const InputDecoration(labelText: 'اسم العامل *'),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'اسم العامل مطلوب'
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
                  controller: _nationalIdController,
                  decoration: const InputDecoration(labelText: 'الرقم القومي'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _specialty,
                  decoration: const InputDecoration(labelText: 'التخصص *'),
                  items: _specialties.entries
                      .map(
                        (entry) => DropdownMenuItem<String>(
                          value: entry.key,
                          child: Text(entry.value),
                        ),
                      )
                      .toList(),
                  onChanged: _isSaving
                      ? null
                      : (value) {
                          if (value != null) setState(() => _specialty = value);
                        },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _pieceRateController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'أجر القطعة'),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) return null;
                    final rate = double.tryParse(value.trim());
                    return rate == null || rate < 0
                        ? 'أدخل أجرًا صحيحًا غير سالب'
                        : null;
                  },
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
