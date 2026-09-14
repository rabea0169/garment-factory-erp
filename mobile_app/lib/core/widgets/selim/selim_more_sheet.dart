import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../router/app_router.dart';
import '../../security/effective_permissions.dart';

/// درج "كل الأقسام" — نسخة دارت من درج المزيد في Selim ERP:
/// BottomSheet قابل للسحب للإغلاق، حقل بحث، وشبكة أيقونات ملونة
/// مقسّمة إلى مجموعات (المخزون / المالية / الإدارة / الإنتاج والجودة).
///
/// [role] يُمرَّر من المستدعي (الغلاف يعرف دور المستخدم من AuthCubit)
/// بدل قراءته داخل الدرج — الدرج يُبنى على مستوى الـ Navigator الأعلى
/// من شجرة المزود، فقراءة BlocProvider منه غير مضمونة.
Future<void> showSelimMoreSheet(
  BuildContext context, {
  Map<String, dynamic>? user,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (context) => _SelimMoreSheet(user: user),
  );
}

class _SelimMoreSheet extends StatefulWidget {
  const _SelimMoreSheet({required this.user});

  /// مستخدم الجلسة (الدور + الصلاحيات الفعالة) — SELIM-ERP W4.
  final Map<String, dynamic>? user;

  @override
  State<_SelimMoreSheet> createState() => _SelimMoreSheetState();
}

class _SelimMoreSheetState extends State<_SelimMoreSheet> {
  final _search = TextEditingController();

