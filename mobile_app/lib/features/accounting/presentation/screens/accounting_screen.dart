import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/accounting_cubit.dart';

class AccountingScreen extends StatelessWidget {
  const AccountingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => AccountingCubit()..fetchData(),
      child: DefaultTabController(
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
          ),
          body: BlocBuilder<AccountingCubit, AccountingState>(
            builder: (context, state) {
              if (state is AccountingLoading) {
                return const Center(child: CircularProgressIndicator());
              } else if (state is AccountingError) {
                return Center(
                    child: Text(state.message,
                        style: const TextStyle(
                            color: AppColors.error, fontFamily: 'Cairo')));
              } else if (state is AccountingLoaded) {
                return TabBarView(
                  children: [
                    _buildVouchersTab(state.vouchers),
                    _buildAccountsTab(state.accounts),
                  ],
                );
              }
              return const SizedBox();
            },
          ),
          floatingActionButton: Builder(
            builder: (context) => FloatingActionButton.extended(
              onPressed: () {},
              icon: const Icon(Icons.add),
              label: const Text('سند جديد', style: TextStyle(fontFamily: 'Cairo')),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildVouchersTab(List<dynamic> vouchers) {
    if (vouchers.isEmpty) {
      return const Center(
          child: Text('لا توجد سندات مسجلة',
              style: TextStyle(fontFamily: 'Cairo')));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: vouchers.length,
      itemBuilder: (context, index) {
        final voucher = vouchers[index];
        final isPayment = voucher['type'] == 'PAYMENT';
        return Card(
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: isPayment ? AppColors.error : AppColors.success,
              child: Icon(
                  isPayment ? Icons.arrow_downward : Icons.arrow_upward,
                  color: Colors.white),
            ),
            title: Text(voucher['description'],
                style: const TextStyle(
                    fontWeight: FontWeight.bold, fontFamily: 'Cairo')),
            subtitle: Text('القيمة: ${voucher['amount']} جنيه | الكود: ${voucher['code']}'),
            trailing: Text(isPayment ? 'صرف' : 'قبض', style: TextStyle(color: isPayment ? AppColors.error : AppColors.success, fontWeight: FontWeight.bold)),
          ),
        );
      },
    );
  }

  Widget _buildAccountsTab(List<dynamic> accounts) {
    if (accounts.isEmpty) {
      return const Center(
          child: Text('شجرة الحسابات فارغة',
              style: TextStyle(fontFamily: 'Cairo')));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: accounts.length,
      itemBuilder: (context, index) {
        final account = accounts[index];
        return Card(
          child: ListTile(
            leading: const Icon(Icons.account_balance_wallet, color: AppColors.primary),
            title: Text(account['name'],
                style: const TextStyle(
                    fontWeight: FontWeight.bold, fontFamily: 'Cairo')),
            subtitle: Text('كود: ${account['code']} | النوع: ${account['type']}'),
            trailing: account['isGroup'] ? const Icon(Icons.folder) : null,
          ),
        );
      },
    );
  }
}