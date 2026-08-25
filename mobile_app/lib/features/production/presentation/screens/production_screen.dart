import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/production_cubit.dart';
import '../cubit/production_state.dart';

class ProductionScreen extends StatelessWidget {
  const ProductionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => ProductionCubit()..fetchWorkOrders(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('الإنتاج وأوامر التشغيل'),
          actions: [
            Builder(
              builder: (ctx) => IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ctx.read<ProductionCubit>().fetchWorkOrders(),
              ),
            ),
          ],
        ),
        body: BlocBuilder<ProductionCubit, ProductionState>(
          builder: (context, state) {
            if (state is ProductionLoading) {
              return const Center(child: CircularProgressIndicator());
            } else if (state is ProductionError) {
              return Center(child: Text(state.message, style: const TextStyle(color: AppColors.error, fontFamily: 'Cairo')));
            } else if (state is ProductionLoaded) {
              final orders = state.workOrders;
              if (orders.isEmpty) {
                return const Center(child: Text('لا توجد أوامر تشغيل حالياً', style: TextStyle(fontFamily: 'Cairo')));
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: orders.length,
                itemBuilder: (context, index) {
                  final order = orders[index];
                  final variant = order['productVariant'];
                  final product = variant['product'];
                  
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ExpansionTile(
                      leading: _getStatusIcon(order['status']),
                      title: Text('${product['name']} (مقاس: ${variant['size']})', style: const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Cairo')),
                      subtitle: Text('الكمية: ${order['quantity']} قطعة | حالة: ${_translateStatus(order['status'])}'),
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16.0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('تاريخ الإضافة: ${DateFormat('yyyy-MM-dd').format(DateTime.parse(order['createdAt']))}', style: const TextStyle(fontFamily: 'Cairo')),
                              const SizedBox(height: 12),
                              if (order['status'] != 'COMPLETED')
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                  children: [
                                    if (order['status'] == 'PLANNED')
                                      ElevatedButton(
                                        onPressed: () {
                                          context.read<ProductionCubit>().updateOrderStatus(order['id'], 'CUTTING');
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            const SnackBar(
                                              content: Text('تم بدء القص وطباعة باركود الحزمة بنجاح عبر طابعة البلوتوث! 🖨️', style: TextStyle(fontFamily: 'Cairo')),
                                              backgroundColor: AppColors.primary,
                                            ),
                                          );
                                        },
                                        child: const Text('بدء القص وطباعة التيكت', style: TextStyle(fontFamily: 'Cairo')),
                                      ),
                                    if (order['status'] == 'CUTTING' || order['status'] == 'SEWING' || order['status'] == 'FINISHING')
                                      ElevatedButton(
                                        style: ElevatedButton.styleFrom(backgroundColor: AppColors.success),
                                        onPressed: () => context.read<ProductionCubit>().updateOrderStatus(order['id'], 'COMPLETED'),
                                        child: const Text('إنهاء واستلام بالمخزن', style: TextStyle(fontFamily: 'Cairo')),
                                      ),
                                  ],
                                ),
                            ],
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
          icon: const Icon(Icons.add),
          label: const Text('أمر جديد', style: TextStyle(fontFamily: 'Cairo')),
        ),
      ),
    );
  }

  Widget _getStatusIcon(String status) {
    switch (status) {
      case 'PLANNED':
        return const Icon(Icons.calendar_today, color: Colors.blue);
      case 'IN_PROGRESS':
        return const Icon(Icons.sync, color: AppColors.warning);
      case 'COMPLETED':
        return const Icon(Icons.check_circle, color: AppColors.success);
      default:
        return const Icon(Icons.info, color: Colors.grey);
    }
  }

  String _translateStatus(String status) {
    switch (status) {
      case 'PLANNED': return 'مخطط';
      case 'CUTTING': return 'مرحلة القص';
      case 'SEWING': return 'مرحلة الخياطة';
      case 'FINISHING': return 'التشطيب';
      case 'COMPLETED': return 'مكتمل';
      default: return status;
    }
  }
}
