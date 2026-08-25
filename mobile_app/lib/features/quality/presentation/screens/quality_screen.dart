import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/quality_cubit.dart';
import '../cubit/quality_state.dart';
import '../../../../core/widgets/barcode_scanner_screen.dart';

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
            onPressed: () async {
              // مسح باركود الحزمة
              final scannedCode = await Navigator.push(
                ctx,
                MaterialPageRoute(builder: (c) => const BarcodeScannerScreen()),
              );
              if (scannedCode != null) {
                if (ctx.mounted) {
                  _showAddQualityCheckDialog(ctx, scannedCode);
                }
              }
            },
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('فحص حزمة (باركود)', style: TextStyle(fontFamily: 'Cairo')),
          ),
        ),
      ),
    );
  }

  void _showAddQualityCheckDialog(BuildContext context, String workOrderCode) {
    final passedCtrl = TextEditingController();
    final rejectedCtrl = TextEditingController();
    String? selectedReason;
    final cubit = context.read<QualityCubit>();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('تقرير فحص: $workOrderCode', style: const TextStyle(fontFamily: 'Cairo')),
        content: StatefulBuilder(
          builder: (context, setDialogState) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: passedCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'العدد السليم')),
              TextField(controller: rejectedCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'العدد التالف')),
              DropdownButtonFormField<String>(
                hint: const Text('سبب التلف (إن وجد)'),
                value: selectedReason,
                items: ['SEWING_DEFECT', 'CUTTING_DEFECT', 'FABRIC_DEFECT', 'FINISHING_DEFECT'].map((r) => DropdownMenuItem(value: r, child: Text(_translateReason(r)))).toList(),
                onChanged: (v) => setDialogState(() => selectedReason = v),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('إلغاء'),
          ),
          ElevatedButton(
            onPressed: () {
              if (passedCtrl.text.isNotEmpty && rejectedCtrl.text.isNotEmpty) {
                cubit.submitQualityCheck(
                  workOrderId: workOrderCode, // In a real app we lookup the UUID from this Code
                  stage: 'SEWING', // Assuming check happens after sewing
                  checkedQty: int.parse(passedCtrl.text) + int.parse(rejectedCtrl.text),
                  passedQty: int.parse(passedCtrl.text),
                  rejectedQty: int.parse(rejectedCtrl.text),
                  rejectionReason: selectedReason,
                );
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم تسجيل الفحص!')));
              }
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
