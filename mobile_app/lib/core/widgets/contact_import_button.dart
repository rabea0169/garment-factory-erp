import 'package:flutter/material.dart';
import 'package:flutter_contacts/flutter_contacts.dart';

import '../contacts/contact_import_service.dart';

class ContactImportButton extends StatefulWidget {
  const ContactImportButton({
    required this.onImported,
    this.service = const ContactImportService(),
    this.label = 'استيراد من جهات الاتصال',
    super.key,
  });

  final ValueChanged<ImportedContactData> onImported;
  final ContactImportService service;
  final String label;

  @override
  State<ContactImportButton> createState() => _ContactImportButtonState();
}

class _ContactImportButtonState extends State<ContactImportButton> {
  bool _isLoading = false;

  Future<void> _pickContact() async {
    if (_isLoading) return;
    setState(() => _isLoading = true);
    try {
      final imported = await widget.service.pickContact();
      if (!mounted || imported == null) return;
      final shouldApply = await _confirmImportedContact(imported);
      if (!mounted || shouldApply != true) return;
      widget.onImported(imported);
    } on ContactImportException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(error.message),
            action: error.canOpenSettings
                ? SnackBarAction(
                    label: 'الإعدادات',
                    onPressed: () => FlutterContacts.permissions.openSettings(),
                  )
                : null,
          ),
        );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
              content: Text('تعذر استيراد جهة الاتصال. حاول مرة أخرى.')),
        );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<bool?> _confirmImportedContact(ImportedContactData data) {
    final preview = <String>[
      if (data.name.isNotEmpty) 'الاسم: ${data.name}',
      if (data.phone.isNotEmpty) 'الهاتف: ${data.phone}',
      if (data.email.isNotEmpty) 'البريد: ${data.email}',
      if (data.address != null) 'العنوان: ${data.address}',
    ];

    return showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('مراجعة بيانات جهة الاتصال'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('راجع البيانات قبل تعبئة النموذج:'),
            const SizedBox(height: 12),
            ...preview.map((item) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(item),
                )),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('استخدام البيانات'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: _isLoading ? null : _pickContact,
      icon: _isLoading
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.contacts_outlined),
      label: Text(_isLoading ? 'جاري فتح جهات الاتصال...' : widget.label),
    );
  }
}
