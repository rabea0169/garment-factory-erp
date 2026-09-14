import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../../../core/constants/app_colors.dart';
import '../../../../../core/navigation/back_navigation.dart';
import '../../../../../core/services/worker_report_pdf_service.dart';
import '../../../../../core/widgets/app_feedback.dart';
import '../../../../../core/widgets/selim/format.dart';
import '../cubit/worker_report_cubit.dart';
import '../cubit/worker_report_state.dart';

/// SELIM-ERP W5 — شاشة تقرير العامل المجمّع (نقل WorkerReportModal من
/// المرجع تكييفًا جواليًا): منتقي نطاق تاريخ (افتراضي بداية الشهر حتى
/// اليوم) + بطاقات ملخص + تبويبات الحركات الخمسة + تصدير PDF عربي.
/// داخل BackGuard (زر الرجوع الموحد) — قيود الوصول من بادئة /hr/workers.
class WorkerReportScreen extends StatelessWidget {
  const WorkerReportScreen({
    required this.workerId,
    this.workerName,
    super.key,
  });

  /// معرف العامل من المسار.
  final String workerId;

  /// اسم العامل للترويسة (extra اختياري).
  final String? workerName;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => WorkerReportCubit(workerId: workerId)..fetchReport(),
      child: DefaultTabController(
        length: 5,
        child: Scaffold(
          appBar: AppBar(
            leading: const GfBackButton(),
            title: Text('تقرير العامل${_titleSuffix()}'),
            actions: const [_PdfAction()],
            bottom: const TabBar(
              isScrollable: true,
              tabs: [
                Tab(text: 'السلف'),
                Tab(text: 'سندات القبض'),
                Tab(text: 'الحضور'),
                Tab(text: 'الإنتاج'),
                Tab(text: 'الرواتب'),
              ],
            ),
          ),
          body: const _WorkerReportBody(),
        ),
      ),
    );
  }

  String _titleSuffix() =>
      (workerName == null || workerName!.isEmpty) ? '' : ': $workerName';
}

class _WorkerReportBody extends StatelessWidget {
  const _WorkerReportBody();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<WorkerReportCubit, WorkerReportState>(
      builder: (context, state) {
        if (state is WorkerReportLoading || state is WorkerReportInitial) {
          return const AppLoadingView(message: 'جاري تحميل تقرير العامل...');
        }
        if (state is WorkerReportError) {
          return AppErrorView(
            message: state.message,
            onRetry: () => context.read<WorkerReportCubit>().fetchReport(),
          );
        }
        if (state is WorkerReportLoaded) {
          return Column(
            children: [
              _RangeBar(from: state.from, to: state.to),
              _SummaryGrid(summary: state.report['summary']),
              const Divider(height: 1),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => context
                      .read<WorkerReportCubit>()
                      .fetchReport(from: state.from, to: state.to),
                  child: _MovementTabs(report: state.report),
                ),
              ),
            ],
          );
        }
        return const SizedBox.shrink();
      },
    );
  }
}

/// شريط نطاق التاريخ: زران يفتحان منتقي التاريخ ثم إعادة الجلب.
class _RangeBar extends StatelessWidget {
  const _RangeBar({required this.from, required this.to});

  final DateTime from;
  final DateTime to;

  Future<void> _pick(
    BuildContext context,
    bool isFrom,
    DateTime current,
  ) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
      helpText: isFrom ? 'اختر بداية الفترة' : 'اختر نهاية الفترة',
    );
    if (picked == null || !context.mounted) return;
    final cubit = context.read<WorkerReportCubit>();
    if (isFrom) {
      await cubit.fetchReport(
        from: picked,
        to: to.isBefore(picked) ? picked : to,
      );
    } else {
      await cubit.fetchReport(
        from: from.isAfter(picked) ? picked : from,
        to: picked,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('yyyy-MM-dd');
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(
        children: [
          const Icon(Icons.date_range, size: 18, color: AppColors.primary),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton(
              onPressed: () => _pick(context, true, from),
              child: Text('من ${fmt.format(from)}',
                  style: const TextStyle(fontFamily: 'Cairo')),
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 6),
            child: Text('—', style: TextStyle(fontFamily: 'Cairo')),
          ),
          Expanded(
            child: OutlinedButton(
              onPressed: () => _pick(context, false, to),
              child: Text('إلى ${fmt.format(to)}',
                  style: const TextStyle(fontFamily: 'Cairo')),
            ),
          ),
        ],
      ),
    );
  }
}

