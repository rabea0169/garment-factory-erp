import 'package:flutter/material.dart';

import '../../../../core/network/api_client.dart';

/// SELIM-ERP W4 — حوار الصلاحيات التفصيلية لمستخدم (نقل
/// UserPermissionsDialog من المرجع SPRINT 81): مصفوفة مورد × إجراء
/// مربوطة بالفعل. الحوار يعرض الصلاحيات **الفعالة الحالية** (افتراضيات
/// الدور أو الصريحة المخزنة) كمربعات محددة سلفًا، وحفظ الصفوف المحددة
/// يستبدل الصلاحيات الصريحة كاملة (PUT /users/:id/permissions).
///
/// قواعد المرجع المطبَّقة:
/// - الحوار للأدمن فقط (المسار SA) ولا يُفتح لحسابك الشخصي (حماية حبس
///   النفس خادميًا 409).
/// - إلغاء كل التحديد (صف فارغ) يعيد المستخدم لافتراضيات دوره.
/// - البدل «الكل» يمنح كل الموارد × كل الأفعال دفعة واحدة.
class UserPermissionsDialog extends StatefulWidget {
  const UserPermissionsDialog({
    required this.userId,
    required this.userName,
    required this.userRole,
    super.key,
  });

  final String userId;
  final String userName;
  final String userRole;

  @override
  State<UserPermissionsDialog> createState() => _UserPermissionsDialogState();
}

/// مورد صلاحية بالعرض العربي (مرآة PERMISSION_RESOURCES الخادمية).
const List<(String, String, IconData)> kPermissionResources = [
  ('sales', 'المبيعات', Icons.point_of_sale_rounded),
  ('purchases', 'المشتريات', Icons.shopping_cart_rounded),
  ('purchase-returns', 'مرتجع المشتريات', Icons.assignment_return_rounded),
  ('quotations', 'عروض الأسعار', Icons.request_quote_rounded),
  ('customers', 'العملاء', Icons.people_alt_rounded),
  ('suppliers', 'الموردون', Icons.local_shipping_rounded),
  ('products', 'المنتجات', Icons.checkroom_rounded),
  ('inventory', 'المخزون', Icons.inventory_2_rounded),
  ('inventory-adjustments', 'تسويات الجرد', Icons.rule_rounded),
  ('production', 'أوامر التشغيل', Icons.factory_rounded),
  ('cutting', 'القص والتعبئة', Icons.content_cut_rounded),
  ('packing', 'التعبئة', Icons.inventory_rounded),
  ('quality', 'الجودة', Icons.verified_rounded),
  ('hr', 'العمالة', Icons.groups_rounded),
  ('payroll-statements', 'كشوف الرواتب', Icons.receipt_long_rounded),
  ('worker-receipts', 'سندات العمال', Icons.receipt_rounded),
  ('shifts', 'الورديات', Icons.schedule_rounded),
  ('expenses', 'المصاريف', Icons.payments_rounded),
  ('treasury', 'الخزينة', Icons.account_balance_wallet_rounded),
  ('accounting', 'الحسابات والقيود', Icons.account_tree_rounded),
  ('financial-reports', 'التقارير المالية', Icons.assessment_rounded),
  ('journal-templates', 'قوالب القيود', Icons.menu_book_rounded),
  ('shipping', 'الشحن', Icons.local_shipping_rounded),
  ('pos', 'نقطة البيع', Icons.point_of_sale),
  ('printing', 'مركز الطباعة', Icons.print_rounded),
  ('search', 'البحث', Icons.search_rounded),
  ('dashboard', 'لوحة التحكم', Icons.dashboard_rounded),
  ('reports', 'التقارير', Icons.bar_chart_rounded),
  ('data-import', 'معالج الاستيراد', Icons.upload_file_rounded),
  ('exports', 'التصدير', Icons.file_download_rounded),
  ('audit-logs', 'سجل التدقيق', Icons.history_rounded),
  ('branches', 'الفروع', Icons.store_rounded),
  ('settings', 'إعدادات المصنع', Icons.tune_rounded),
  ('backup', 'النسخ الاحتياطي', Icons.backup_rounded),
  ('devices', 'الأجهزة', Icons.devices_rounded),
  ('users', 'المستخدمون', Icons.manage_accounts_rounded),
];

const List<String> kPermissionActions = [
  'READ',
  'CREATE',
  'UPDATE',
  'DELETE',
  'EXPORT',
  'APPROVE',
];

const Map<String, String> kPermissionActionLabels = {
  'READ': 'عرض',
  'CREATE': 'إنشاء',
  'UPDATE': 'تعديل',
  'DELETE': 'حذف',
  'EXPORT': 'تصدير',
  'APPROVE': 'اعتماد',
};

class _UserPermissionsDialogState extends State<UserPermissionsDialog> {
  final Map<String, Set<String>> _grants = {};
  bool _loading = true;
  bool _saving = false;
  String? _source;
  String? _loadError;

