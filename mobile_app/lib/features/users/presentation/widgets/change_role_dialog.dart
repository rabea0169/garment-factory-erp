import 'package:flutter/material.dart';

import '../../domain/user_roles.dart';
import '../cubit/users_cubit.dart';

/// CC-9: حوار تغيير دور مستخدم (PATCH /users/:id/role) — القائمة
/// المنسدلة بالأدوار الثمانية الفعلية والقيمة الحالية معروضة.
/// الـ cubit يُمرَّر عبر constructor (لا context.read داخل الحوار).
class ChangeUserRoleDialog extends StatefulWidget {
  const ChangeUserRoleDialog({
    required this.cubit,
    required this.userId,
    required this.currentRole,
    required this.userName,
    super.key,
  });

  final UsersCubit cubit;
  final String userId;
  final String currentRole;
  final String userName;

  @override
  State<ChangeUserRoleDialog> createState() => _ChangeUserRoleDialogState();
}

class _ChangeUserRoleDialogState extends State<ChangeUserRoleDialog> {
  late String _role = widget.currentRole;
  var _isSaving = false;

  Future<void> _save() async {
    if (_role == widget.currentRole) {
      // لا تغيير — أغلق كأنه إلغاء (لا طلب شبكة).
      Navigator.of(context).pop(false);
      return;
    }
    setState(() => _isSaving = true);
    final error = await widget.cubit.changeRole(
      userId: widget.userId,
      role: _role,
    );
    if (!mounted) return;
    if (error != null) {
      // رسالة الخادم الفعلية (409 لتغيير دورك الخاص مثلًا).
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error), duration: const Duration(seconds: 4)),
      );
      return;
    }
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('تغيير دور ${widget.userName}'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'الدور الحالي: ${userRoleLabel(widget.currentRole)}',
              style: const TextStyle(
                  color: Colors.grey, fontFamily: 'Cairo'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _role,
              decoration: const InputDecoration(
                labelText: 'الدور الجديد *',
                prefixIcon: Icon(Icons.admin_panel_settings_outlined),
              ),
              items: kUserRoleOrder
                  .map(
                    (role) => DropdownMenuItem<String>(
                      value: role,
                      child: Text(userRoleLabel(role)),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving
                  ? null
                  : (value) {
                      if (value != null) setState(() => _role = value);
                    },
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
              : const Icon(Icons.published_with_changes),
          label: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ الدور'),
        ),
      ],
    );
  }
}
