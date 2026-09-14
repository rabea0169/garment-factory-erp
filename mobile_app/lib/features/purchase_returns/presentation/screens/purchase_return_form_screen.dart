import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/selim_shell.dart';

/// نموذج إنشاء مرتجع مشتريات (SELIM-ERP W1) — يفتح كنموذج ملء الشاشة
/// من الزر العائم في شاشة المرتجعات.
///
/// يقلد PurchaseReturnForm في Selim ERP: اختيار أمر الشراء، ثم تحديد
/// الكميات المرتجعة من بنوده (السعر الافتراضي = تكلفة الوحدة الدفترية)،
/// مع خصم/ضريبة اختيارية وطريقة استرداد (إشعار دائن أو نقدي) وخيار
/// إعادة الكميات للمخزون. الإجماليات الكبيرة (المجموع/الصافي/الإجمالي)
/// معروضة حيًّا — والحفظ يرسل البنود والقيم الأولية فقط لأن الخادم يحسب
/// الإجماليات ويرقّم المستند (PRR-0001) ويرحّل القيد العكسي.
///
/// ملاحظة عقد: لا يوجد GET /purchasing/orders/:id في الخادم — قائمة
/// أوامر الشراء (GET /purchasing/orders) تحمل بنودًا نحيفة مع
/// receivedQuantity لكل بند (UAT-FIX)، فيُبنى الاختيار منها مباشرة.
class PurchaseReturnFormScreen extends StatefulWidget {
  const PurchaseReturnFormScreen({super.key});

  @override
  State<PurchaseReturnFormScreen> createState() =>
      _PurchaseReturnFormScreenState();
}