/// ملخص التقرير: بطاقتا الرصيد (ملونة بالاتجاه) + بطاقات المجاميع.
class _SummaryGrid extends StatelessWidget {
  const _SummaryGrid({required this.summary});

  final Object? summary;

  Map<String, dynamic> get _map =>
      summary is Map ? Map<String, dynamic>.from(summary as Map) : {};

  num _numOf(String key) => num.tryParse('${_map[key]}') ?? 0;

  @override
  Widget build(BuildContext context) {
    final closing = _numOf('closingNet');
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _BalanceCard(
                  label: 'رصيد أول الفترة',
                  value: money(_numOf('openingNet')),
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _BalanceCard(
                  label: 'رصيد آخر الفترة',
                  value: money(closing),
                  subtitle:
                      closing >= 0 ? 'العامل مدين للشركة' : 'مستحق للعامل',
                  color: closing >= 0 ? AppColors.error : AppColors.success,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _Chip('سلف الفترة: ${money(_numOf('totalAdvances'))}'),
                _Chip('سندات القبض: ${money(_numOf('totalReceipts'))}'),
                _Chip('إنتاج: ${count(_numOf('totalPieces'))} قطعة'),
                _Chip('قيمة الإنتاج: ${money(_numOf('productionValue'))}'),
                _Chip('صافي الرواتب: ${money(_numOf('totalNet'))}'),
                _Chip(
                  'حضور/غياب: ${count(_numOf('presentDays'))} / '
                  '${count(_numOf('absentDays'))}',
                ),
                _Chip(
                    'سلف غير مسوية: ${money(_numOf('unsettledAdvancesAsOf'))}'),
                _Chip(
                    'رواتب مستحقة: ${money(_numOf('unpaidApprovedNetAsOf'))}'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({
    required this.label,
    required this.value,
    required this.color,
    this.subtitle,
  });

  final String label;
  final String value;
  final Color color;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 12,
                  color: AppColors.textSecondary)),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: color,
              )),
          if (subtitle != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(subtitle!,
                  style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 10,
                      color: AppColors.textSecondary)),
            ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsetsDirectional.only(end: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(text,
          style: const TextStyle(fontFamily: 'Cairo', fontSize: 12)),
    );
  }
}

/// جسم التبويبات — خمس قوائم مستقلة (TabBarView).
class _MovementTabs extends StatelessWidget {
  const _MovementTabs({required this.report});

  final Map<String, dynamic> report;

