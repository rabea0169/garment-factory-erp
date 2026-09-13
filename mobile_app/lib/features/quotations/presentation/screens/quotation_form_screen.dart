import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/widgets/selim/format.dart';

/// نموذج إنشاء عرض سعر (SELIM-ERP W1).
///
/// يقلد SaleForm في Selim ERP: اختيار عميل (بحث حي أو اسم حر)،
/// بنود بأسماء وأسعار وكميات، خصم ونسبة ضريبة، والإجمالي الكبير
/// مثبت أسفل الشاشة يُحدَّث حيًّا. الحفظ يرسل البنود فقط — الخادم
/// يحسب الإجماليات (قاعدة مجال مشتركة).
class QuotationFormScreen extends StatefulWidget {
  const QuotationFormScreen({super.key});

  @override
  State<QuotationFormScreen> createState() => _QuotationFormScreenState();
}

class _QuotationFormScreenState extends State<QuotationFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _customerName = TextEditingController();
  final _notes = TextEditingController();
  final _discount = TextEditingController(text: '0');
  final _vatRate = TextEditingController(text: '0.14');
  final _validUntil = TextEditingController();

  List<Map<String, dynamic>> _customers = [];
  String? _customerId;
  bool _loadingCustomers = true;
  bool _saving = false;

  final List<_ItemDraft> _items = [];

  @override
  void initState() {
    super.initState();
    _loadCustomers();
  }

  Future<void> _loadCustomers() async {
    // قائمة العملاء للانتقاء؛ الفشل غير قاتل — الاسم الحر يكفي.
    try {
      final response = await ApiClient.instance.dio.get(
        '/sales/customers',
        queryParameters: {'limit': 100},
      );
      final data = response.data;
      final items = data is Map && data['items'] is List ? data['items'] as List : const [];
      setState(() {
        _customers = items.cast<Map<String, dynamic>>();
        _loadingCustomers = false;
      });
    } catch (_) {
      setState(() => _loadingCustomers = false);
    }
  }

  double get _subtotal =>
      _items.fold(0.0, (sum, item) => sum + item.quantityValue * item.unitPrice);

  double get _discountValue => double.tryParse(_discount.text) ?? 0;

  double get _vatValue =>
      (_subtotal - _discountValue.clamp(0, _subtotal)) *
      (double.tryParse(_vatRate.text) ?? 0);

  double get _total => _subtotal - _discountValue.clamp(0, _subtotal) + _vatValue;

  @override
  void dispose() {
    _customerName.dispose();
    _notes.dispose();
    _discount.dispose();
    _vatRate.dispose();
    _validUntil.dispose();
    for (final item in _items) {
      item.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('عرض سعر جديد'),
        actions: [
          IconButton(icon: const Icon(Icons.save_rounded), tooltip: 'حفظ', onPressed: _save),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsetsDirectional.all(16),
          children: [
            _customerField(),
            const SizedBox(height: 12),
            _validUntilField(),
            const SizedBox(height: 12),
            _itemsSection(),
            const SizedBox(height: 12),
            _financialSection(),
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
            const SizedBox(height: 90),
          ],
        ),
      ),
      // شريط الإجمالي اللزج أسفل الشاشة مع زر الحفظ — نفس sticky footer
      // في نماذج Selim: الإجمالي الكبير مرئي دائمًا أثناء الإدخال.
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
                    Text(
                      'الإجمالي',
                      style: TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 11,
                        color: Colors.grey.shade600,
                      ),
                    ),
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: Text(
                        money(_total),
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primary,
                        ),
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
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.save_rounded),
                label: const Text('حفظ العرض'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _customerField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Autocomplete<String>(
          initialValue: TextEditingValue(text: _customerName.text),
          fieldViewBuilder: (context, controller, focusNode, onFieldSubmitted) {
            _customerName.addListener(() {});
            return TextFormField(
              controller: controller,
              focusNode: focusNode,
              onFieldSubmitted: (_) => onFieldSubmitted(),
              decoration: const InputDecoration(
                labelText: 'العميل',
                hintText: 'اكتب اسم العميل (موجود أو جديد)...',
                prefixIcon: Icon(Icons.person_rounded),
                border: OutlineInputBorder(),
              ),
              validator: (value) =>
                  (value == null || value.trim().isEmpty) ? 'اسم العميل مطلوب' : null,
            );
          },
          optionsBuilder: (textEditingValue) {
            final query = textEditingValue.text.trim();
            if (query.isEmpty) return const Iterable<String>.empty();
            return _customers
                .where((c) => (c['name']?.toString() ?? '').contains(query))
                .map((c) => c['name'].toString());
          },
          onSelected: (selection) {
            _customerName.text = selection;
            final match = _customers.firstWhere(
              (c) => c['name']?.toString() == selection,
              orElse: () => const {},
            );
            setState(() {
              _customerId = match.isEmpty ? null : match['id']?.toString();
            });
          },
        ),
        if (_loadingCustomers)
          const Padding(
            padding: EdgeInsetsDirectional.only(top: 6),
            child: Text(
              'جاري تحميل العملاء...',
              style: TextStyle(fontFamily: 'Cairo', fontSize: 11, color: Colors.grey),
            ),
          ),
      ],
    );
  }

  Widget _validUntilField() {
    return TextFormField(
      controller: _validUntil,
      readOnly: true,
      onTap: _pickValidUntil,
      decoration: const InputDecoration(
        labelText: 'صالح حتى (اختياري)',
        prefixIcon: Icon(Icons.event_rounded),
        border: OutlineInputBorder(),
      ),
    );
  }

  Future<void> _pickValidUntil() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 15)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() => _validUntil.text = picked.toIso8601String().substring(0, 10));
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
                const Icon(Icons.list_alt_rounded, size: 18, color: AppColors.primary),
                const SizedBox(width: 6),
                const Text(
                  'بنود العرض',
                  style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700, fontSize: 14),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: _addItem,
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('بند جديد', style: TextStyle(fontFamily: 'Cairo')),
                ),
              ],
            ),
            if (_items.isEmpty)
              const Padding(
                padding: EdgeInsetsDirectional.symmetric(vertical: 12),
                child: Text(
                  'أضف بندًا واحدًا على الأقل — اسم الصنف والكمية وسعر الوحدة',
                  style: TextStyle(fontFamily: 'Cairo', fontSize: 12, color: Colors.grey),
                ),
              )
            else
              ..._items.map((item) => _itemTile(item)),
          ],
        ),
      ),
    );
  }

  Widget _itemTile(_ItemDraft item) {
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(
            flex: 4,
            child: TextFormField(
              controller: item.name,
              decoration: const InputDecoration(
                isDense: true,
                hintText: 'اسم الصنف',
                border: OutlineInputBorder(),
              ),
              onChanged: (value) => setState(() {}),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 2,
            child: TextFormField(
              controller: item.quantity,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                isDense: true,
                hintText: 'الكمية',
                border: OutlineInputBorder(),
              ),
              onChanged: (value) => setState(() {}),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 3,
            child: TextFormField(
              controller: item.price,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                isDense: true,
                hintText: 'سعر الوحدة',
                border: OutlineInputBorder(),
              ),
              onChanged: (value) => setState(() {}),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.remove_circle_outline_rounded, color: AppColors.error, size: 20),
            onPressed: () => setState(() {
              item.dispose();
              _items.remove(item);
            }),
          ),
        ],
      ),
    );
  }

  Widget _financialSection() {
    return Card(
      elevation: 0.5,
      margin: EdgeInsets.zero,
      color: AppColors.inputFill,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(14),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _discount,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'الخصم (ج.م)',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (value) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _vatRate,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: 'نسبة الضريبة (0.14 = 14%)',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (value) => setState(() {}),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _summaryRow('المجموع', money(_subtotal)),
            _summaryRow('الخصم', '- ${money(_discountValue.clamp(0, _subtotal))}'),
            _summaryRow('الضريبة', money(_vatValue)),
            const Divider(height: 8),
            _summaryRow('الإجمالي', money(_total), bold: true),
          ],
        ),
      ),
    );
  }

  Widget _summaryRow(String label, String value, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 2),
      child: Row(
        children: [
          Text(
            label,
            style: TextStyle(
              fontFamily: 'Cairo',
              fontSize: 12.5,
              color: Colors.grey.shade700,
              fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
          const Spacer(),
          Directionality(
            textDirection: TextDirection.ltr,
            child: Text(
              value,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: bold ? 15 : 13,
                fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
                color: bold ? AppColors.primary : Colors.black87,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _addItem() {
    setState(() => _items.add(_ItemDraft()));
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_items.isEmpty) {
      _toast('أضف بندًا واحدًا على الأقل', isError: true);
      return;
    }
    final items = <Map<String, dynamic>>[];
    for (final item in _items) {
      final quantity = double.tryParse(item.quantity.text);
      final price = double.tryParse(item.price.text);
      final name = item.name.text.trim();
      if (name.isEmpty || quantity == null || quantity <= 0 || price == null || price <= 0) {
        _toast('أكمل بيانات البنود: الاسم والكمية والسعر لكل بند', isError: true);
        return;
      }
      items.add({'productName': name, 'quantity': quantity, 'unitPrice': price});
    }
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.post('/quotations', data: {
        'customerName': _customerName.text.trim(),
        if (_customerId != null) 'customerId': _customerId,
        if (_validUntil.text.isNotEmpty) 'validUntil': _validUntil.text,
        'discount': _discountValue,
        'vatRate': double.tryParse(_vatRate.text) ?? 0,
        'items': items,
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      });
      if (!mounted) return;
      _toast('تم إنشاء عرض السعر بنجاح');
      Navigator.of(context).pop(true);
    } catch (error) {
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

class _ItemDraft {
  final name = TextEditingController();
  final quantity = TextEditingController();
  final price = TextEditingController();

  double get quantityValue => double.tryParse(quantity.text) ?? 0;
  double get unitPrice => double.tryParse(price.text) ?? 0;

  void dispose() {
    name.dispose();
    quantity.dispose();
    price.dispose();
  }
}