  List<_MoreGroup> get _allGroups => [
    _MoreGroup(
      'المخزون والمشتريات',
      Icons.warehouse_rounded,
      const Color(0xFF6A1B9A),
      [
        _MoreItem('المخزون والخامات', Icons.inventory_2_rounded, const Color(0xFF7B1FA2), AppRouter.inventory),
        _MoreItem('كتالوج المنتجات', Icons.checkroom_rounded, const Color(0xFF5E35B1), AppRouter.products),
        _MoreItem('الموردون', Icons.business_center_rounded, const Color(0xFF00695C), AppRouter.suppliers),
        _MoreItem('تسويات الجرد', Icons.rule_rounded, const Color(0xFF00838F), AppRouter.adjustments),
        _MoreItem('القص والتعبئة', Icons.content_cut_rounded, const Color(0xFFAD1457), AppRouter.cutting),
      ],
    ),
    _MoreGroup(
      'المبيعات والمالية',
      Icons.account_balance_rounded,
      const Color(0xFF00695C),
      [
        _MoreItem('نقطة البيع', Icons.point_of_sale_rounded, const Color(0xFF00897B), AppRouter.pos),
        _MoreItem('عروض الأسعار', Icons.request_quote_rounded, const Color(0xFF3949AB), AppRouter.quotations),
        _MoreItem('مرتجع المشتريات', Icons.assignment_return_rounded, const Color(0xFFE65100), AppRouter.purchaseReturns),
        _MoreItem('الخزينة', Icons.account_balance_wallet_rounded, const Color(0xFF00897B), AppRouter.treasury),
        _MoreItem('المصاريف', Icons.payments_rounded, const Color(0xFFC62828), AppRouter.expenses),
        _MoreItem('الحسابات والقيود', Icons.account_tree_rounded, const Color(0xFF0277BD), AppRouter.accounting),
        _MoreItem('التقارير المالية', Icons.assessment_rounded, const Color(0xFF1565C0), AppRouter.financialReports),
        _MoreItem('مراكز التكلفة', Icons.pie_chart_rounded, const Color(0xFF6D4C41), AppRouter.costCenters),
      ],
    ),
    _MoreGroup(
      'الإنتاج والجودة',
      Icons.precision_manufacturing_rounded,
      const Color(0xFFC62828),
      [
        _MoreItem('أوامر التشغيل', Icons.factory_rounded, const Color(0xFFC62828), AppRouter.production),
        _MoreItem('مراقبة الجودة', Icons.verified_rounded, const Color(0xFF2E7D32), AppRouter.quality),
      ],
    ),
    _MoreGroup(
      'الموارد البشرية',
      Icons.groups_rounded,
      const Color(0xFF6A1B9A),
      [
        _MoreItem('العمالة والأجور', Icons.people_rounded, const Color(0xFF6A1B9A), AppRouter.hr),
        _MoreItem('الورديات', Icons.schedule_rounded, const Color(0xFF00838F), AppRouter.shifts),
        _MoreItem('كشوف الرواتب المجمدة', Icons.receipt_long_rounded, const Color(0xFF5D4037), AppRouter.payrollStatements),
      ],
    ),
    _MoreGroup(
      'الإدارة والنظام',
      Icons.admin_panel_settings_rounded,
      const Color(0xFF37474F),
      [
        _MoreItem('معالج الاستيراد', Icons.upload_file_rounded, const Color(0xFF00838F), AppRouter.importWizard),
        _MoreItem('النسخ الاحتياطي', Icons.backup_rounded, const Color(0xFF37474F), AppRouter.backup),
        _MoreItem('مركز الطباعة', Icons.print_rounded, const Color(0xFFE65100), AppRouter.printing),
        _MoreItem('المستخدمون', Icons.manage_accounts_rounded, const Color(0xFF37474F), AppRouter.users),
        _MoreItem('الشحن والتوزيع', Icons.local_shipping_rounded, const Color(0xFF00695C), AppRouter.shipping),
        // SELIM-ERP W3 — إدارة النظام الموسعة.
        _MoreItem('إعدادات المصنع', Icons.tune_rounded, const Color(0xFF455A64), AppRouter.factorySettings),
        _MoreItem('سجل التدقيق', Icons.history_rounded, const Color(0xFF546E7A), AppRouter.auditLogs),
        _MoreItem('الأجهزة المسجلة', Icons.devices_rounded, const Color(0xFF00796B), AppRouter.devices),
        _MoreItem('طابور المزامنة', Icons.sync_rounded, const Color(0xFF00838F), AppRouter.offlineQueue),
        // SELIM-ERP W4 — فروع الشركة (إدارة GM/SA).
        _MoreItem('فروع الشركة', Icons.store_rounded, const Color(0xFF00695C), AppRouter.branches),
      ],
    ),
  ];

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.user;
    final query = _search.text.trim();
    final groups =
        _allGroups
            .map(
              (group) => _MoreGroup(
                group.title,
                group.icon,
                group.color,
                group.items
                    .where((item) => canAccessWithUser(item.route, user))
                    .where(
                      (item) =>
                          query.isEmpty || item.label.contains(query),
                    )
                    .toList(),
              ),
            )
            .where((group) => group.items.isNotEmpty)
            .toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      builder: (context, scrollController) => Column(
        children: [
          // مقبض السحب + عنوان — نفس نمط vaul handleOnly في Selim.
          Padding(
            padding: const EdgeInsetsDirectional.only(top: 10, bottom: 6),
            child: Container(
              width: 44,
              height: 4.5,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
          const Text(
            'كل الأقسام',
            style: TextStyle(fontFamily: 'Cairo', fontSize: 17, fontWeight: FontWeight.w700),
          ),
          Padding(
            padding: const EdgeInsetsDirectional.symmetric(horizontal: 16, vertical: 10),
            child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'ابحث عن قسم...',
                hintStyle: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
                prefixIcon: const Icon(Icons.search_rounded, size: 20),
                isDense: true,
                filled: true,
                fillColor: Colors.grey.shade100,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          Expanded(
            child: ListView(
              controller: scrollController,
              padding: const EdgeInsetsDirectional.only(start: 16, end: 16, bottom: 20),
              children: [
                for (final group in groups) ...[
                  Padding(
                    padding: const EdgeInsetsDirectional.only(top: 12, bottom: 8),
                    child: Row(
                      children: [
                        Icon(group.icon, size: 16, color: group.color),
                        const SizedBox(width: 6),
                        Text(
                          group.title,
                          style: TextStyle(
                            fontFamily: 'Cairo',
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                            color: group.color,
                          ),
                        ),
                      ],
                    ),
                  ),
                  GridView.count(
                    crossAxisCount: MediaQuery.sizeOf(context).width > 700 ? 5 : 3,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    childAspectRatio: 1.05,
                    children: group.items.map((item) => _MoreTile(item: item)).toList(),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

}

class _MoreTile extends StatelessWidget {
  const _MoreTile({required this.item});

  final _MoreItem item;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: item.color.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: () {
          Navigator.of(context).pop();
          context.go(item.route);
        },
        borderRadius: BorderRadius.circular(16),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: item.color.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(item.icon, color: item.color, size: 24),
            ),
            const SizedBox(height: 6),
            Padding(
              padding: const EdgeInsetsDirectional.symmetric(horizontal: 4),
              child: Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: Colors.black87,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MoreGroup {
  const _MoreGroup(this.title, this.icon, this.color, this.items);
  final String title;
  final IconData icon;
  final Color color;
  final List<_MoreItem> items;
}

class _MoreItem {
  const _MoreItem(this.label, this.icon, this.color, this.route);
  final String label;
  final IconData icon;
  final Color color;
  final String route;
}