  bool get _isWildcard => _grants['*']?.contains('*') == true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final response =
          await ApiClient.instance.dio.get<dynamic>('/users/${widget.userId}/permissions');
      final body = response.data;
      if (body is! Map) {
        throw const FormatException('استجابة الصلاحيات غير صالحة');
      }
      // الصلاحيات الفعالة الحالية هي نقطة البداية للتحرير — المرآة
      // الكاملة (افتراضيات الدور أو صريحة المستخدم) كما في المرجع.
      final effective = body['effective'];
      final rows = effective is Map ? effective['permissions'] : const [];
      _grants.clear();
      if (rows is List) {
        for (final row in rows) {
          if (row is Map) {
            final resource = row['resource']?.toString();
            final action = row['action']?.toString();
            if (resource != null && action != null) {
              _grants.putIfAbsent(resource, () => <String>{}).add(action);
            }
          }
        }
      }
      _source = effective is Map ? effective['source']?.toString() : null;
      setState(() => _loading = false);
    } catch (error) {
      setState(() {
        _loading = false;
        _loadError = ApiClient.instance.messageFor(error);
      });
    }
  }

  void _toggle(String resource, String action) {
    setState(() {
      final set = _grants.putIfAbsent(resource, () => <String>{});
      if (!set.add(action)) {
        set.remove(action);
        if (set.isEmpty) {
          _grants.remove(resource);
        }
      }
    });
  }

  void _toggleAll() {
    setState(() {
      if (_isWildcard) {
        _grants.clear();
      } else {
        _grants
          ..clear()
          ..['*'] = {'*'};
      }
    });
  }

  List<Map<String, String>> _payload() {
    if (_isWildcard) {
      return const [
        {'resource': '*', 'action': '*'},
      ];
    }
    final out = <Map<String, String>>[];
    for (final resource in kPermissionResources) {
      final actions = _grants[resource.$1];
      if (actions == null) continue;
      for (final action in kPermissionActions) {
        if (actions.contains(action)) {
          out.add({'resource': resource.$1, 'action': action});
        }
      }
    }
    return out;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.put<dynamic>(
        '/users/${widget.userId}/permissions',
        data: {'permissions': _payload()},
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ApiClient.instance.messageFor(error)),
          duration: const Duration(seconds: 4),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('صلاحيات ${widget.userName}'),
      content: SizedBox(
        width: 560,
        height: 560,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _loadError != null
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_loadError!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontFamily: 'Cairo')),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: _load,
                          child: const Text('إعادة المحاولة'),
                        ),
                      ],
                    ),
                  )
                : _grid(context),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('إلغاء'),
        ),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_outlined),
          label: const Text('حفظ الصلاحيات'),
        ),
      ],
    );
  }

  Widget _grid(BuildContext context) {
    final count = _payload().length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _source == 'user'
              ? 'المستخدم يملك صلاحيات صريحة مخزنة — حفظك يستبدلها كاملة.'
              : 'لا صلاحيات صريحة — الحالي هو افتراضيات الدور؛ الحفظ يخزن نسخة صريحة.',
          style: const TextStyle(
            fontFamily: 'Cairo',
            fontSize: 12,
            color: Colors.black54,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            FilterChip(
              selected: _isWildcard,
              label: const Text('منح الكل (بدل *)'),
              onSelected: (_) => _toggleAll(),
            ),
            const Spacer(),
            Text(
              'المحدد: $count',
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12,
                color: AppColorsMuted.text,
              ),
            ),
          ],
        ),
        const Divider(height: 16),
        Expanded(
          child: _isWildcard
              ? const Center(
                  child: Text(
                    'كل الموارد والأفعال ممنوحة (بدل *) — أزلها للتخصيص الدقيق.',
                    style: TextStyle(fontFamily: 'Cairo'),
                  ),
                )
              : ListView.builder(
                  itemCount: kPermissionResources.length,
                  itemBuilder: (context, index) {
                    final (resource, label, icon) =
                        kPermissionResources[index];
                    final granted = _grants[resource] ?? const <String>{};
                    return ExpansionTile(
                      dense: true,
                      leading: Icon(icon, size: 20),
                      title: Text(
                        label,
                        style: const TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      subtitle: granted.isEmpty
                          ? null
                          : Text(
                              granted
                                  .map((a) => kPermissionActionLabels[a] ?? a)
                                  .join(' · '),
                              style: const TextStyle(
                                fontFamily: 'Cairo',
                                fontSize: 11,
                                color: Colors.teal,
                              ),
                            ),
                      children: [
                        Padding(
                          padding: const EdgeInsetsDirectional.only(
                            start: 16,
                            bottom: 8,
                          ),
                          child: Wrap(
                            spacing: 6,
                            children: kPermissionActions
                                .map(
                                  (action) => FilterChip(
                                    selected: granted.contains(action),
                                    label: Text(
                                      kPermissionActionLabels[action] ?? action,
                                      style: const TextStyle(
                                        fontFamily: 'Cairo',
                                        fontSize: 11,
                                      ),
                                    ),
                                    onSelected: (_) =>
                                        _toggle(resource, action),
                                  ),
                                )
                                .toList(),
                          ),
                        ),
                      ],
                    );
                  },
                ),
        ),
      ],
    );
  }
}

/// ألوان ثابتة صغيرة (بلا استيراد دائري من الثيم).
class AppColorsMuted {
  AppColorsMuted._();

  static const Color text = Colors.black54;
}