class _PurchaseReturnFormScreenState extends State<PurchaseReturnFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _discount = TextEditingController(text: '0');
  final _tax = TextEditingController(text: '0');
  final _reason = TextEditingController();
  final _notes = TextEditingController();

  /// أوامر الشراء المتاحة (بنودها مدمجة في استجابة القائمة).
  List<Map<String, dynamic>> _orders = [];
  String? _orderId;
  Map<String, dynamic>? _selectedOrder;

  bool _loadingOrders = true;
  bool _saving = false;

  /// إشعار دائن (default) أو استرداد نقدي.
  String _refundMethod = 'credit';

  /// هل تُصرف الكميات فعليًا من المخزن؟ (نفس الافتراضي الخادمي).
  bool _restockItems = true;

  /// مسودات بنود المرتجع: بند أمر الشراء + الكمية المرتجعة + سعر الوحدة.
  final List<_ReturnItemDraft> _items = [];

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<void> _loadOrders() async {
    // قائمة أوامر الشراء — الفشل غير قاتل: يظهر زر إعادة المحاولة.
    try {
      final response = await ApiClient.instance.dio.get(
        '/purchasing/orders',
        queryParameters: {'limit': 100},
      );
      final payload = response.data;
      final data = payload is Map && payload['items'] is List
          ? payload['items'] as List
          : (payload is Map ? payload['data'] : payload);
      final orders = (data is List ? data : const [])
          .whereType<Map>()
          .map((order) => Map<String, dynamic>.from(order))
          .where((order) => _poItems(order).isNotEmpty)
          .toList(growable: false);
      if (!mounted) return;
      setState(() {
        _orders = orders;
        _loadingOrders = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingOrders = false);
    }
  }

  /// بنود أمر الشراء من استجابة القائمة (نجيفة لكنها تكفي للمرتجع).
  List<Map<String, dynamic>> _poItems(Map<String, dynamic> order) =>
      (order['items'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false);

  double get _subtotal =>
      _items.fold(0, (sum, item) => sum + item.quantityValue * item.unitPrice);

  double get _discountValue => double.tryParse(_discount.text) ?? 0;

  double get _taxValue => double.tryParse(_tax.text) ?? 0;

  double get _total => _subtotal - _discountValue.clamp(0, _subtotal) + _taxValue;

  @override
  void dispose() {
    _discount.dispose();
    _tax.dispose();
    _reason.dispose();
    _notes.dispose();
    for (final item in _items) {
      item.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // UI-COMPLETE: الهيكل الموحد — زر الرجوع التلقائي + التنقل السفلي
    // ولوحة الأوامر، مثل بقية الشاشات.
    return SelimShellScaffold(
      title: 'مرتجع مشتريات جديد',
      actions: [
        IconButton(
          icon: const Icon(Icons.save_rounded),
          tooltip: 'حفظ',
          onPressed: _saving ? null : _save,
        ),
      ],
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsetsDirectional.all(16),
          children: [
            _orderField(),
            const SizedBox(height: 12),
            _methodSection(),
            const SizedBox(height: 12),
            _itemsSection(),
            const SizedBox(height: 12),
            _financialSection(),
            const SizedBox(height: 12),
            TextFormField(
              controller: _reason,
              maxLines: 1,
              decoration: const InputDecoration(
                labelText: 'سبب المرتجع (اختياري)',
                prefixIcon: Icon(Icons.help_outline_rounded),
                border: OutlineInputBorder(),
              ),
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
            const SizedBox(height: 90),
          ],
        ),
      ),
      // شريط الإجمالي اللزج أسفل الشاشة — نفس sticky footer في نماذج Selim.
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
                      'إجمالي المرتجع',
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
                          color: Color(0xFFE65100),
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
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.save_rounded),
                label: const Text('حفظ المرتجع'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _orderField() {
    if (_loadingOrders) {
      return const Padding(
        padding: EdgeInsetsDirectional.symmetric(vertical: 12),
        child: Row(
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 10),
            Text(
              'جاري تحميل أوامر الشراء...',
              style: TextStyle(fontFamily: 'Cairo', fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
      );
    }
    if (_orders.isEmpty) {
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
                'لا توجد أوامر شراء ببنود قابلة للإرجاع',
                style: TextStyle(fontFamily: 'Cairo', fontSize: 13),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: _loadOrders,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('إعادة المحاولة'),
              ),
            ],
          ),
        ),
      );
    }
    return DropdownButtonFormField<String>(
      initialValue: _orderId,
      isExpanded: true,
      menuMaxHeight: 320,
      decoration: const InputDecoration(
        labelText: 'أمر الشراء',
        prefixIcon: Icon(Icons.local_mall_rounded),
        border: OutlineInputBorder(),
      ),
      items: _orders.map((order) {
        final code = order['code']?.toString() ?? '';
        final supplier =
            (order['supplier'] as Map?)?['name']?.toString() ?? 'مورد غير محدد';
        final status = order['status']?.toString() ?? '';
        return DropdownMenuItem(
          value: order['id']?.toString(),
          child: Text(
            '$code · $supplier ($status)',
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
          ),
        );
      }).toList(),
      validator: (value) => (value == null || value.isEmpty) ? 'اختر أمر الشراء' : null,
      onChanged: _pickOrder,
    );
  }

  void _pickOrder(String? value) {
    setState(() {
      _orderId = value;
      for (final item in _items) {
        item.dispose();
      }
      _items.clear();
      _selectedOrder = null;
      for (final order in _orders) {
        if (order['id']?.toString() == value) {
          _selectedOrder = order;
          break;
        }
      }
      if (_selectedOrder != null) {
        for (final poItem in _poItems(_selectedOrder!)) {
          _items.add(_ReturnItemDraft.from(poItem));
        }
      }
    });
  }

  Widget _methodSection() {
    return Card(
      elevation: 0.5,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'طريقة الاسترداد',
              style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700, fontSize: 13),
            ),
            const SizedBox(height: 4),
            const Text(
              'دائن: إشعار دائن يخصم رصيد المورد — نقدي: استرداد نقدي فوري',
              style: TextStyle(fontFamily: 'Cairo', fontSize: 11, color: Colors.grey),
            ),
            const SizedBox(height: 10),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                  value: 'credit',
                  label: Text('إشعار دائن'),
                  icon: Icon(Icons.receipt_long_rounded),
                ),
                ButtonSegment(
                  value: 'cash',
                  label: Text('نقدي'),
                  icon: Icon(Icons.payments_rounded),
                ),
              ],
              selected: {_refundMethod},
              onSelectionChanged: (selection) =>
                  setState(() => _refundMethod = selection.first),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text(
                'إعادة الكميات للمخزون (صرف من المخزن)',
                style: TextStyle(fontFamily: 'Cairo', fontSize: 13),
              ),
              subtitle: const Text(
                'عند الإيقاف: خصم مالي فقط بلا حركة مخزون',
                style: TextStyle(fontFamily: 'Cairo', fontSize: 11, color: Colors.grey),
              ),
              value: _restockItems,
              onChanged: (value) => setState(() => _restockItems = value),
            ),
          ],
        ),
      ),
    );
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
                const Icon(Icons.assignment_return_rounded,
                    size: 18, color: Color(0xFFE65100)),
                const SizedBox(width: 6),
                const Text(
                  'بنود المرتجع',
                  style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700, fontSize: 14),
                ),
                const Spacer(),
                if (_selectedOrder != null)
                  Text(
                    '${_items.length} بندًا في أمر الشراء',
                    style: TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 11,
                      color: Colors.grey.shade600,
                    ),
                  ),
              ],
            ),
            if (_selectedOrder == null)
              const Padding(
                padding: EdgeInsetsDirectional.symmetric(vertical: 12),
                child: Text(
                  'اختر أمر شراء أولًا — ستظهر بنوده هنا لتحديد الكميات المرتجعة',
                  style: TextStyle(fontFamily: 'Cairo', fontSize: 12, color: Colors.grey),
                ),
              )
            else if (_items.isEmpty)
              const Padding(
                padding: EdgeInsetsDirectional.symmetric(vertical: 12),
                child: Text(
                  'أمر الشراء بلا بنود قابلة للإرجاع',
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

  Widget _itemTile(_ReturnItemDraft item) {
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 5),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                flex: 4,
                child: Text(
                  item.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontFamily: 'Cairo', fontSize: 12.5, fontWeight: FontWeight.w600),
                ),
              ),
              SizedBox(
                width: 110,
                child: Text(
                  'مستلم ${qty(item.receivedQuantity)} / ${qty(item.orderedQuantity)}',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 10.5,
                    color: Colors.grey.shade600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextFormField(
                  controller: item.quantity,
                  enabled: item.enabled,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'كمية الإرجاع',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (value) => setState(() {}),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: TextFormField(
                  controller: item.price,
                  enabled: item.enabled,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'سعر الوحدة',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (value) => setState(() {}),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 3,
                child: CheckboxListTile(
                  dense: true,
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'إرجاع',
                    style: TextStyle(fontFamily: 'Cairo', fontSize: 11.5),
                  ),
                  value: item.enabled,
                  onChanged: (value) =>
                      setState(() => item.enabled = value ?? false),
                ),
              ),
              IconButton(
                icon: Icon(
                  item.enabled ? Icons.remove_circle_outline_rounded : Icons.add_circle_outline_rounded,
                  color: item.enabled ? AppColors.error : AppColors.success,
                  size: 20,
                ),
                tooltip: item.enabled ? 'إيقاف البند' : 'إرجاع البند',
                onPressed: () => setState(() => item.enabled = !item.enabled),
              ),
            ],
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
                    enabled: _items.any((item) => item.enabled),
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: 'خصم المرتجع (ج.م)',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (value) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _tax,
                    enabled: _items.any((item) => item.enabled),
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: 'ضريبة مرتجعة (ج.م)',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (value) => setState(() {}),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _summaryRow('مجموع البنود', money(_subtotal)),
            _summaryRow('الخصم', '- ${money(_discountValue.clamp(0, _subtotal))}'),
            _summaryRow('الضريبة', money(_taxValue)),
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
                color: bold ? const Color(0xFFE65100) : Colors.black87,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final chosen = _items.where((item) => item.enabled).toList();
    if (chosen.isEmpty) {
      _toast('فعّل بندًا واحدًا على الأقل للإرجاع', isError: true);
      return;
    }
    final items = <Map<String, dynamic>>[];
    for (final item in chosen) {
      final quantity = double.tryParse(item.quantity.text);
      final price = double.tryParse(item.price.text);
      if (quantity == null || quantity <= 0 || price == null || price <= 0) {
        _toast('أكمل كميات وأسعار البنود المرتجعة (أرقام موجبة)', isError: true);
        return;
      }
      items.add({
        if (item.purchaseOrderItemId != null)
          'purchaseOrderItemId': item.purchaseOrderItemId,
        if (item.rawMaterialId != null) 'rawMaterialId': item.rawMaterialId,
        'rawMaterialName': item.name,
        'quantity': quantity,
        'unitPrice': price,
      });
    }
    final discount = double.tryParse(_discount.text) ?? 0;
    final tax = double.tryParse(_tax.text) ?? 0;
    if (discount < 0 || tax < 0) {
      _toast('الخصم والضريبة لا يمكن أن يكونا سالبين', isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.post('/purchase-returns', data: {
        'purchaseOrderId': _orderId,
        'items': items,
        'discountAmount': discount,
        'taxAmount': tax,
        'restockItems': _restockItems,
        'refundMethod': _refundMethod,
        if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      });
      if (!mounted) return;
      _toast('تم إنشاء المرتجع وترحيل قيده بنجاح');
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

/// مسودة بند مرتجع مشتقة من بند أمر الشراء — الافتراضي: الكمية المستلمة
/// (لا يمكن إرجاع غير المستلم) بسعر تكلفة الوحدة الدفترية.
class _ReturnItemDraft {
  _ReturnItemDraft.from(Map<String, dynamic> poItem)
      : purchaseOrderItemId = poItem['id']?.toString(),
        rawMaterialId = poItem['rawMaterialId']?.toString(),
        name = (poItem['rawMaterial'] as Map?)?['name']?.toString() ??
            poItem['rawMaterialId']?.toString() ??
            'صنف',
        orderedQuantity = asNum(poItem['quantity']).toDouble(),
        receivedQuantity = asNum(poItem['receivedQuantity']).toDouble() {
    quantity = TextEditingController(
      text: receivedQuantity > 0 ? _trim(receivedQuantity) : '',
    );
    price = TextEditingController(
      text: _trim(asNum(poItem['unitCost']).toDouble()),
    );
    // بند لم يُستلم منه شيء يبدأ معطلًا (لا متاح للإرجاع).
    enabled = receivedQuantity > 0;
  }

  final String? purchaseOrderItemId;
  final String? rawMaterialId;
  final String name;
  final double orderedQuantity;
  final double receivedQuantity;

  late final TextEditingController quantity;
  late final TextEditingController price;
  bool enabled = true;

  double get quantityValue => double.tryParse(quantity.text) ?? 0;
  double get unitPrice => double.tryParse(price.text) ?? 0;

  void dispose() {
    quantity.dispose();
    price.dispose();
  }

  /// تهذيب الأصفار الزائدة للعرض الافتراضي داخل حقل الإدخال.
  static String _trim(num value) {
    var text = value.toStringAsFixed(2);
    text = text.replaceAll(RegExp(r'\.?0+$'), '');
    return text.isEmpty ? '0' : text;
  }
}
