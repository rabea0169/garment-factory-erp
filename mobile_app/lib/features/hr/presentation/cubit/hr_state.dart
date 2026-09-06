abstract class HrState {
  const HrState();
}

class HrInitial extends HrState {}

class HrLoading extends HrState {}

class HrLoaded extends HrState {
  HrLoaded(this.workers, {this.fromCache = false, this.cachedAt});

  final List<dynamic> workers;

  /// MOB-3: هل القائمة من ذاكرة Hive (لا اتصال) لا من الشبكة مباشرة؟
  /// تحدده الواجهة لعرض شارة "بيانات مخزنة".
  final bool fromCache;

  /// لحظة تخزين آخر حالة ناجحة (تُعرض مع الشارة) — null عند الاتصال.
  final DateTime? cachedAt;
}

/// MOB-3: لا اتصال ولا كاش مخزن بعد — شاشة "لا يوجد اتصال" صريحة.
class HrOffline extends HrState {
  const HrOffline();
}

class HrError extends HrState {
  HrError(this.message);
  final String message;
}
