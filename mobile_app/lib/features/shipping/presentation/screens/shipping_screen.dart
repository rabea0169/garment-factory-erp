import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/shipping_cubit.dart';
import '../cubit/shipping_state.dart';
import 'package:intl/intl.dart';

class ShippingScreen extends StatelessWidget {
  const ShippingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => ShippingCubit()..fetchShipments(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('الشحن والتوصيل'),
          actions: [
            Builder(
              builder: (ctx) => IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ctx.read<ShippingCubit>().fetchShipments(),
              ),
            ),
          ],
        ),
        body: BlocBuilder<ShippingCubit, ShippingState>(
          builder: (context, state) {
            if (state is ShippingLoading) {
              return const Center(child: CircularProgressIndicator());
            } else if (state is ShippingError) {
              return Center(child: Text(state.message, style: const TextStyle(color: AppColors.error, fontFamily: 'Cairo')));
            } else if (state is ShippingLoaded) {
              final shipments = state.shipments;
              if (shipments.isEmpty) {
                return const Center(child: Text('لا توجد شحنات مسجلة حالياً', style: TextStyle(fontFamily: 'Cairo')));
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: shipments.length,
                itemBuilder: (context, index) {
                  final shipment = shipments[index];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ListTile(
                      leading: const CircleAvatar(
                        backgroundColor: AppColors.primary,
                        child: Icon(Icons.local_shipping, color: Colors.white),
                      ),
                      title: Text('تتبع: ${shipment['trackingNumber']}', style: const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Cairo')),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('شركة الشحن: ${shipment['carrier']}'),
                          Text('أمر البيع: ${shipment['salesOrder']?['code'] ?? "غير متوفر"}'),
                          Text('الحالة: ${_translateStatus(shipment['status'])}'),
                          Text(DateFormat('yyyy-MM-dd hh:mm a').format(DateTime.parse(shipment['createdAt']))),
                        ],
                      ),
                      trailing: IconButton(
                        icon: const Icon(Icons.edit, color: AppColors.secondary),
                        onPressed: () {
                          // Change Status UI
                        },
                      ),
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
          icon: const Icon(Icons.add_box),
          label: const Text('شحنة جديدة', style: TextStyle(fontFamily: 'Cairo')),
        ),
      ),
    );
  }

  String _translateStatus(String status) {
    switch (status) {
      case 'PENDING': return 'قيد الانتظار';
      case 'DISPATCHED': return 'في الطريق';
      case 'DELIVERED': return 'تم التسليم';
      case 'RETURNED': return 'مرتجع';
      default: return status;
    }
  }
}