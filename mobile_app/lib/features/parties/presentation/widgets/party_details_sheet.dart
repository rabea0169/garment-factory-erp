import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/router/app_router.dart';

/// SELIM-ERP W4 — بطاقة تفاصيل الطرف (نقل PartyDetailsDialog من المرجع
/// تكييفًا جواليًا): bottom-sheet من بطاقة العميل/المورد يعرض الهوية
/// والرصيد وأزرار الانتقال:
/// - كشف الحساب (شاشة كشف الطرف من W3).
/// - السداد السريع للعملاء (نقل QuickPartyPaymentDialog P2-7): حوار
///   تحصيل يرحب بالمبلغ والملاحظات → POST /sales/customer-payments.
///   سداد الموردات غير معروض: لا مسار خادميًا (نموذج SupplierPayment
///   ساكن بقرار موثق في purchasing.service).
Future<void> showPartyDetailsSheet(
  BuildContext context, {
  required Map party,
  required bool isCustomer,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => _PartyDetailsSheet(
      party: Map<String, dynamic>.from(party),
      isCustomer: isCustomer,
    ),
  );
}

class _PartyDetailsSheet extends StatelessWidget {
  const _PartyDetailsSheet({required this.party, required this.isCustomer});

  final Map<String, dynamic> party;
  final bool isCustomer;

  String get _name => party['name']?.toString() ?? '—';

  String? get _phone {
    final phone = party['phone']?.toString();
    if (phone == null || phone.isEmpty) return null;
    return phone;
  }

  String get _code => party['code']?.toString() ?? '-';

  double get _balance => double.tryParse('${party['balance'] ?? 0}') ?? 0;

  @override
  Widget build(BuildContext context) {
    final id = party['id']?.toString();
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                backgroundColor:
                    isCustomer ? AppColors.success : AppColors.primary,
                child: Icon(
                  isCustomer ? Icons.person : Icons.business_outlined,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _name,
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '${isCustomer ? 'عميل' : 'مورد'} · كود $_code'
                      '${_phone != null ? ' · $_phone' : ''}',
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 12,
                        color: Colors.black54,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _balance > 0
                  ? AppColors.success.withValues(alpha: 0.12)
                  : Colors.grey.shade200,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              children: [
                Text(
                  isCustomer ? 'الرصيد المدين (مستحق لنا)' : 'الرصيد (مستحق له)',
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 11,
                    color: Colors.black54,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${_balance.toStringAsFixed(2)} ج.م',
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: id == null
                  ? null
                  : () {
                      final route = isCustomer
                          ? '${AppRouter.customerStatement}/$id'
                          : '${AppRouter.supplierStatement}/$id';
                      Navigator.of(context).pop();
                      context.push(route);
                    },
              icon: const Icon(Icons.receipt_long_outlined),
              label: const Text('كشف الحساب'),
            ),
          ),
          if (isCustomer && id != null) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: FilledButton.tonalIcon(
                onPressed: () {
                  Navigator.of(context).pop();
                  showDialog<void>(
                    context: context,
                    builder: (_) => QuickPartyPaymentDialog(customerId: id),
                  );
                },
                icon: const Icon(Icons.payments_outlined),
                label: const Text('تحصيل سريع'),
              ),
            ),
          ] else if (!isCustomer)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                'سداد الموردات يسجَّل من الخزينة والمشتريات — لا مسار سداد '
                'مورد مباشر بعد.',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 11,
                  color: Colors.black45,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// السداد السريع (نقل QuickPartyPaymentDialog من المرجع P2-7): مبلغ +
/// ملاحظات → POST /sales/customer-payments بندمجية Idempotency-Key —
/// بلا ربط بأمر بيع محدد (سداد على الحساب كما في المرجع).
class QuickPartyPaymentDialog extends StatefulWidget {
  const QuickPartyPaymentDialog({required this.customerId, super.key});

  final String customerId;

  @override
  State<QuickPartyPaymentDialog> createState() =>
      _QuickPartyPaymentDialogState();
}

class _QuickPartyPaymentDialogState extends State<QuickPartyPaymentDialog> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _notesController = TextEditingController();
  var _isSaving = false;

  @override
  void dispose() {
    _amountController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await ApiClient.instance.dio.post<dynamic>(
        '/sales/customer-payments',
        data: <String, dynamic>{
          'customerId': widget.customerId,
          'amount': double.parse(_amountController.text.trim()),
          if (_notesController.text.trim().isNotEmpty)
            'notes': _notesController.text.trim(),
        },
        options: Options(
          headers: {'Idempotency-Key': DateTime.now().microsecondsSinceEpoch.toString()},
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              'تعذر تسجيل التحصيل: ${ApiClient.instance.messageFor(error)}'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('تحصيل سريع من العميل',
          style: TextStyle(fontFamily: 'Cairo')),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: _amountController,
              autofocus: true,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'قيمة التحصيل *'),
              validator: (value) {
                final amount = double.tryParse(value?.trim() ?? '');
                return amount == null || amount <= 0
                    ? 'أدخل قيمة موجبة'
                    : null;
              },
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _notesController,
              decoration: const InputDecoration(labelText: 'ملاحظات'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
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
              : const Icon(Icons.payments_outlined),
          label: const Text('تسجيل التحصيل'),
        ),
      ],
    );
  }
}
