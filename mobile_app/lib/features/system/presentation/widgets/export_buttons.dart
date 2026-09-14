import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/services/file_download_service.dart';
import '../../../auth/presentation/cubit/auth_cubit.dart';

/// SELIM-ERP W3 — أزرار التصدير (نقل ExcelExportButton من Selim ERP):
/// تنزيل Excel/Word لقائمة كيان من الخادم (المصدر الوحيد للتوليد) ثم
/// مشاركة الملف.
///
/// زر واحد (أيقونة تنزيل) يفتح لوحة سفلية: كيان × صيغة — لأن الشاشة
/// قد تدير أكثر من قائمة (مثل المبيعات والعملاء) ولأن أيقونتين
/// متطابقتين (Excel/Word) لكل كيان تزدحم في الـ AppBar.
class EntityExportButtons extends StatefulWidget {
  const EntityExportButtons({
    super.key,
    required this.entities,
    this.service,
  });

  /// كيانات التصدير (customers/products/sales/...).
  final List<String> entities;

  /// يُحقن في الاختبارات.
  final FileDownloadService? service;

  @override
  State<EntityExportButtons> createState() => _EntityExportButtonsState();
}

/// مرآة ENTITY_ROLES في exports.controller (الخادم الحَكَم) — تُستخدم
/// لإخفاء خيارات التصدير عن الأدوار غير المصرّحة بدل انتظار 403.
const Map<String, Set<String>> kExportEntityRoles = {
  'customers': {'CASHIER', 'ACCOUNTANT', 'GENERAL_MANAGER'},
  'suppliers': {'INVENTORY_MANAGER', 'ACCOUNTANT', 'GENERAL_MANAGER'},
  'products': {
    'PRODUCTION_MANAGER',
    'INVENTORY_MANAGER',
    'CASHIER',
    'GENERAL_MANAGER',
  },
  'workers': {'HR_MANAGER', 'GENERAL_MANAGER'},
  'expenses': {'ACCOUNTANT', 'GENERAL_MANAGER'},
  'inventory': {
    'PRODUCTION_MANAGER',
    'INVENTORY_MANAGER',
    'GENERAL_MANAGER',
  },
  'sales': {'CASHIER', 'ACCOUNTANT', 'GENERAL_MANAGER'},
  'purchases': {'INVENTORY_MANAGER', 'ACCOUNTANT', 'GENERAL_MANAGER'},
};

/// تسمية الكيان بالعربية (لعرضها في لوحة التصدير).
const Map<String, String> kExportEntityLabels = {
  'customers': 'العملاء',
  'suppliers': 'الموردون',
  'products': 'المنتجات',
  'workers': 'العمال',
  'expenses': 'المصاريف',
  'inventory': 'المخزون',
  'sales': 'المبيعات',
  'purchases': 'المشتريات',
};

/// هل يظهر تصدير هذا الكيان لهذا الدور؟
///
/// كيان غير معروف → false للجميع (الخادم يرفضه 400)؛ SUPER_ADMIN يرى كل
/// الكيانات المعروفة (كحاجز الدور الخادمي).
bool canExportEntity(String entity, String? role) {
  final allowed = kExportEntityRoles[entity];
  if (allowed == null) return false;
  if (role == 'SUPER_ADMIN') return true;
  return role != null && allowed.contains(role);
}

class _EntityExportButtonsState extends State<EntityExportButtons> {
  bool _busy = false;
  String? _busyEntity;

  FileDownloadService get _service =>
      widget.service ?? FileDownloadService.instance;

  /// الكيانات المصرّحة لدور المستخدم الحالي فقط.
  List<String> _allowedFor(String? role) => [
        for (final entity in widget.entities)
          if (canExportEntity(entity, role)) entity,
      ];

  Future<void> _export(String entity, bool excel) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _busyEntity = entity;
    });
    try {
      await _service.downloadAndShare(
        '/export/${excel ? 'excel' : 'word'}/$entity',
        fallbackName: '${entity}_'
            '${DateTime.now().toIso8601String().substring(0, 10)}'
            '${excel ? '.xlsx' : '.doc'}',
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'تعذر التصدير — تحقق من الاتصال',
              style: TextStyle(fontFamily: 'Cairo'),
            ),
            backgroundColor: AppColors.error,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyEntity = null;
        });
      }
    }
  }

  void _openSheet(BuildContext context, List<String> allowed) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (sheetContext) => DraggableScrollableSheet(
        initialChildSize: 0.45,
        minChildSize: 0.25,
        maxChildSize: 0.85,
        expand: false,
        builder: (sheetContext, scrollController) => Container(
          decoration: BoxDecoration(
            color: Theme.of(sheetContext).scaffoldBackgroundColor,
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.symmetric(vertical: 8),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: Text(
                  'تصدير القوائم',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const Divider(height: 1),
              for (final entity in allowed)
                _EntityTile(
                  label: kExportEntityLabels[entity] ?? entity,
                  busy: _busy && _busyEntity == entity,
                  onExcel: _busy
                      ? null
                      : () => _export(entity, true),
                  onWord:
                      _busy ? null : () => _export(entity, false),
                ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // إخفاء ذاتي حين لا يملك الدور أي كيان مصرّح به (الخادم يظل الحَكَم).
    // maybeOf: الشاشات المُختبرة بلا AuthCubit (اختبارات الوحدات) ترى
    // الزر مخفيًا بدل انهيار ProviderNotFoundException — والدور نادرًا
    // ما يتغير أثناء جلسة قائمة، فالقراءة تكتفي.
    final authCubit = BlocProvider.maybeOf<AuthCubit>(context);
    final authState = authCubit?.state;
    final role =
        authState is AuthAuthenticated ? authState.user['role']?.toString() : null;
    final allowed = _allowedFor(role);
    if (allowed.isEmpty) return const SizedBox.shrink();
    return IconButton(
      tooltip: allowed.length == 1
          ? 'تصدير ${kExportEntityLabels[allowed.single]} (Excel/Word)'
          : 'تصدير القوائم (Excel/Word)',
      icon: _busy
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.download_rounded),
      onPressed: () => _openSheet(context, allowed),
    );
  }
}

/// صف كيان واحد في لوحة التصدير: الاسم + زرا Excel/Word.
class _EntityTile extends StatelessWidget {
  const _EntityTile({
    required this.label,
    required this.busy,
    required this.onExcel,
    required this.onWord,
  });

  final String label;
  final bool busy;
  final VoidCallback? onExcel;
  final VoidCallback? onWord;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(
        busy ? Icons.hourglass_top_rounded : Icons.table_chart_rounded,
        color: AppColors.primary,
      ),
      title: Text(
        label,
        style: const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextButton.icon(
            onPressed: onExcel,
            icon: const Icon(Icons.grid_on, size: 16),
            label: const Text('Excel', style: TextStyle(fontFamily: 'Cairo')),
          ),
          TextButton.icon(
            onPressed: onWord,
            icon: const Icon(Icons.description_outlined, size: 16),
            label: const Text('Word', style: TextStyle(fontFamily: 'Cairo')),
          ),
        ],
      ),
    );
  }
}
