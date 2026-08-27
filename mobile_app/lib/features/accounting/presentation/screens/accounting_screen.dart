import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/widgets/app_feedback.dart';
import '../cubit/accounting_cubit.dart';

class AccountingScreen extends StatelessWidget {
  const AccountingScreen({super.key, this.cubit});

  final AccountingCubit? cubit;

  @override
  Widget build(BuildContext context) {
    final content = Builder(
      builder: (screenContext) => DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('الحسابات والمالية'),
            bottom: const TabBar(
              tabs: [
                Tab(text: 'أوامر الصرف والقبض', icon: Icon(Icons.receipt)),
                Tab(text: 'شجرة الحسابات', icon: Icon(Icons.account_tree)),
              ],
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.refresh),
                tooltip: 'تحديث',
                onPressed: () =>
                    screenContext.read<AccountingCubit>().fetchData(),
              ),
            ],
          ),
          body: BlocBuilder<AccountingCubit, AccountingState>(
            builder: (context, state) {
              if (state is AccountingInitial || state is AccountingLoading) {
                return const AppLoadingView();
              }
              if (state is AccountingError) {
                return AppErrorView(
                  message: state.message,
                  onRetry: () => context.read<AccountingCubit>().fetchData(),
                );
              }
              if (state is AccountingLoaded) {
                return TabBarView(
                  children: [
                    _buildVouchersTab(state.vouchers),
                    _buildAccountsTab(state.accounts),
                  ],
                );
              }
              return const SizedBox.shrink();
            },
          ),
          floatingActionButton: FloatingActionButton.extended(
            onPressed: () => _showCreateVoucherDialog(screenContext),
            icon: const Icon(Icons.add),
            label: const Text('سند جديد'),
          ),
        ),
      ),
    );

    if (cubit != null) {
      return BlocProvider<AccountingCubit>.value(value: cubit!, child: content);
    }
    return BlocProvider<AccountingCubit>(
      create: (_) => AccountingCubit()..fetchData(),
      child: content,
    );
  }

  Widget _buildVouchersTab(List<dynamic> vouchers) {
    if (vouchers.isEmpty) {
      return const AppEmptyView(title: 'لا توجد سندات مسجلة');
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: vouchers.length,
      itemBuilder: (context, index) {
        final voucher = vouchers[index] as Map;
        final isPayment = voucher['type'] == 'PAYMENT';
        final treasury = voucher['treasury'] as Map?;
        return Card(
          margin: const EdgeInsets.only(bottom: 10),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor:
                  isPayment ? Colors.red.shade50 : Colors.green.shade50,
              child: Icon(
                isPayment ? Icons.arrow_upward : Icons.arrow_downward,
                color: isPayment ? Colors.red : Colors.green,
              ),
            ),
            title: Text('${voucher['description'] ?? 'سند'}'),
            subtitle: Text(
              'القيمة: ${voucher['amount'] ?? 0} جنيه | '
              'الخزينة: ${treasury?['name'] ?? 'غير محددة'}\n'
              'الكود: ${voucher['code'] ?? voucher['journalEntry']?['code'] ?? ''}',
            ),
            trailing: Text(
              isPayment ? 'صرف' : 'قبض',
              style: TextStyle(
                color: isPayment ? Colors.red : Colors.green,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildAccountsTab(List<dynamic> accounts) {
    if (accounts.isEmpty) {
      return const AppEmptyView(title: 'شجرة الحسابات فارغة');
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: accounts.length,
      itemBuilder: (context, index) {
        final account = accounts[index] as Map;
        return Card(
          child: ListTile(
            leading: const Icon(Icons.account_balance_wallet),
            title: Text('${account['name'] ?? ''}'),
            subtitle: Text(
                'كود: ${account['code'] ?? ''} | النوع: ${account['type'] ?? ''}'),
            trailing:
                account['isGroup'] == true ? const Icon(Icons.folder) : null,
          ),
        );
      },
    );
  }

  Future<void> _showCreateVoucherDialog(BuildContext context) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _CreateVoucherDialog(
        cubit: context.read<AccountingCubit>(),
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل السند بنجاح')),
      );
    }
  }
}

class _CreateVoucherDialog extends StatefulWidget {
  const _CreateVoucherDialog({required this.cubit});

  final AccountingCubit cubit;

  @override
  State<_CreateVoucherDialog> createState() => _CreateVoucherDialogState();
}

class _CreateVoucherDialogState extends State<_CreateVoucherDialog> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _referenceController = TextEditingController();
  final _counterpartyController = TextEditingController();
  String _type = 'RECEIPT';
  String? _treasuryId;
  String? _counterpartyType;
  var _isSaving = false;

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    _referenceController.dispose();
    _counterpartyController.dispose();
    super.dispose();
  }

  Future<void> _save(AccountingLoaded state) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.createVoucher(
        type: _type,
        amount: double.parse(_amountController.text.trim()),
        description: _descriptionController.text.trim(),
        treasuryId: _treasuryId!,
        reference: _referenceController.text.trim(),
        counterpartyType: _counterpartyType,
        counterpartyId: _counterpartyController.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('تعذر حفظ السند. تحقق من الحسابات والصلاحيات.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.cubit.state;
    if (state is! AccountingLoaded) {
      return const AlertDialog(
        content: Text('بيانات الخزائن غير متاحة. حدّث الشاشة وحاول مرة أخرى.'),
      );
    }
    return AlertDialog(
      title: const Text('إنشاء سند جديد'),
      content: SizedBox(
        width: 460,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _type,
                  decoration: const InputDecoration(labelText: 'نوع السند *'),
                  items: const [
                    DropdownMenuItem(value: 'RECEIPT', child: Text('قبض')),
                    DropdownMenuItem(value: 'PAYMENT', child: Text('صرف')),
                  ],
                  onChanged: _isSaving
                      ? null
                      : (value) {
                          if (value != null) setState(() => _type = value);
                        },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _amountController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'المبلغ *'),
                  validator: (value) {
                    final amount = double.tryParse(value?.trim() ?? '');
                    return amount == null || amount <= 0
                        ? 'أدخل مبلغًا موجبًا'
                        : null;
                  },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _descriptionController,
                  decoration: const InputDecoration(labelText: 'الوصف *'),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'الوصف مطلوب'
                      : null,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _treasuryId,
                  decoration: const InputDecoration(labelText: 'الخزينة *'),
                  items: state.treasuries
                      .whereType<Map>()
                      .where((treasury) => treasury['id'] != null)
                      .map(
                        (treasury) => DropdownMenuItem<String>(
                          value: treasury['id'].toString(),
                          child: Text('${treasury['name'] ?? 'خزينة'}'),
                        ),
                      )
                      .toList(),
                  onChanged: _isSaving
                      ? null
                      : (value) => setState(() => _treasuryId = value),
                  validator: (value) => value == null ? 'اختر الخزينة' : null,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _counterpartyType,
                  decoration:
                      const InputDecoration(labelText: 'نوع الطرف المقابل'),
                  items: const [
                    DropdownMenuItem(value: 'CUSTOMER', child: Text('عميل')),
                    DropdownMenuItem(value: 'SUPPLIER', child: Text('مورد')),
                  ],
                  onChanged: _isSaving
                      ? null
                      : (value) => setState(() => _counterpartyType = value),
                ),
                if (_counterpartyType != null) ...[
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: _counterpartyController,
                    decoration: const InputDecoration(
                      labelText: 'معرف الطرف المقابل *',
                    ),
                    validator: (value) => value == null || value.trim().isEmpty
                        ? 'معرف الطرف المقابل مطلوب'
                        : null,
                  ),
                ],
                const SizedBox(height: 10),
                TextFormField(
                  controller: _referenceController,
                  decoration: const InputDecoration(labelText: 'مرجع خارجي'),
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
        FilledButton(
          onPressed: _isSaving ? null : () => _save(state),
          child: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ'),
        ),
      ],
    );
  }
}
