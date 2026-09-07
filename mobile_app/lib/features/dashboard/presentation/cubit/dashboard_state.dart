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

/// دور المستخدم لا يملك صلاحية قراءة /dashboard/stats (مقصور خادميًا على
/// GM/SUPER_ADMIN/ACCOUNTANT — DSH-1). ليست خطأً: تُعرض شاشة ترحيب تفاعلية
/// بالتنقل بدل المؤشرات، فيهبط كل دور على شيء مفيد لا على شاشة خطأ.
class DashboardForbidden extends DashboardState {
  const DashboardForbidden();
}

class DashboardError extends DashboardState {
  const DashboardError(this.message);

  final String message;
}
