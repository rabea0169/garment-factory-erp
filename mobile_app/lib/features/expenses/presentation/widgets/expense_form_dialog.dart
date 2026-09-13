import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/widgets/selim/format.dart';

/// حوار إنشاء مصروف (SELIM-ERP W1) — يقلد ExpenseForm في Selim ERP.
///
/// الحقول: البند (إلزامي من قائمة البنود)، المبلغ (موجب)، التاريخ،
/// والخزينة (اختياري «دفع من الخزينة» — عند تحديدها يخصم الخادم الرصيد
/// ويرحّل قيد Dr GENERAL_EXPENSE / Cr CASH داخل معاملة واحدة؛ بلا خزينة
/// يبقى سجلًا بلا قيد كما في Selim). الحفظ عبر cubit.create ثم رسالة
/// الخطأ من messageFor عند الرفض (رصيد غير كافٍ مثلًا).
class ExpenseFormDialog extends StatefulWidget {
  const ExpenseFormDialog({super.key, required this.categories});

  /// بنود المصاريف للاختيار (من حالة الشاشة المحمّلة).
  final List<Map<String, dynamic>> categories;

  @override
  State<ExpenseFormDialog> createState() => _ExpenseFormDialogState();
}

class _ExpenseFormDialogState extends State<ExpenseFormDialog> {
  final _formKey = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _notes = TextEditingController();
  final _date = TextEditingController();

  String? _categoryId;
  String? _treasuryId;

  /// خزائن السحب (GET /accounting/treasuries — PaginatedResult).
  List<Map<String, dynamic>> _treasuries = [];
  bool _loadingTreasuries = true;
  bool _saving = false;

  static const _rose = Color(0xFFC62828);

  @override
  void initState() {
    super.initState();
    _loadTreasuries();
  }

  Future<void> _loadTreasuries() async {
    // الخزائن اختيارية — الفشل يخفي القائمة فقط ولا يمنع الحفظ.
    try {
      final response = await ApiClient.instance.dio.get(
        '/accounting/treasuries',
        queryParameters: {'limit': 100},
      );
      final payload = response.data;
      final data = payload is Map && payload['data'] is List
          ? payload['data']
          : (payload is Map && payload['items'] is List
              ? payload['items']
              : payload);
      if (!mounted) return;
      setState(() {
        _treasuries = (data is List ? data : const [])
            .whereType<Map>()
            .map((treasury) => Map<String, dynamic>.from(treasury))
            .toList(growable: false);
        _loadingTreasuries = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingTreasuries = false);
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _notes.dispose();
    _date.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Row(
        children: [
          Icon(Icons.payments_rounded, color: _rose),
          SizedBox(width: 8),
          Text('مصروف جديد'),
        ],
      ),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _categoryField(),
              const SizedBox(height: 12),
              _amountField(),
              const SizedBox(height: 12),
              _dateField(),
              const SizedBox(height: 12),
              _treasuryField(),
              const SizedBox(height: 12),
              TextFormField(
                controller: _notes,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'ملاحظات/وصف (اختياري)',
                  alignLabelWithHint: true,
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
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
          label: const Text('حفظ المصروف'),
        ),
      ],
    );
  }

  Widget _categoryField() {
    if (widget.categories.isEmpty) {
      return const Text(
        'لا توجد بنود مصاريف — أنشئ بندًا من تبويب «البنود» أولًا',
        style: TextStyle(fontFamily: 'Cairo', fontSize: 12, color: Colors.grey),
      );
    }
    return DropdownButtonFormField<String>(
      initialValue: _categoryId,
      isExpanded: true,
      menuMaxHeight: 280,
      decoration: const InputDecoration(
        labelText: 'بند المصروف',
        prefixIcon: Icon(Icons.category_rounded),
        border: OutlineInputBorder(),
      ),
      items: widget.categories.map((category) {
        final name = category['name']?.toString() ?? '';
        return DropdownMenuItem(
          value: category['id']?.toString(),
          child: Text(
            name,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
          ),
        );
      }).toList(),
      validator: (value) => (value == null || value.isEmpty) ? 'اختر بند المصروف' : null,
      onChanged: (value) => setState(() => _categoryId = value),
    );
  }

  Widget _amountField() {
    return TextFormField(
      controller: _amount,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: const InputDecoration(
        labelText: 'المبلغ (ج.م)',
        prefixIcon: Icon(Icons.attach_money_rounded),
        border: OutlineInputBorder(),
      ),
      validator: (value) {
        final amount = double.tryParse(value ?? '');
        if (value == null || value.trim().isEmpty) return 'المبلغ مطلوب';
        if (amount == null) return 'أدخل رقمًا صحيحًا';
        if (amount <= 0) return 'المبلغ يجب أن يكون أكبر من صفر';
        return null;
      },
    );
  }

  Widget _dateField() {
    return TextFormField(
      controller: _date,
      readOnly: true,
      onTap: _pickDate,
      decoration: const InputDecoration(
        labelText: 'التاريخ (اختياري — افتراضيًا اليوم)',
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

  Widget _treasuryField() {
    if (_loadingTreasuries) {
      return const Padding(
        padding: EdgeInsetsDirectional.symmetric(vertical: 4),
        child: Text(
          'جاري تحميل الخزائن...',
          style: TextStyle(fontFamily: 'Cairo', fontSize: 11, color: Colors.grey),
        ),
      );
    }
    if (_treasuries.isEmpty) {
      return const Text(
        'لا تتوفر خزائن — سيُسجل المصروف بلا قيد مالي',
        style: TextStyle(fontFamily: 'Cairo', fontSize: 11, color: Colors.grey),
      );
    }
    return DropdownButtonFormField<String>(
      initialValue: _treasuryId,
      isExpanded: true,
      menuMaxHeight: 260,
      decoration: const InputDecoration(
        labelText: 'دفع من الخزينة (اختياري)',
        prefixIcon: Icon(Icons.account_balance_wallet_rounded),
        border: OutlineInputBorder(),
      ),
      items: [
        DropdownMenuItem<String>(
          value: null,
          child: Text(
            'بلا خزينة — سجل بلا قيد',
            style: TextStyle(fontFamily: 'Cairo', fontSize: 12.5, color: Colors.grey.shade600),
          ),
        ),
        ..._treasuries.map((treasury) {
          final name = treasury['name']?.toString() ?? '';
          final balance = asNum(treasury['balance']).toDouble();
          return DropdownMenuItem(
            value: treasury['id']?.toString(),
            child: Text(
              '$name · ${money(balance)}',
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 12.5),
            ),
          );
        }),
      ],
      onChanged: (value) => setState(() => _treasuryId = value),
    );
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final amount = double.tryParse(_amount.text);
    if (amount == null || amount <= 0) return;
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.post('/expenses', data: {
        'categoryId': _categoryId,
        'amount': amount,
        if (_date.text.isNotEmpty) 'date': _date.text,
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
        if (_treasuryId != null && _treasuryId!.isNotEmpty)
          'treasuryId': _treasuryId,
      });
      if (!mounted) return;
      _toast(_treasuryId == null ? 'تم تسجيل المصروف (بلا قيد مالي)' : 'تم حفظ المصروف وخصم الخزينة');
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
