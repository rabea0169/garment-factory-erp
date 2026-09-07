import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../cubit/hr_cubit.dart';

/// COMM-F05: حوار تسجيل سلفة عامل (POST /hr/advances) — اختيار العامل
/// من قائمة العمال المعروضة، مبلغ موجب، سبب إلزامي، وخيار "ترحيل نقدي
/// من خزينة" اختياري (قائمة الخزائن عبر HrCubit.fetchTreasuries — فشل
/// الجلب يعطّل الخيار بصمت مع تلميح "لا توجد خزائن").
///
/// الـ cubit يُمرَّر عبر constructor (لا context.read داخل الحوار).
class RecordAdvanceDialog extends StatefulWidget {
  const RecordAdvanceDialog({
    required this.cubit,
    required this.workers,
    super.key,
  });

  final HrCubit cubit;

  /// لقطة قائمة العمال المعروضة في الشاشة لحظة فتح الحوار.
  final List<Map<String, dynamic>> workers;

  @override
  State<RecordAdvanceDialog> createState() => _RecordAdvanceDialogState();
}

class _RecordAdvanceDialogState extends State<RecordAdvanceDialog> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _reasonController = TextEditingController();

  String? _workerId;
  List<Map<String, dynamic>> _treasuries = const [];
  bool _treasuriesLoaded = false;
  bool _cashTransfer = false;
  String? _treasuryId;
  var _isSaving = false;

  @override
  void initState() {
    super.initState();
    if (widget.workers.isNotEmpty) {
      _workerId = widget.workers.first['id']?.toString();
    }
    _loadTreasuries();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _loadTreasuries() async {
    final treasuries = await widget.cubit.fetchTreasuries();
    if (!mounted) return;
    setState(() {
      _treasuries = treasuries;
      _treasuriesLoaded = true;
      if (_cashTransfer && treasuries.isNotEmpty) {
        _treasuryId = treasuries.first['id']?.toString();
      }
    });
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    final workerId = _workerId;
    if (workerId == null) {
      setState(() => _isSaving = false);
      return;
    }
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _isSaving = false);
      return;
    }
    final error = await widget.cubit.recordAdvance(
      workerId: workerId,
      amount: amount,
      reason: _reasonController.text,
      treasuryId: _cashTransfer ? _treasuryId : null,
    );
    if (!mounted) return;
    if (error != null) {
      // رسالة الخادم الفعلية (messageFor) داخل الحوار — القائمة خلفه
      // لا تتأثر (نمط UAT-FIX).
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error), duration: const Duration(seconds: 4)),
      );
      return;
    }
    Navigator.of(context).pop(true);
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
    if (widget.workers.isEmpty) {
      return AlertDialog(
        title: const Text('تسجيل سلفة'),
        content: const Text('لا يوجد عمال مسجلون — أضف عاملًا أولًا.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('إغلاق'),
          ),
        ],
      );
    }
    return AlertDialog(
      title: const Text('تسجيل سلفة'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _workerId,
                  decoration: const InputDecoration(
                    labelText: 'العامل *',
                    prefixIcon: Icon(Icons.person),
                  ),
                  items: widget.workers
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
                  validator: (value) =>
                      value == null ? 'اختر العامل' : null,
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _amountController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'مبلغ السلفة (ج.م) *',
                    prefixIcon: Icon(Icons.payments),
                  ),
                  validator: (value) {
                    final amount = double.tryParse(value?.trim() ?? '');
                    return amount == null || amount <= 0
                        ? 'أدخل مبلغًا موجبًا'
                        : null;
                  },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _reasonController,
                  decoration: const InputDecoration(
                    labelText: 'سبب السلفة *',
                    prefixIcon: Icon(Icons.notes),
                  ),
                  validator: (value) =>
                      value == null || value.trim().isEmpty
                          ? 'سبب السلفة مطلوب'
                          : null,
                ),
                const SizedBox(height: 6),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'ترحيل نقدي من خزينة',
                    style: TextStyle(fontFamily: 'Cairo'),
                  ),
                  subtitle: Text(
                    _treasuriesLoaded && _treasuries.isEmpty
                        ? 'لا توجد خزائن — تُسجَّل السلفة كأصل مستحق فقط'
                        : 'يُخصم المبلغ من الخزينة ويُرحَّل قيد محاسبي',
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.textSecondary),
                  ),
                  value: _cashTransfer,
                  // فشل جلب الخزائن (صلاحية/شبكة) → تعطيل الخيار بصمت.
                  onChanged: _isSaving || _treasuries.isEmpty
                      ? null
                      : (value) {
                          setState(() {
                            _cashTransfer = value;
                            if (value && _treasuryId == null) {
                              _treasuryId =
                                  _treasuries.first['id']?.toString();
                            }
                            if (!value) _treasuryId = null;
                          });
                        },
                ),
                if (_cashTransfer && _treasuries.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  DropdownButtonFormField<String>(
                    initialValue: _treasuryId ??
                        _treasuries.first['id']?.toString(),
                    decoration: const InputDecoration(
                      labelText: 'الخزينة *',
                      prefixIcon: Icon(Icons.account_balance),
                    ),
                    items: _treasuries
                        .where((treasury) => treasury['id'] != null)
                        .map(
                          (treasury) => DropdownMenuItem<String>(
                            value: treasury['id'].toString(),
                            child: Text(
                                '${treasury['name'] ?? 'خزينة'}'),
                          ),
                        )
                        .toList(),
                    onChanged: _isSaving
                        ? null
                        : (value) => setState(() => _treasuryId = value),
                    validator: (value) =>
                        value == null ? 'اختر الخزينة' : null,
                  ),
                ],
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
          onPressed: _isSaving ? null : _save,
          icon: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.savings_outlined),
          label: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ السلفة'),
        ),
      ],
    );
  }
}
