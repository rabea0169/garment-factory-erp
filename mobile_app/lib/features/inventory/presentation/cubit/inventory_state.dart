// States
abstract class InventoryState {}

class InventoryInitial extends InventoryState {}

class InventoryLoading extends InventoryState {}

class InventorySaving extends InventoryState {}

class InventoryLoaded extends InventoryState {
  final List<dynamic> rawMaterials;
  final List<dynamic> finishedGoods;
  final List<dynamic> lowStockMaterials;
  final List<dynamic> warehouses;

  InventoryLoaded({
    required this.rawMaterials,
    required this.finishedGoods,
    required this.lowStockMaterials,
    this.warehouses = const [],
  });
}

class InventoryError extends InventoryState {
  final String message;
  InventoryError(this.message);
}

// GF-REMAINING-008: حالات تجربة المستخدم المفقودة — offline وانتهاء الجلسة.

/// فشل الاتصال بالشبكة (connectionError/connectionTimeout/sendTimeout/
/// receiveTimeout) — نفس أنواع DioException التي يعدها production feature
/// فشل شبكة (mapProductionFailure). تحمل الحالة آخر قوائم ناجحة إن وُجدت؛
/// الكاش في ذاكرة الـ cubit فقط لأن المشروع لا يستخدم Hive للتخزين المؤقت.
class InventoryOffline extends InventoryState {
  final InventoryLoaded? snapshot;
  InventoryOffline({this.snapshot});
}

/// انتهت الجلسة (401). عميل ApiClient (interceptor في onError) يمسح الجلسة
/// ويطلق onUnauthorized → AppRouter.goToLogin فيعيد التوجيه لشاشة الدخول
/// عالميًا — الـ cubit يصنّف الحالة فقط لتعرض الشاشة رسالة مناسبة.
class InventoryUnauthorized extends InventoryState {}
