import 'package:flutter/material.dart';

import '../../../../../core/constants/app_colors.dart';
import '../cubit/payrolls_cubit.dart';

/// GF-IMP-W3: حوار إنشاء كشف راتب (POST /hr/payrolls) — اختيار العامل
/// (يُجلب عبر PayrollsCubit.fetchWorkers)، فترة اختيارية (الافتراضي
/// الشهر الحالي)، ومكافأة/خصم اختياريين.
///
/// ملاحظة العقد: الخادم يحسب الإجمالي/الخصومات من الإنتاج والسلف
/// (ADR-0015) ولا يقبل حقول مبالغ — لذا تُدمج المكافأة/الخصم في
/// ملاحظات الكشف (انظر PayrollsCubit.createPayroll).
///
/// الـ cubit يُمرَّر عبر constructor (لا context.read داخل الحوار).
class CreatePayrollDialog extends StatefulWidget {
  const CreatePayrollDialog({required this.cubit, super.key});

  final PayrollsCubit cubit;

  @override
  State<CreatePayrollDialog> createState() => _CreatePayrollDialogState();
}

class _CreatePayrollDialogState extends State<CreatePayrollDialog> {
  final _formKey = GlobalKey<FormState>();
  final _fromController = TextEditingController();
  final _toController = TextEditingController();
  final _bonusController = TextEditingController();
  final _deductionsController = TextEditingController();
  final _notesController = TextEditingController();

  String? _workerId;
  List<Map<String, dynamic>> _workers = const [];
  bool _workersLoaded = false;
  var _isSaving = false;

  @override
  void initState() {
    super.initState();
    _loadWorkers();
  }

  @override
  void dispose() {
    _fromController.dispose();
    _toController.dispose();
    _bonusController.dispose();
    _deductionsController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _loadWorkers() async {
    final workers = await widget.cubit.fetchWorkers();
    if (!mounted) return;
    setState(() {
      _workers = workers;
      _workersLoaded = true;
      if (workers.isNotEmpty) {
        _workerId = workers.first['id']?.toString();
      }
    });
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_workerId == null) return;
    setState(() => _isSaving = true);
    final error = await widget.cubit.createPayroll(
      workerId: _workerId!,
      from: _parseDate(_fromController.text),
      to: _parseDate(_toController.text),
      bonus: double.tryParse(_bonusController.text.trim()),
      deductions: double.tryParse(_deductionsController.text.trim()),
      notes: _notesController.text,
    );
    if (!mounted) return;
    if (error != null) {
      // رسالة الخادم الفعلية (messageFor) — القائمة خلف الحوار سليمة.
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error), duration: const Duration(seconds: 4)),
      );
      return;
    }
    Navigator.of(context).pop(true);
  }

  static DateTime? _parseDate(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return null;
    return DateTime.tryParse(trimmed);
  }

  String _workerLabel(Map<String, dynamic> worker) {
    final name = worker['name']?.toString() ?? '';
    final code = worker['code']?.toString() ?? '';
    if (name.isEmpty) return code.isEmpty ? 'عامل' : code;
    if (code.isEmpty) return name;
    return '$name ($code)';
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('كشف راتب جديد'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!_workersLoaded)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        SizedBox(width: 8),
                        Text('جاري تحميل العمال...'),
                      ],
                    ),
                  ),
                if (_workersLoaded && _workers.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: Text(
                      'لا يوجد عمال — تأكد من الصلاحيات ثم أعد المحاولة.',
                      style: TextStyle(color: AppColors.error),
                    ),
                  ),
                DropdownButtonFormField<String>(
                  initialValue: _workerId,
                  decoration: const InputDecoration(
                    labelText: 'العامل *',
                    prefixIcon: Icon(Icons.person),
                  ),
                  items: _workers
                      .where((worker) => worker['id'] != null)
                      .map(
                        (worker) => DropdownMenuItem<String>(
                          value: worker['id'].toString(),
                          child: Text(_workerLabel(worker)),
                        ),
                      )
                      .toList(),
                  onChanged: _isSaving
                      ? null
                      : (value) => setState(() => _workerId = value),
                  validator: (value) => value == null ? 'اختر العامل' : null,
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: _fromController,
                        decoration: const InputDecoration(
                          labelText: 'من (yyyy-MM-dd)',
                          hintText: 'بداية الشهر افتراضيًا',
                          prefixIcon: Icon(Icons.date_range),
                          isDense: true,
                        ),
                        validator: _validateOptionalDate,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextFormField(
                        controller: _toController,
                        decoration: const InputDecoration(
                          labelText: 'إلى (yyyy-MM-dd)',
                          hintText: 'نهاية الشهر افتراضيًا',
                          prefixIcon: Icon(Icons.date_range),
                          isDense: true,
                        ),
                        validator: _validateOptionalDate,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: _bonusController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: 'مكافأة إضافية (اختياري)',
                          isDense: true,
                        ),
                        validator: _validateOptionalAmount,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextFormField(
                        controller: _deductionsController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: 'خصم إضافي (اختياري)',
                          isDense: true,
                        ),
                        validator: _validateOptionalAmount,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _notesController,
                  maxLines: 2,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: 'ملاحظات (اختياري)',
                    prefixIcon: Icon(Icons.notes),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'الخادم يحسب الإجمالي من إنتاج الفترة وخصم السلف تلقائيًا؛ '
                  'المكافأة/الخصم الإضافيان يُسجَّلان في ملاحظات الكشف.',
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                    fontFamily: 'Cairo',
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        FilledButton.icon(
          onPressed: _isSaving || _workers.isEmpty ? null : _save,
          icon: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.post_add),
          label: Text(_isSaving ? 'جاري الحفظ...' : 'إنشاء الكشف'),
        ),
      ],
    );
  }

  static String? _validateOptionalDate(String? value) {
    final trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) return null;
    return DateTime.tryParse(trimmed) == null ? 'تاريخ غير صالح' : null;
  }

  static String? _validateOptionalAmount(String? value) {
    final trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) return null;
    final amount = double.tryParse(trimmed);
    return amount == null || amount < 0 ? 'أدخل رقمًا غير سالب' : null;
  }
}
