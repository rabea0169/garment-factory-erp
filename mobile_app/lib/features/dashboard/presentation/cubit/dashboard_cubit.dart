import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'dashboard_state.dart';

/// Cubit لجلب مؤشرات لوحة التحكم من الـ backend.
///
/// يستدعي `GET /dashboard/stats` (DashboardController على main) ويتحقق من شكل
/// الاستجابة قبل عرضها. لا توجد أي بيانات hardcoded — كل KPIs والرسوم تأتي
/// من الـ API. عند الفشل نُرجع رسالة عربية مفهومة عبر `messageFor`.
class DashboardCubit extends Cubit<DashboardState> {
  DashboardCubit({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient.instance,
        super(const DashboardInitial());

  final ApiClient _apiClient;

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
        emit(const DashboardError('بيانات لوحة التحكم غير مكتملة أو غير متوافقة'));
        return;
      }

      // حالة "فارغ": لا مبيعات ولا إنتاج ولا عمال ولا مخزون في الفترة.
      final sales = List<dynamic>.from(stats['sales'] as List);
      final production = List<dynamic>.from(stats['production'] as List);
      final topWorkers = List<dynamic>.from(stats['topWorkers'] as List);
      final inventory = Map<String, dynamic>.from(stats['inventory'] as Map);
      final totalMaterials = (inventory['totalMaterials'] as num?)?.toInt() ?? 0;
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
      emit(DashboardLoaded(stats));
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
