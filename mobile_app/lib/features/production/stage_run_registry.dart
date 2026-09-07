import '../../core/services/cache_service.dart';

/// DEV-PQ3: سجل مرحلات التشغيل المحلي المشترك بين الإنتاج والجودة.
///
/// لا يوجد مسار خادمي لجلب stageRuns لأمر تشغيل (GET /production/work-orders/:id
/// غير موجود في ProductionController)، بينما استجابتا stage-transitions و
/// stage-output تعيدان `stageRunId`. لذلك يحفظ التطبيق معرفات التشغيلات
/// المحلية (best-effort عبر [CacheService]) ليستخدمها:
/// - حوار استهلاك الخامات (يحتاج تشغيل المرحلة الجارية)،
/// - حوار تسجيل فحص الجودة (يحتاج تشغيل مرحلة مكتملة)،
/// بدل إدخال UUID يدويًا.
///
/// المفتاح: '$workOrderId|STAGE' (مثل 'wo-1|CUTTING') → stageRunId.
const String stageRunRegistryCacheKey = 'production_stage_run_ids';

/// مفتاح صف السجل لأمر/مرحلة — stageApiValue إحدى قيم ProductionStage
/// الخادمية: CUTTING/SEWING/IRONING/PACKING.
String stageRunRegistryKey(String workOrderId, String stageApiValue) =>
    '$workOrderId|$stageApiValue';

/// يقرأ السجل كاملًا — خريطة فارغة عند الغياب/التعطل (الكاش أفضل-جهد).
Future<Map<String, String>> readStageRunRegistry(CacheService cache) async {
  try {
    final snapshot = await cache.read(stageRunRegistryCacheKey);
    final data = snapshot?.data;
    if (data is! Map) return <String, String>{};
    return {
      for (final entry in data.entries)
        if (entry.value is String) entry.key.toString(): entry.value as String,
    };
  } catch (_) {
    return <String, String>{};
  }
}

/// يضيف/يحدّث تشغيل مرحلة في السجل — فشل الكتابة (Hive غير مهيأ كما في
/// بعض الاختبارات) يُبتلع بصمت ولا يُفشل العملية الأصلية الناجحة.
Future<void> rememberStageRun(
  CacheService cache, {
  required String workOrderId,
  required String stageApiValue,
  required String stageRunId,
}) async {
  if (stageRunId.isEmpty) return;
  final registry = await readStageRunRegistry(cache);
  registry[stageRunRegistryKey(workOrderId, stageApiValue)] = stageRunId;
  await cache.writeThrough(stageRunRegistryCacheKey, registry);
}

/// يعيد معرف تشغيل المرحلة المحفوظ أو null إن لم يُسجّل من هذا الجهاز بعد.
Future<String?> lookupStageRunId(
  CacheService cache, {
  required String workOrderId,
  required String stageApiValue,
}) async {
  final registry = await readStageRunRegistry(cache);
  final value = registry[stageRunRegistryKey(workOrderId, stageApiValue)];
  return value != null && value.isNotEmpty ? value : null;
}
