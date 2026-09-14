/// SELIM-ERP W5 — حالات تقرير العامل المجمّع (نقل WorkerReportModal من
/// المرجع جواليًا): تحميل/محمل/خطأ. التقرير كامل الخريطة كما يرد من
/// GET /hr/workers/:id/report — التحليل في العرض لا في الحالة.
sealed class WorkerReportState {
  const WorkerReportState();
}

final class WorkerReportInitial extends WorkerReportState {
  const WorkerReportInitial();
}

final class WorkerReportLoading extends WorkerReportState {
  const WorkerReportLoading();
}

final class WorkerReportLoaded extends WorkerReportState {
  const WorkerReportLoaded({
    required this.report,
    required this.from,
    required this.to,
  });

  /// جسم التقرير: { worker, range, summary, advances, receipts,
  /// attendance, productions, payrolls } — كما يرد من الخادم.
  final Map<String, dynamic> report;

  /// نطاق الفترة المطلوب (YYYY-MM-DD) — للترويسة وإعادة الجلب.
  final DateTime from;
  final DateTime to;
}

final class WorkerReportError extends WorkerReportState {
  const WorkerReportError(this.message);

  final String message;
}
