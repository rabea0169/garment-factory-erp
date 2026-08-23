import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/constants/app_colors.dart';
import 'cubit/sales_cubit.dart';

class SalesScreen extends StatelessWidget {
  const SalesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => SalesCubit()..fetchOrders(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('المبيعات والعملاء'),
          actions: [
            Builder(
              builder: (ctx) => IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ctx.read<SalesCubit>().fetchOrders(),
              ),
            ),
          ],
        ),
        body: BlocBuilder<SalesCubit, SalesState>(
          builder: (context, state) {
            if (state is SalesLoading) {
              return const Center(child: CircularProgressIndicator());
            } else if (state is SalesError) {
              return Center(
                  child: Text(state.message,
                      style: const TextStyle(
                          color: AppColors.error, fontFamily: 'Cairo')));
            } else if (state is SalesLoaded) {
              final orders = state.orders;
              if (orders.isEmpty) {
                return const Center(
                    child: Text('لا توجد مبيعات مسجلة',
                        style: TextStyle(fontFamily: 'Cairo')));
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: orders.length,
                itemBuilder: (context, index) {
                  final order = orders[index];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ExpansionTile(
                      leading: const CircleAvatar(
                        backgroundColor: AppColors.success,
                        child: Icon(Icons.receipt_long, color: Colors.white),
                      ),
                      title: Text('طلب ${order['code']}',
                          style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontFamily: 'Cairo')),
                      subtitle: Text(
                          'العميل: ${order['customer']['name']} | الإجمالي: ${order['totalAmount']} جنيه'),
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16.0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: (order['items'] as List).map<Widget>((item) {
                              final product = item['variant']['product']['name'];
                              final size = item['variant']['size'];
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8.0),
                                child: Text(
                                  '- $product (مقاس $size): ${item['quantity']} قطعة × ${item['unitPrice']} جنيه',
                                  style: const TextStyle(fontFamily: 'Cairo'),
                                ),
                              );
                            }).toList(),
                          ),
                        )
                      ],
                    ),
                  );
                },
              );
            }
            return const SizedBox();
          },
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () {},
          icon: const Icon(Icons.add_shopping_cart),
          label: const Text('أمر بيع جديد', style: TextStyle(fontFamily: 'Cairo')),
        ),
      ),
    );
  }
}