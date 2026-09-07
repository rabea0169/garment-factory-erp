import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:dio/dio.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/services/cache_service.dart';
import 'dashboard_state.dart';

/// Cubit لجلب مؤشرات لوحة التحكم من الـ backend.
///
/// يستدعي `GET /dashboard/stats` (DashboardController على main) ويتحقق من شكل
/// الاستجابة قبل عرضها. لا توجد أي بيانات hardcoded — كل KPIs والرسوم تأتي
/// من الـ API. عند الفشل نُرجع رسالة عربية مفهومة عبر `messageFor`.
///
/// MOB-3: كل نجاح شبكة يُخزن write-through في ذاكرة Hive؛ عند انقطاع
/// الاتصال تُعرض آخر حالة ناجحة مع شارة "بيانات مخزنة" (DashboardLoaded
/// مع fromCache=true) بدل خطأ عام.
class DashboardCubit extends Cubit<DashboardState> {
  DashboardCubit({ApiClient? apiClient, CacheService? cache})
      : _apiClient = apiClient ?? ApiClient.instance,
        _cache = cache ?? CacheService.instance,
        super(const DashboardInitial());

  final ApiClient _apiClient;
  final CacheService _cache;

  static const String _statsCacheKey = 'dashboard_stats';

  Future<void> fetchStats() async {
    emit(const DashboardLoading());
    try {
      final response = await _apiClient.dio.get('/dashboard/stats');
      final data = response.data;
      if (data is! Map) {
        emit(const DashboardError('استجابة لوحة التحكم من الخادم غير صالحة'));
        return;
      }
      final stats = Map<String, dynamic>.from(data);
      final valid = _isSeries(stats['sales'], 'period', 'amount') &&
          _isSeries(stats['production'], 'period', 'pieces') &&
          _isSeries(stats['topWorkers'], 'name', 'pieces') &&
          _isInventory(stats['inventory']);
      if (!valid) {
        emit(const DashboardError(
            'بيانات لوحة التحكم غير مكتملة أو غير متوافقة'));
        return;
      }

      // حالة "فارغ": لا مبيعات ولا إنتاج ولا عمال ولا مخزون في الفترة.
      final sales = List<dynamic>.from(stats['sales'] as List);
      final production = List<dynamic>.from(stats['production'] as List);
      final topWorkers = List<dynamic>.from(stats['topWorkers'] as List);
      final inventory = Map<String, dynamic>.from(stats['inventory'] as Map);
      final totalMaterials =
          (inventory['totalMaterials'] as num?)?.toInt() ?? 0;
      final lowStock = (inventory['lowStockMaterials'] as num?)?.toInt() ?? 0;
      final finishedGoods =
          (inventory['totalFinishedGoodsTypes'] as num?)?.toInt() ?? 0;
      final isEmpty = sales.isEmpty &&
          production.isEmpty &&
          topWorkers.isEmpty &&
          totalMaterials == 0 &&
          lowStock == 0 &&
          finishedGoods == 0;
      if (isEmpty) {
        emit(const DashboardEmpty());
        return;
      }
      // MOB-3: آخر حالة ناجحة تُخزن فورًا لتُستخدم عند فقد الاتصال.
      await _cache.writeThrough(_statsCacheKey, stats);
      emit(DashboardLoaded(stats));
    } on DioException catch (error) {
      // DSH-1: 403 = الدور غير مصرح له بالمؤشرات (5 من 8 أدوار خادميًا) —
      // حالة محترمة بشاشة ترحيب تفاعلية، ليست خطأً يفسد الهبوط.
      if (error.response?.statusCode == 403) {
        emit(const DashboardForbidden());
        return;
      }
      // MOB-3: انقطاع الشبكة → آخر حالة ناجحة من الكاش مع شارة، وإلا
      // خطأ الشبكة المعتاد.
      if (ApiClient.isNetworkError(error)) {
        final snapshot = await _cache.read(_statsCacheKey);
        final cached = snapshot?.data;
        if (cached is Map) {
          final stats = Map<String, dynamic>.from(cached);
          if (_isSeries(stats['sales'], 'period', 'amount') &&
              _isSeries(stats['production'], 'period', 'pieces') &&
              _isSeries(stats['topWorkers'], 'name', 'pieces') &&
              _isInventory(stats['inventory'])) {
            emit(DashboardLoaded(
              stats,
              fromCache: true,
              cachedAt: snapshot!.cachedAt,
            ));
            return;
          }
        }
      }
      emit(DashboardError(_apiClient.messageFor(error)));
    } catch (error) {
      emit(DashboardError(_apiClient.messageFor(error)));
    }
  }

  bool _isSeries(dynamic value, String labelKey, String numberKey) {
    if (value is! List) return false;
    return value.every((item) {
      if (item is! Map) return false;
      final label = item[labelKey];
      final number = item[numberKey];
      return label is String && label.isNotEmpty && number is num;
    });
  }

  bool _isInventory(dynamic value) {
    if (value is! Map) return false;
    const keys = <String>[
      'totalMaterials',
      'lowStockMaterials',
      'totalFinishedGoodsTypes',
    ];
    return keys.every((key) => value[key] is num);
  }
}
