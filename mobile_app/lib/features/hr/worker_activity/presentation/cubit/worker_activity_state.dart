/// MOB-8: حالات نشاط العامل — تحميل/محمل/خطأ. القائمتان فارغتان
/// تُعرضان كحالات فراغ لكل تبويب (لا حالة فارغة موحدة تُخفي الأخرى).
sealed class WorkerActivityState {
  const WorkerActivityState();
}

final class WorkerActivityInitial extends WorkerActivityState {
  const WorkerActivityInitial();
}

final class WorkerActivityLoading extends WorkerActivityState {
  const WorkerActivityLoading();
}

final class WorkerActivityLoaded extends WorkerActivityState {
  const WorkerActivityLoaded({
    required this.advances,
    required this.production,
  });

  /// عناصر GET /hr/advances?workerId= —
  /// {id, workerId, amount, settledAmount, date, notes,
  ///  worker: {id, name, code}} (worker متداخل حرفيًا بالعقد).
  final List<Map<String, dynamic>> advances;

  /// عناصر GET /hr/production?workerId= —
  /// {id, workerId, workOrderId, date, piecesCount, pieceRate,
  ///  totalAmount, notes, worker}.
  final List<Map<String, dynamic>> production;
}

final class WorkerActivityError extends WorkerActivityState {
  const WorkerActivityError(this.message);

  final String message;
}
