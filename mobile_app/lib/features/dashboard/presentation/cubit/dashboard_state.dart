// States for DashboardCubit — كلها تأتي من GET /dashboard/stats (DashboardController).
abstract class DashboardState {
  const DashboardState();
}

class DashboardInitial extends DashboardState {
  const DashboardInitial();
}

class DashboardLoading extends DashboardState {
  const DashboardLoading();
}

class DashboardLoaded extends DashboardState {
  const DashboardLoaded(
    this.stats, {
    this.fromCache = false,
    this.cachedAt,
  });

  /// الـ payload الكامل من /dashboard/stats:
  /// { filters, generatedAt, sales[], production[], topWorkers[], inventory, definitions }.
  final Map<String, dynamic> stats;

  /// MOB-3: هل البيانات من ذاكرة Hive (لا اتصال) لا من الشبكة مباشرة؟
  final bool fromCache;

  /// لحظة تخزين آخر حالة ناجحة — null عند الاتصال المباشر.
  final DateTime? cachedAt;
}

class DashboardEmpty extends DashboardState {
  const DashboardEmpty();
}

class DashboardError extends DashboardState {
  const DashboardError(this.message);

  final String message;
}
