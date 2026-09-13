import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';

/// حوار إنشاء/تعديل بند مصروف (SELIM-ERP W1) — الاسم فريد والفشل
/// يظهر برسالة الخادم («اسم بند المصروف موجود بالفعل»).
///
/// [existing] عند التعديل يملأ الحقول بقيم البند الحالي.
class ExpenseCategoryFormDialog extends StatefulWidget {
  const ExpenseCategoryFormDialog({super.key, this.existing});

  /// البند المُعدَّل (null = إنشاء جديد).
  final Map<String, dynamic>? existing;

  @override
  State<ExpenseCategoryFormDialog> createState() =>
      _ExpenseCategoryFormDialogState();
}

class _ExpenseCategoryFormDialogState extends State<ExpenseCategoryFormDialog> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _notes = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    if (existing != null) {
      _name.text = existing['name']?.toString() ?? '';
      _notes.text = existing['notes']?.toString() ?? '';
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.existing != null;
    return AlertDialog(
      title: Row(
        children: [
          const Icon(Icons.category_rounded, color: Color(0xFFC62828)),
          const SizedBox(width: 8),
          Text(isEdit ? 'تعديل بند المصروف' : 'بند مصروف جديد'),
        ],
      ),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              controller: _name,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'اسم البند',
                prefixIcon: Icon(Icons.label_rounded),
                border: OutlineInputBorder(),
              ),
              validator: (value) => (value == null || value.trim().isEmpty)
                  ? 'اسم البند مطلوب'
                  : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _notes,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'ملاحظات (اختياري)',
                alignLabelWithHint: true,
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.save_rounded),
          label: Text(isEdit ? 'حفظ التعديل' : 'إضافة البند'),
        ),
      ],
    );
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final data = <String, dynamic>{
        'name': _name.text.trim(),
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      };
      if (widget.existing != null) {
        await ApiClient.instance.dio.patch(
          '/expenses/categories/${widget.existing!['id']}',
          data: data,
        );
      } else {
        await ApiClient.instance.dio.post(
          '/expenses/categories',
          data: data,
        );
      }
      if (!mounted) return;
      _toast(widget.existing != null ? 'تم تعديل البند' : 'تمت إضافة البند');
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _toast(ApiClient.instance.messageFor(error), isError: true);
    }
  }

  void _toast(String message, {bool isError = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message, style: const TextStyle(fontFamily: 'Cairo')),
          backgroundColor: isError ? AppColors.error : AppColors.success,
        ),
      );
  }
}
