import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'reports_state.dart';

class ReportsCubit extends Cubit<ReportsState> {
  ReportsCubit({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient.instance,
        super(const ReportsInitial());

  final ApiClient _apiClient;

  Future<void> fetchDashboardStats() async {
    emit(const ReportsLoading());
    try {
      final response = await _apiClient.dio.get('/dashboard/stats');
      final data = response.data;
      if (data is! Map) {
        emit(const ReportsError('استجابة التقارير من الخادم غير صالحة'));
        return;
      }

      final report = Map<String, dynamic>.from(data);
      final valid = _isSeries(report['sales'], 'period', 'amount') &&
          _isSeries(report['production'], 'period', 'pieces') &&
          _isSeries(report['topWorkers'], 'name', 'pieces') &&
          _isInventory(report['inventory']);
      if (!valid) {
        emit(const ReportsError('بيانات التقارير غير مكتملة أو غير متوافقة'));
        return;
      }

      // حالة "فارغ": لا مبيعات ولا إنتاج ولا عمال ولا مخزون في الفترة.
      final sales = List<dynamic>.from(report['sales'] as List);
      final production = List<dynamic>.from(report['production'] as List);
      final topWorkers = List<dynamic>.from(report['topWorkers'] as List);
      final inventory = Map<String, dynamic>.from(report['inventory'] as Map);
      final totalMaterials =
          (inventory['totalMaterials'] as num?)?.toInt() ?? 0;
      final lowStock =
          (inventory['lowStockMaterials'] as num?)?.toInt() ?? 0;
      final finishedGoods =
          (inventory['totalFinishedGoodsTypes'] as num?)?.toInt() ?? 0;
      final isEmpty = sales.isEmpty &&
          production.isEmpty &&
          topWorkers.isEmpty &&
          totalMaterials == 0 &&
          lowStock == 0 &&
          finishedGoods == 0;
      if (isEmpty) {
        emit(const ReportsEmpty());
        return;
      }

      emit(ReportsLoaded(report));
    } catch (error) {
      // لا نعرض بيانات وهمية؛ غياب التقرير الحقيقي يجب أن يظهر كخطأ قابل للتشخيص.
      emit(ReportsError(_apiClient.messageFor(error)));
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
