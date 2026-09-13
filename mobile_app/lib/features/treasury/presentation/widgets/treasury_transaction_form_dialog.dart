import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/widgets/selim/format.dart';

/// فئات الحركة لكل نوع — نفس فئات Selim ERP (تحدد الحساب المقابل في
/// القيد خادميًا: مبيعات/رأس مال للإيداع، مشتريات/رواتب للسحب...).
const List<String> kDepositCategories = [
  'مبيعات',
  'رأس مال',
  'قرض',
  'إيداع بنكي',
  'أخرى',
];

const List<String> kWithdrawalCategories = [
  'مشتريات',
  'مصاريف',
  'سلف موظف',
  'رواتب',
  'إيجار',
  'مرافق',
  'أخرى',
];

/// حوار إنشاء حركة خزينة (SELIM-ERP W1) — يقلد TreasuryTransactionForm
/// في Selim ERP.
///
/// الحقول: النوع (ثلاثة أزرار مقسمة: إيداع/سحب/تحويل)، الخزينة المصدر،
/// الخزينة المستهدفة (للتحويل فقط ويجب أن تختلف)، المبلغ (موجب)، الفئة
/// (قائمة تتغير مع النوع)، الوصف (إلزامي)، والتاريخ والملاحظات. الحفظ
/// يمرر الأرصدة والقيد داخل معاملة واحدة خادميًا ويرقّم الحركة TRT-0001.
class TreasuryTransactionFormDialog extends StatefulWidget {
  const TreasuryTransactionFormDialog({super.key, required this.treasuries});

  /// الخزائن النشطة من ملخص الخزينة (اسم + رصيد حي).
  final List<Map<String, dynamic>> treasuries;

  @override
  State<TreasuryTransactionFormDialog> createState() =>
      _TreasuryTransactionFormDialogState();
}

