import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../cubit/hr_cubit.dart';
import '../cubit/hr_state.dart';
import '../widgets/create_worker_dialog.dart';

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
            if (state is HrLoading || state is HrInitial) {
              return const AppLoadingView();
            } else if (state is HrError) {
              return AppErrorView(
                message: state.message,
                onRetry: () => context.read<HrCubit>().fetchWorkers(),
              );
            } else if (state is HrLoaded) {
              final workers = state.workers;
              if (workers.isEmpty) {
                return AppEmptyView(
                  title: 'لا يوجد عمال مسجلون',
                  actionLabel: 'إعادة التحميل',
                  onAction: () => context.read<HrCubit>().fetchWorkers(),
                );
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
                        icon: const Icon(Icons.add_task,
                            color: AppColors.success),
                        onPressed: () =>
                            _showRecordProductionDialog(context, worker),
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
          onPressed: () async {
            final saved = await showDialog<bool>(
              context: context,
              builder: (_) => CreateWorkerDialog(
                cubit: context.read<HrCubit>(),
              ),
            );
            if (saved == true && context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('تم حفظ العامل بنجاح')),
              );
            }
          },
          icon: const Icon(Icons.person_add),
          label: const Text('إضافة عامل'),
        ),
      ),
    );
  }

  String _translateSpecialty(String specialty) {
    switch (specialty) {
      case 'CUTTING':
        return 'قص';
      case 'SEWING':
        return 'خياطة';
      case 'FINISHING':
        return 'تشطيب';
      case 'PACKAGING':
        return 'تعبئة';
      case 'IRONING':
        return 'كي';
      default:
        return specialty;
    }
  }

  Future<void> _showRecordProductionDialog(
      BuildContext context, dynamic worker) async {
    final piecesController = TextEditingController();
    final cubit = context.read<HrCubit>();
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        var isSaving = false;
        return StatefulBuilder(
          builder: (context, setState) => AlertDialog(
            title: Text('تسجيل إنتاج - ${worker['name']}'),
            content: TextField(
              controller: piecesController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'عدد القطع المنجزة *',
                prefixIcon: Icon(Icons.checkroom),
              ),
            ),
            actions: [
              TextButton(
                onPressed: isSaving ? null : () => Navigator.pop(dialogContext),
                child: const Text('إلغاء'),
              ),
              FilledButton(
                onPressed: isSaving
                    ? null
                    : () async {
                        final pieces =
                            int.tryParse(piecesController.text.trim());
                        if (pieces == null || pieces <= 0) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('أدخل عددًا صحيحًا موجبًا')),
                          );
                          return;
                        }
                        setState(() => isSaving = true);
                        try {
                          await cubit.recordProduction(
                            workerId: worker['id'].toString(),
                            piecesCount: pieces,
                          );
                          if (dialogContext.mounted) {
                            Navigator.pop(dialogContext, true);
                          }
                        } catch (_) {
                          if (!context.mounted) return;
                          setState(() => isSaving = false);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('تعذر تسجيل الإنتاج')),
                          );
                        }
                      },
                child: Text(isSaving ? 'جاري الحفظ...' : 'حفظ'),
              ),
            ],
          ),
        );
      },
    );
    piecesController.dispose();
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل الإنتاج بنجاح')),
      );
    }
  }
}
