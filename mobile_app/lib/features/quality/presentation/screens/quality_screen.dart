import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/quality_cubit.dart';
import '../cubit/quality_state.dart';

class QualityScreen extends StatelessWidget {
  const QualityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => QualityCubit()..fetchQualityChecks(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('مراقبة الجودة'),
          actions: [
            Builder(
              builder: (ctx) => IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ctx.read<QualityCubit>().fetchQualityChecks(),
              ),
            ),
          ],
        ),
        body: BlocBuilder<QualityCubit, QualityState>(
          builder: (context, state) {
            if (state is QualityLoading) {
              return const Center(child: CircularProgressIndicator());
            } else if (state is QualityError) {
              return Center(child: Text(state.message, style: const TextStyle(color: AppColors.error, fontFamily: 'Cairo')));
            } else if (state is QualityLoaded) {
              final checks = state.qualityChecks;
              if (checks.isEmpty) {
                return const Center(child: Text('لا توجد تقارير جودة مسجلة', style: TextStyle(fontFamily: 'Cairo')));
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: checks.length,
                itemBuilder: (context, index) {
                  final check = checks[index];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ListTile(
                      leading: Icon(
                        check['rejectedQty'] > 0 ? Icons.warning : Icons.check_circle,
                        color: check['rejectedQty'] > 0 ? AppColors.error : AppColors.success,
                        size: 32,
                      ),
                      title: Text('أمر تشغيل: ${check['workOrder']['code'] ?? "غير معروف"}', style: const TextStyle(fontWeight: FontWeight.bold, fontFamily: 'Cairo')),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('تم فحص: ${check['checkedQty']} | سليم: ${check['passedQty']} | تالف: ${check['rejectedQty']}'),
                          if (check['rejectionReason'] != null)
                            Text('سبب الرفض: ${_translateReason(check['rejectionReason'])}', style: const TextStyle(color: AppColors.error)),
                          Text(DateFormat('yyyy-MM-dd hh:mm a').format(DateTime.parse(check['checkedAt']))),
                        ],
                      ),
                    ),
                  );
                },
              );
            }
            return const SizedBox();
          },
        ),
        floatingActionButton: Builder(
          builder: (ctx) => FloatingActionButton.extended(
            onPressed: () => _showAddQualityCheckDialog(ctx),
            icon: const Icon(Icons.playlist_add_check),
            label: const Text('تقرير جديد', style: TextStyle(fontFamily: 'Cairo')),
          ),
        ),
      ),
    );
  }

  void _showAddQualityCheckDialog(BuildContext context) {
    // UI input fields for adding new check (Work Order ID, Passed Qty, Rejected Qty, etc.)
    final cubit = context.read<QualityCubit>();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('إضافة تقرير جودة', style: TextStyle(fontFamily: 'Cairo')),
        content: const Text('سيتم إضافة الواجهة التفصيلية للنموذج هنا. حالياً مقتصرة على العرض كنموذج.', style: TextStyle(fontFamily: 'Cairo')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('إلغاء'),
          ),
          ElevatedButton(
            onPressed: () {
              // Example hardcoded submit
              // cubit.submitQualityCheck(...)
              Navigator.pop(ctx);
            },
            child: const Text('حفظ'),
          ),
        ],
      ),
    );
  }

  String _translateReason(String reason) {
    switch (reason) {
      case 'SEWING_DEFECT': return 'عيب خياطة';
      case 'CUTTING_DEFECT': return 'عيب قص';
      case 'FABRIC_DEFECT': return 'عيب قماش';
      case 'FINISHING_DEFECT': return 'عيب تشطيب';
      default: return 'أخرى';
    }
  }
}