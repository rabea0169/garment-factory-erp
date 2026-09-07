import '../../domain/entities/work_order.dart';
import '../../domain/failures/production_failure.dart' as failures;

sealed class ProductionState {
  const ProductionState();
}

final class ProductionInitial extends ProductionState {
  const ProductionInitial();
}

final class ProductionLoading extends ProductionState {
  const ProductionLoading();
}

final class ProductionLoaded extends ProductionState {
  const ProductionLoaded({
    required this.workOrders,
    this.isRefreshing = false,
    this.fromCache = false,
    this.cachedAt,
  });

  final List<WorkOrder> workOrders;
  final bool isRefreshing;

  /// MOB-3: هل القائمة من ذاكرة Hive (لا اتصال) لا من الشبكة مباشرة؟
  final bool fromCache;

  /// لحظة تخزين آخر حالة ناجحة — null عند الاتصال المباشر.
  final DateTime? cachedAt;
}

/// DEV-PQ1/2: فشل عملية كتابة (إنشاء أمر/استهلاك خامات) — لا يمسح القائمة
/// المعروضة خلف الحوار: ترث [ProductionLoaded] فيبقى عرض الأوامر كما هو،
/// وتحمل الفشل ليقرأه الحوار ويعرض رسالته داخل الحوار نفسه (نفس نهج
/// UAT-FIX في QualityCubit: خطأ الكتابة لا يهدم حالة القراءة).
final class ProductionWriteFailure extends ProductionLoaded {
  const ProductionWriteFailure({
    required super.workOrders,
    required this.failure,
  });

  final failures.ProductionFailure failure;
}

final class ProductionEmpty extends ProductionState {
  const ProductionEmpty();
}

final class ProductionUnauthorized extends ProductionState {
  const ProductionUnauthorized();
}

final class ProductionOffline extends ProductionState {
  const ProductionOffline();
}

final class ProductionFailure extends ProductionState {
  const ProductionFailure(this.failure);

  final failures.ProductionFailure failure;
}