  static List<Map<String, dynamic>> _rows(
    Map<String, dynamic> report,
    String key,
  ) {
    final list = report[key];
    if (list is! List) return const [];
    return list
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    return TabBarView(
      children: [
        _MovementList(
          emptyMessage: 'لا توجد سلف في هذه الفترة',
          rows: _rows(report, 'advances'),
          tile: (row) => _MovementTile(
            icon: Icons.currency_exchange,
            color: AppColors.warning,
            title: money(num.tryParse('${row['amount']}') ?? 0),
            subtitle: 'التاريخ: ${date(row['date'])}'
                '${_settledSuffix(row)}',
          ),
        ),
        _MovementList(
          emptyMessage: 'لا توجد سندات قبض في هذه الفترة',
          rows: _rows(report, 'receipts'),
          tile: (row) => _MovementTile(
            icon: Icons.receipt_long,
            color: AppColors.success,
            title: money(num.tryParse('${row['amount']}') ?? 0),
            subtitle:
                'التاريخ: ${date(row['date'])} — ${row['code'] ?? ''}',
          ),
        ),
        _MovementList(
          emptyMessage: 'لا يوجد حضور مسجل في هذه الفترة',
          rows: _rows(report, 'attendance'),
          tile: (row) => _MovementTile(
            icon:
                row['isPresent'] == true ? Icons.check_circle : Icons.cancel,
            color: row['isPresent'] == true
                ? AppColors.success
                : AppColors.error,
            title: row['isPresent'] == true ? 'حضور' : 'غياب',
            subtitle: 'التاريخ: ${date(row['date'])}',
          ),
        ),
        _MovementList(
          emptyMessage: 'لا يوجد إنتاج مسجل في هذه الفترة',
          rows: _rows(report, 'productions'),
          tile: (row) => _MovementTile(
            icon: Icons.checkroom,
            color: AppColors.secondary,
            title: '${num.tryParse('${row['piecesCount']}') ?? 0} قطعة',
            subtitle: 'التاريخ: ${date(row['date'])}',
          ),
        ),
        _MovementList(
          emptyMessage: 'لا توجد كشوف رواتب في هذه الفترة',
          rows: _rows(report, 'payrolls'),
          tile: (row) => _MovementTile(
            icon: Icons.payments,
            color: AppColors.primary,
            title: 'صافي ${money(num.tryParse('${row['netAmount']}') ?? 0)}',
            subtitle: 'الفترة: ${date(row['periodStart'])} — '
                '${date(row['periodEnd'])} (${_statusOf(row)})',
          ),
        ),
      ],
    );
  }

  static String _statusOf(Map<String, dynamic> row) {
    if (row['isPaid'] == true) return 'مدفوع';
    switch (row['status']?.toString() ?? '') {
      case 'APPROVED':
        return 'معتمد — بانتظار الدفع';
      case 'PAID':
        return 'مدفوع';
      default:
        return 'مسودة';
    }
  }

  static String _settledSuffix(Map<String, dynamic> row) {
    final value = row['settledAmount'];
    if (value == null) return '';
    final settled = num.tryParse('$value');
    if (settled == null || settled == 0) return '';
    return ' (مسوّاة: $settled)';
  }
}

class _MovementList extends StatelessWidget {
  const _MovementList({
    required this.rows,
    required this.tile,
    required this.emptyMessage,
  });

  final List<Map<String, dynamic>> rows;
  final Widget Function(Map<String, dynamic>) tile;
  final String emptyMessage;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 60),
          Center(
            child: Text(emptyMessage,
                style: const TextStyle(
                    fontFamily: 'Cairo', color: AppColors.textSecondary)),
          ),
        ],
      );
    }
    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      itemCount: rows.length,
      itemBuilder: (context, index) => tile(rows[index]),
    );
  }
}

class _MovementTile extends StatelessWidget {
  const _MovementTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.15),
          child: Icon(icon, color: color),
        ),
        title: Text(title,
            style: const TextStyle(
                fontFamily: 'Cairo', fontWeight: FontWeight.w600)),
        subtitle: Text(subtitle,
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 12)),
      ),
    );
  }
}

/// زر تصدير PDF (AppBar) — يظهر عند التحميل فقط.
class _PdfAction extends StatelessWidget {
  const _PdfAction();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<WorkerReportCubit, WorkerReportState>(
      builder: (context, state) {
        if (state is! WorkerReportLoaded) return const SizedBox.shrink();
        return IconButton(
          tooltip: 'تصدير PDF',
          icon: const Icon(Icons.picture_as_pdf),
          onPressed: () async {
            try {
              final path = await WorkerReportPdfService.instance
                  .shareWorkerReportPdf(
                context: context,
                report: state.report,
                from: state.from,
                to: state.to,
              );
              if (path == null && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('تعذر توليد ملف PDF')),
                );
              }
            } catch (_) {
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('تعذر تصدير التقرير')),
                );
              }
            }
          },
        );
      },
    );
  }
}