class _TreasuryTransactionFormDialogState
    extends State<TreasuryTransactionFormDialog> {
  final _formKey = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _description = TextEditingController();
  final _notes = TextEditingController();
  final _date = TextEditingController();

  String _type = 'DEPOSIT';
  String? _treasuryId;
  String? _toTreasuryId;
  String? _category;

  bool _saving = false;

  static const _emerald = Color(0xFF00897B);

  @override
  void dispose() {
    _amount.dispose();
    _description.dispose();
    _notes.dispose();
    _date.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Row(
        children: [
          Icon(Icons.account_balance_wallet_rounded, color: _emerald),
          SizedBox(width: 8),
          Text('حركة خزينة جديدة'),
        ],
      ),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _typeSelector(),
              const SizedBox(height: 14),
              _treasuryField(),
              const SizedBox(height: 12),
              if (_type == 'TRANSFER') ...[
                _toTreasuryField(),
                const SizedBox(height: 12),
              ],
              _amountField(),
              const SizedBox(height: 12),
              _categoryField(),
              const SizedBox(height: 12),
              TextFormField(
                controller: _description,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'الوصف (إلزامي)',
                  alignLabelWithHint: true,
                  prefixIcon: Icon(Icons.description_rounded),
                  border: OutlineInputBorder(),
                ),
                validator: (value) => (value == null || value.trim().isEmpty)
                    ? 'وصف الحركة مطلوب'
                    : null,
              ),
              const SizedBox(height: 12),
              _dateField(),
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
          label: const Text('حفظ الحركة'),
        ),
      ],
    );
  }

  Widget _typeSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'نوع الحركة',
          style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700, fontSize: 13),
        ),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(
              value: 'DEPOSIT',
              label: Text('إيداع'),
              icon: Icon(Icons.south_west_rounded),
            ),
            ButtonSegment(
              value: 'WITHDRAWAL',
              label: Text('سحب'),
              icon: Icon(Icons.north_east_rounded),
            ),
            ButtonSegment(
              value: 'TRANSFER',
              label: Text('تحويل'),
              icon: Icon(Icons.swap_horiz_rounded),
            ),
          ],
          selected: {_type},
          onSelectionChanged: (selection) => setState(() {
            _type = selection.first;
            // الفئة تتبع النوع — إعادة الضبط عند التبديل.
            _category = null;
            if (_type != 'TRANSFER') _toTreasuryId = null;
          }),
        ),
      ],
    );
  }

  Widget _treasuryField() {
    if (widget.treasuries.isEmpty) {
      return const Text(
        'لا توجد خزائن نشطة — لا يمكن تسجيل حركة',
        style: TextStyle(fontFamily: 'Cairo', fontSize: 12, color: Colors.grey),
      );
    }
    return DropdownButtonFormField<String>(
      initialValue: _treasuryId,
      isExpanded: true,
      menuMaxHeight: 280,
      decoration: InputDecoration(
        labelText: _type == 'TRANSFER' ? 'من خزينة' : 'الخزينة',
        prefixIcon: const Icon(Icons.account_balance_rounded),
        border: const OutlineInputBorder(),
      ),
      items: widget.treasuries.map((treasury) {
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
      }).toList(),
      validator: (value) => (value == null || value.isEmpty) ? 'اختر الخزينة' : null,
      onChanged: (value) => setState(() => _treasuryId = value),
    );
  }

  Widget _toTreasuryField() {
    // الخزائن المستهدفة: غير المصدر فقط (عقد الخادم يرفض التحويل لنفسها).
    final targets = widget.treasuries
        .where((treasury) => treasury['id']?.toString() != _treasuryId)
        .toList(growable: false);
    return DropdownButtonFormField<String>(
      initialValue: _toTreasuryId,
      isExpanded: true,
      menuMaxHeight: 280,
      decoration: const InputDecoration(
        labelText: 'إلى خزينة',
        prefixIcon: Icon(Icons.account_balance_wallet_rounded),
        border: OutlineInputBorder(),
      ),
      items: targets.map((treasury) {
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
      }).toList(),
      validator: (value) {
        if (_type != 'TRANSFER') return null;
        if (value == null || value.isEmpty) return 'التحويل يتطلب خزينة مستهدفة';
        if (value == _treasuryId) return 'لا يمكن التحويل إلى نفس الخزينة';
        return null;
      },
      onChanged: (value) => setState(() => _toTreasuryId = value),
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

  Widget _categoryField() {
    final categories =
        _type == 'DEPOSIT' ? kDepositCategories : kWithdrawalCategories;
    return DropdownButtonFormField<String>(
      initialValue: _category,
      isExpanded: true,
      menuMaxHeight: 260,
      decoration: const InputDecoration(
        labelText: 'الفئة (اختياري — تحدد الحساب المقابل في القيد)',
        prefixIcon: Icon(Icons.label_rounded),
        border: OutlineInputBorder(),
      ),
      items: [
        DropdownMenuItem<String>(
          value: null,
          child: Text(
            'بلا فئة',
            style: TextStyle(fontFamily: 'Cairo', fontSize: 12.5, color: Colors.grey.shade600),
          ),
        ),
        ...categories.map(
          (category) => DropdownMenuItem(
            value: category,
            child: Text(
              category,
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 12.5),
            ),
          ),
        ),
      ],
      onChanged: (value) => setState(() => _category = value),
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

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final amount = double.tryParse(_amount.text);
    if (amount == null || amount <= 0) return;
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.post('/treasury-transactions', data: {
        'treasuryId': _treasuryId,
        if (_type == 'TRANSFER') 'toTreasuryId': _toTreasuryId,
        'type': _type,
        'amount': amount,
        if (_date.text.isNotEmpty) 'date': _date.text,
        'description': _description.text.trim(),
        if (_category != null && _category!.isNotEmpty) 'category': _category,
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      });
      if (!mounted) return;
      _toast('تم حفظ الحركة وتحديث رصيد الخزينة');
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
