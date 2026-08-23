import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/hr_cubit.dart';
import '../cubit/hr_state.dart';

class HrScreen extends StatelessWidget {
  const HrScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => HrCubit()..fetchWorkers(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('الموارد البشرية والعمال'),
          actions: [
            Builder(
              builder: (ctx) => IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ctx.read<HrCubit>().fetchWorkers(),
              ),
            ),
          ],
        ),
        body: BlocBuilder<HrCubit, HrState>(
          builder: (context, state) {
            if (state is HrLoading) {
              return const Center(child: CircularProgressIndicator());
            } else if (state is HrError) {
              return Center(
                  child: Text(state.message,
                      style: const TextStyle(
                          color: AppColors.error, fontFamily: 'Cairo')));
            } else if (state is HrLoaded) {
              final workers = state.workers;
              if (workers.isEmpty) {
                return const Center(
                    child: Text('لا يوجد عمال مسجلين',
                        style: TextStyle(fontFamily: 'Cairo')));
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: workers.length,
                itemBuilder: (context, index) {
                  final worker = workers[index];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ListTile(
                      leading: const CircleAvatar(
                        backgroundColor: AppColors.primary,
                        child: Icon(Icons.person, color: Colors.white),
                      ),
                      title: Text(worker['name'],
                          style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontFamily: 'Cairo')),
                      subtitle: Text(
                          'كود: ${worker['code']} | التخصص: ${_translateSpecialty(worker['specialty'])}'),
                      trailing: IconButton(
                        icon: const Icon(Icons.add_task, color: AppColors.success),
                        onPressed: () => _showRecordProductionDialog(context, worker),
                      ),
                      onTap: () {
                        // الانتقال لصفحة تفاصيل العامل
                      },
                    ),
                  );
                },
              );
            }
            return const SizedBox();
          },
        ),
        floatingActionButton: FloatingActionButton(
          onPressed: () {},
          child: const Icon(Icons.person_add),
        ),
      ),
    );
  }

  String _translateSpecialty(String specialty) {
    switch (specialty) {
      case 'CUTTING': return 'قص';
      case 'SEWING': return 'خياطة';
      case 'FINISHING': return 'تشطيب';
      case 'PACKAGING': return 'تعبئة';
      case 'IRONING': return 'كي';
      default: return specialty;
    }
  }

  void _showRecordProductionDialog(BuildContext context, dynamic worker) {
    final piecesController = TextEditingController();
    final cubit = context.read<HrCubit>(); // Get cubit reference before async

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('تسجيل إنتاج - ${worker['name']}', style: const TextStyle(fontFamily: 'Cairo')),
        content: TextField(
          controller: piecesController,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'عدد القطع المنجزة',
            prefixIcon: Icon(Icons.checkroom),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('إلغاء', style: TextStyle(fontFamily: 'Cairo')),
          ),
          ElevatedButton(
            onPressed: () {
              if (piecesController.text.isNotEmpty) {
                cubit.recordProduction(
                  workerId: worker['id'],
                  piecesCount: int.parse(piecesController.text),
                );
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('تم تسجيل الإنتاج بنجاح', style: TextStyle(fontFamily: 'Cairo'))),
                );
              }
            },
            child: const Text('حفظ', style: TextStyle(fontFamily: 'Cairo')),
          ),
        ],
      ),
    );
  }
}