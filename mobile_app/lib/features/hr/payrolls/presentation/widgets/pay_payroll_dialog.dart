import 'package:flutter/material.dart';

import '../../../../../core/constants/app_colors.dart';
import '../cubit/payrolls_cubit.dart';

/// GF-IMP-W3: حوار دفع كشف راتب معتمد (POST /hr/payrolls/:id/pay) —
/// اختيار الخزينة من GET /accounting/treasuries (عبر PayrollsCubit.
/// fetchTreasuries). فشل جلب الخزائن/فراغها = تلميح "لا توجد خزائن"
/// مع إبقاء الدفع متاحًا لحالة صافٍ = صفر (HR-4).
///
/// ناتج الحوار: null = إلغاء، نص فارغ = دفع بلا خزينة، وإلا معرف
/// الخزينة المختارة.
///
/// الـ cubit يُمرَّر عبر constructor (لا context.read داخل الحوار).
class PayPayrollDialog extends StatefulWidget {
  const PayPayrollDialog({required this.cubit, required this.payroll, super.key});

  final PayrollsCubit cubit;

  /// بيانات الكشف المعروضة في الملخص (worker/netAmount).
  final Map<String, dynamic> payroll;

  @override
  State<PayPayrollDialog> createState() => _PayPayrollDialogState();
}

class _PayPayrollDialogState extends State<PayPayrollDialog> {
  List<Map<String, dynamic>> _treasuries = const [];
  bool _treasuriesLoaded = false;
  String? _treasuryId;

  @override
  void initState() {
    super.initState();
    _loadTreasuries();
  }

  Future<void> _loadTreasuries() async {
    final treasuries = await widget.cubit.fetchTreasuries();
    if (!mounted) return;
    setState(() {
      _treasuries = treasuries;
      _treasuriesLoaded = true;
      if (treasuries.isNotEmpty) {
        _treasuryId = treasuries.first['id']?.toString();
      }
    });
  }

  void _confirm() {
    // معرف الخزينة أو نص فارغ (دفع بلا خزينة — صافٍ صفر HR-4).
    Navigator.of(context).pop(_treasuryId ?? '');
  }

  static String _workerName(Map<String, dynamic> payroll) {
    final worker = payroll['worker'];
    if (worker is Map) {
      final name = worker['name']?.toString();
      if (name != null && name.isNotEmpty) return name;
    }
    return payroll['workerName']?.toString() ?? 'عامل غير معروف';
  }

  static String _netAmount(Object? value) {
    final parsed = num.tryParse(value?.toString() ?? '');
    return parsed == null ? '0.00' : parsed.toStringAsFixed(2);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('دفع كشف الراتب'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${_workerName(widget.payroll)} — الصافي: '
              '${_netAmount(widget.payroll['netAmount'])} ج.م',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontFamily: 'Cairo',
              ),
            ),
            const SizedBox(height: 12),
            if (!_treasuriesLoaded)
              const Row(
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 8),
                  Text('جاري تحميل الخزائن...'),
                ],
              )
            else if (_treasuries.isEmpty)
              const Text(
                'لا توجد خزائن — الدفع متاح فقط إذا كان الصافي صفرًا',
                style: TextStyle(color: AppColors.warning),
              )
            else
              DropdownButtonFormField<String>(
                initialValue: _treasuryId,
                decoration: const InputDecoration(
                  labelText: 'الخزينة *',
                  prefixIcon: Icon(Icons.account_balance),
                ),
                items: _treasuries
                    .where((treasury) => treasury['id'] != null)
                    .map(
                      (treasury) => DropdownMenuItem<String>(
                        value: treasury['id'].toString(),
                        child: Text('${treasury['name'] ?? 'خزينة'}'),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() => _treasuryId = value),
                validator: (value) => value == null ? 'اختر الخزينة' : null,
              ),
            const SizedBox(height: 12),
            Text(
              'ملاحظة: فصل الواجبات — يجب أن يكون الدافع مستخدمًا مختلفًا عن '
              'من اعتمد الكشف (وإلا يُرفض الطلب خادميًا).',
              style: const TextStyle(
                fontSize: 11,
                color: AppColors.textSecondary,
                fontFamily: 'Cairo',
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        FilledButton.icon(
          onPressed: _confirm,
          icon: const Icon(Icons.payments_outlined),
          label: const Text('دفع'),
        ),
      ],
    );
  }
}
