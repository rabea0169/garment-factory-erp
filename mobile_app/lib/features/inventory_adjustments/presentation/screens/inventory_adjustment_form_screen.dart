import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/navigation/back_navigation.dart';

/// نموذج إنشاء مسودة تسوية جرد (SELIM-ERP W1) — يفتح كنموذج ملء الشاشة
/// من الزر العائم في شاشة التسويات.
///
/// يقلد InventoryAdjustmentForm في Selim ERP: اختيار المخزن المجرد،
/// وبنود تعداد فعلي (اختيار الخامة من الكتالوج يملأ الاسم والوحدة)،
/// ثم الحفظ يرسل العدّ الفعلي فقط — الخادم يحسب رصيد النظام والفرق
/// والقيمة المالية لكل بند وينشئ المسودة ADJ-0001 بلا أي أثر (الاعتماد
/// مسار مستقل يطبّق الفروق ويرحّل القيود).
class InventoryAdjustmentFormScreen extends StatefulWidget {
  const InventoryAdjustmentFormScreen({super.key});

  @override
  State<InventoryAdjustmentFormScreen> createState() =>
      _InventoryAdjustmentFormScreenState();
}

class _InventoryAdjustmentFormScreenState extends State<InventoryAdjustmentFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _notes = TextEditingController();
  final _date = TextEditingController();

  List<Map<String, dynamic>> _warehouses = [];
  List<Map<String, dynamic>> _materials = [];
  String? _warehouseId;
  bool _loading = true;
  bool _saving = false;

  /// بنود التعداد: خامة + الكمية الفعلية المعدودة.
  final List<_CountItemDraft> _items = [];

  @override
  void initState() {
    super.initState();
    _loadLookups();
  }

  Future<void> _loadLookups() async {
    // المخازن النشطة + خامات الكتالوج — الفشل غير قاتل مع إعادة المحاولة.
    try {
      final results = await Future.wait([
        ApiClient.instance.dio
            .get('/inventory/warehouses', queryParameters: {'limit': 100}),
        ApiClient.instance.dio
            .get('/inventory/raw-materials', queryParameters: {'limit': 100}),
      ]);
      if (!mounted) return;
      setState(() {
        _warehouses = _listOf(results[0].data);
        _materials = _listOf(results[1].data);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  /// استخراج قائمة من استجابة مترقمة (data أو items).
  List<Map<String, dynamic>> _listOf(Object? payload) {
    if (payload is Map && payload['items'] is List) {
      return (payload['items'] as List)
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false);
    }
    if (payload is Map && payload['data'] is List) {
      return (payload['data'] as List)
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false);
    }
    if (payload is List) {
      return payload
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false);
    }
    return const [];
  }

  @override
  void dispose() {
    _notes.dispose();
    _date.dispose();
    for (final item in _items) {
      item.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: const GfBackButton(),
        title: const Text('تسوية جرد جديدة'),
        actions: [
          IconButton(
            icon: const Icon(Icons.save_rounded),
            tooltip: 'حفظ',
            onPressed: _saving ? null : _save,
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsetsDirectional.all(16),
          children: [
            _infoBanner(),
            const SizedBox(height: 12),
            _warehouseField(),
            const SizedBox(height: 12),
            _dateField(),
            const SizedBox(height: 12),
            _itemsSection(),
            const SizedBox(height: 12),
            TextFormField(
              controller: _notes,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'ملاحظات/سبب التسوية (اختياري)',
                alignLabelWithHint: true,
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Container(
          padding: const EdgeInsetsDirectional.fromSTEB(16, 10, 16, 12),
          decoration: BoxDecoration(
            color: Colors.white,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 8,
                offset: const Offset(0, -3),
              ),
            ],
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'تُنشأ كمسودة بلا أي أثر',
                      style: TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 11,
                        color: Colors.grey,
                      ),
                    ),
                    Text(
                      '${_items.length} بند تعداد',
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.save_rounded),
                label: const Text('حفظ المسودة'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _infoBanner() {
    return Card(
      elevation: 0.5,
      margin: EdgeInsets.zero,
      color: const Color(0xFF00838F).withValues(alpha: 0.08),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: const Padding(
        padding: EdgeInsetsDirectional.all(12),
        child: Row(
          children: [
            Icon(Icons.info_outline_rounded, color: Color(0xFF00838F), size: 20),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'أدخل العدّ الفعلي لكل صنف — الخادم يقارنه برصيد النظام ويحسب '
                'الفرق والقيمة. لا يتغير المخزون إلا عند اعتماد المسودة.',
                style: TextStyle(fontFamily: 'Cairo', fontSize: 11.5),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _warehouseField() {
    if (_loading) {
      return const Padding(
        padding: EdgeInsetsDirectional.symmetric(vertical: 8),
        child: Text(
          'جاري تحميل المخازن والخامات...',
          style: TextStyle(fontFamily: 'Cairo', fontSize: 12, color: Colors.grey),
        ),
      );
    }
    if (_warehouses.isEmpty) {
      return Card(
        elevation: 0.5,
        margin: EdgeInsets.zero,
        color: AppColors.inputFill,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsetsDirectional.all(14),
          child: Column(
            children: [
              const Text(
                'لا توجد مخازن نشطة — شغّل seed أو أنشئ مخزنًا أولًا',
                style: TextStyle(fontFamily: 'Cairo', fontSize: 13),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: _loadLookups,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('إعادة المحاولة'),
              ),
            ],
          ),
        ),
      );
    }
    return DropdownButtonFormField<String>(
      initialValue: _warehouseId,
      isExpanded: true,
      menuMaxHeight: 300,
      decoration: const InputDecoration(
        labelText: 'المخزن المجرد',
        prefixIcon: Icon(Icons.warehouse_rounded),
        border: OutlineInputBorder(),
      ),
      items: _warehouses.map((warehouse) {
        final code = warehouse['code']?.toString() ?? '';
        final name = warehouse['name']?.toString() ?? '';
        return DropdownMenuItem(
          value: warehouse['id']?.toString(),
          child: Text(
            '$code · $name',
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
          ),
        );
      }).toList(),
      validator: (value) => (value == null || value.isEmpty) ? 'اختر المخزن' : null,
      onChanged: (value) => setState(() => _warehouseId = value),
    );
  }

  Widget _dateField() {
    return TextFormField(
      controller: _date,
      readOnly: true,
      onTap: _pickDate,
      decoration: const InputDecoration(
        labelText: 'تاريخ الجرد (اختياري — افتراضيًا اليوم)',
        prefixIcon: Icon(Icons.event_rounded),
        border: OutlineInputBorder(),
      ),
    );
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) {
      setState(() => _date.text = picked.toIso8601String().substring(0, 10));
    }
  }

  Widget _itemsSection() {
    return Card(
      elevation: 0.5,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.rule_rounded, size: 18, color: Color(0xFF00838F)),
                const SizedBox(width: 6),
                const Text(
                  'بنود التعداد',
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: _materials.isEmpty ? null : _addItem,
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text(
                    'صنف جديد',
                    style: TextStyle(fontFamily: 'Cairo'),
                  ),
                ),
              ],
            ),
            if (_materials.isEmpty && !_loading)
              const Padding(
                padding: EdgeInsetsDirectional.only(bottom: 8),
                child: Text(
                  'تعذر تحميل خامات الكتالوج — أعد المحاولة',
                  style: TextStyle(fontFamily: 'Cairo', fontSize: 11, color: Colors.grey),
                ),
              ),
            if (_items.isEmpty)
              const Padding(
                padding: EdgeInsetsDirectional.symmetric(vertical: 12),
                child: Text(
                  'أضف بندًا واحدًا على الأقل — اختر الخامة وعدّ كميتها الفعلية',
                  style: TextStyle(fontFamily: 'Cairo', fontSize: 12, color: Colors.grey),
                ),
              )
            else
              ..._items.map(_itemTile),
          ],
        ),
      ),
    );
  }

  void _addItem() {
    setState(() => _items.add(_CountItemDraft(available: _materials)));
  }

  Widget _itemTile(_CountItemDraft item) {
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: DropdownButtonFormField<String>(
              initialValue: item.materialId,
              isExpanded: true,
              menuMaxHeight: 300,
              hint: const Text(
                'اختر الخامة',
                style: TextStyle(fontFamily: 'Cairo', fontSize: 12),
              ),
              decoration: const InputDecoration(
                isDense: true,
                border: OutlineInputBorder(),
              ),
              items: item.available.map((material) {
                final name = material['name']?.toString() ?? '';
                final code = material['code']?.toString() ?? '';
                return DropdownMenuItem(
                  value: material['id']?.toString(),
                  child: Text(
                    code.isEmpty ? name : '$code · $name',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
                  ),
                );
              }).toList(),
              validator: (value) => (value == null || value.isEmpty) ? 'اختر الخامة' : null,
              onChanged: (value) => setState(() => item.selectMaterial(value)),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 3,
            child: TextFormField(
              controller: item.actualQty,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                isDense: true,
                hintText: 'الكمية الفعلية',
                border: OutlineInputBorder(),
              ),
              onChanged: (value) => setState(() {}),
            ),
          ),
          IconButton(
            icon: const Icon(
              Icons.remove_circle_outline_rounded,
              color: AppColors.error,
              size: 20,
            ),
            onPressed: () => setState(() {
              item.dispose();
              _items.remove(item);
            }),
          ),
        ],
      ),
    );
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_items.isEmpty) {
      _toast('أضف بند تعداد واحدًا على الأقل', isError: true);
      return;
    }
    final items = <Map<String, dynamic>>[];
    for (final item in _items) {
      final actual = double.tryParse(item.actualQty.text);
      if (actual == null || actual < 0) {
        _toast('الكمية الفعلية يجب أن تكون رقمًا غير سالب في كل بند', isError: true);
        return;
      }
      items.add({
        'rawMaterialId': item.materialId,
        'itemName': item.itemName,
        'unit': item.unit,
        'actualQty': actual,
      });
    }
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.post('/inventory-adjustments', data: {
        'warehouseId': _warehouseId,
        if (_date.text.isNotEmpty) 'date': _date.text,
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
        'items': items,
      });
      if (!mounted) return;
      _toast('تم إنشاء مسودة التسوية — اعتمدها من القائمة لتطبيق الفروق');
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

/// مسودة بند تعداد — اختيار الخامة يملأ الاسم والوحدة (لقطة العميل)؛
/// الخادم يعيد حسابهما من مصدر الحقيقة عند الإنشاء.
class _CountItemDraft {
  _CountItemDraft({required this.available});

  final List<Map<String, dynamic>> available;

  String? materialId;
  String itemName = '';
  String unit = 'وحدة';
  final actualQty = TextEditingController();

  /// اختيار الخامة يملأ بيانات البند من الكتالوج.
  void selectMaterial(String? id) {
    materialId = id;
    Map<String, dynamic>? match;
    for (final material in available) {
      if (material['id']?.toString() == id) {
        match = material;
        break;
      }
    }
    itemName = match?['name']?.toString() ?? '';
    unit = match?['unit']?.toString() ?? 'وحدة';
  }

  void dispose() {
    actualQty.dispose();
  }
}
