import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../../../core/constants/app_colors.dart';
import '../../../../../core/widgets/app_feedback.dart';
import '../cubit/worker_activity_cubit.dart';
import '../cubit/worker_activity_state.dart';

/// MOB-8: شاشة نشاط العامل — تبويبان: آخر السلف وآخر إنتاج العامل
/// (أبسط تمثيل قائمة). تُفتح من بطاقة العامل في شاشة الموارد البشرية.
class WorkerActivityScreen extends StatelessWidget {
  const WorkerActivityScreen({
    required this.workerId,
    this.workerName,
    this.cubit,
    super.key,
  });

  /// معرف العامل من المسار.
  final String workerId;

  /// اسم العامل (extra من الشاشة السابقة — اختياري).
  final String? workerName;

  /// يُحقن في الاختبارات؛ الافتراضي cubit جديد يبدأ الجلب فورًا.
  final WorkerActivityCubit? cubit;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) =>
          cubit ??
          (WorkerActivityCubit(
            workerId: workerId,
            workerName: workerName ?? '',
          )..fetchActivity()),
      child: DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: AppBar(
            title: Text('نشاط العامل${_titleSuffix()}'),
            bottom: const TabBar(
              tabs: [
                Tab(text: 'آخر السلف'),
                Tab(text: 'آخر الإنتاج'),
              ],
            ),
          ),
          body: const _WorkerActivityBody(),
        ),
      ),
    );
  }

  String _titleSuffix() =>
      (workerName == null || workerName!.isEmpty) ? '' : ': $workerName';
}

class _WorkerActivityBody extends StatelessWidget {
  const _WorkerActivityBody();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<WorkerActivityCubit, WorkerActivityState>(
      builder: (context, state) {
        if (state is WorkerActivityLoading || state is WorkerActivityInitial) {
          return const AppLoadingView(message: 'جاري تحميل نشاط العامل...');
        }
        if (state is WorkerActivityError) {
          return AppErrorView(
            message: state.message,
            onRetry: () => context.read<WorkerActivityCubit>().fetchActivity(),
          );
        }
        if (state is WorkerActivityLoaded) {
          return TabBarView(
            children: [
              _AdvanceList(advances: state.advances),
              _ProductionList(production: state.production),
            ],
          );
        }
        return const SizedBox.shrink();
      },
    );
  }
}

class _AdvanceList extends StatelessWidget {
  const _AdvanceList({required this.advances});

  final List<Map<String, dynamic>> advances;

  @override
  Widget build(BuildContext context) {
    if (advances.isEmpty) {
      return const AppEmptyView(title: 'لا توجد سلف لهذا العامل');
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: advances.length,
      itemBuilder: (context, index) {
        final advance = advances[index];
        final amount = num.tryParse(advance['amount']?.toString() ?? '') ?? 0;
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: const CircleAvatar(
              backgroundColor: AppColors.secondary,
              child: Icon(Icons.currency_exchange, color: Colors.white),
            ),
            title: Text(
              '${amount.toStringAsFixed(2)} ج.م',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontFamily: 'Cairo',
              ),
            ),
            subtitle: Text(
              'التاريخ: ${_formatDate(advance['date'])}'
              '${(advance['notes']?.toString() ?? '').isEmpty ? '' : '\n${advance['notes']}'}',
            ),
            isThreeLine: (advance['notes']?.toString() ?? '').isNotEmpty,
          ),
        );
      },
    );
  }
}

class _ProductionList extends StatelessWidget {
  const _ProductionList({required this.production});

  final List<Map<String, dynamic>> production;

  @override
  Widget build(BuildContext context) {
    if (production.isEmpty) {
      return const AppEmptyView(title: 'لا يوجد إنتاج مسجل لهذا العامل');
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: production.length,
      itemBuilder: (context, index) {
        final entry = production[index];
        final pieces =
            num.tryParse(entry['piecesCount']?.toString() ?? '') ?? 0;
        final date = _formatDate(entry['date'] ?? entry['createdAt']);
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: const CircleAvatar(
              backgroundColor: AppColors.success,
              child: Icon(Icons.checkroom, color: Colors.white),
            ),
            title: Text('${pieces.toInt()} قطعة'),
            subtitle: Text('التاريخ: $date'),
          ),
        );
      },
    );
  }
}

String _formatDate(Object? value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '');
  if (parsed == null) return 'غير معروف';
  return DateFormat('yyyy-MM-dd').format(parsed);
}
