import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import 'reports_state.dart';

class ReportsCubit extends Cubit<ReportsState> {
  ReportsCubit({ApiClient? apiClient})
      : _apiClient = apiClient ?? ApiClient.instance,
        super(ReportsInitial());

  final ApiClient _apiClient;

  Future<void> fetchDashboardStats() async {
    emit(ReportsLoading());
    try {
      final response = await _apiClient.dio.get('/dashboard/stats');
      final data = response.data;
      if (data is! Map) {
        emit(const ReportsError('استجابة التقارير من الخادم غير صالحة'));
        return;
      }

      final report = Map<String, dynamic>.from(data);
      const requiredLists = <String>['sales', 'production', 'topWorkers'];
      final hasValidShape = requiredLists.every(
        (key) => report[key] is List<dynamic>,
      );
      if (!hasValidShape) {
        emit(const ReportsError('بيانات التقارير غير مكتملة أو غير متوافقة'));
        return;
      }

      emit(ReportsLoaded(report));
    } catch (error) {
      // لا نعرض بيانات وهمية؛ غياب التقرير الحقيقي يجب أن يظهر كخطأ قابل للتشخيص.
      emit(ReportsError(_apiClient.messageFor(error)));
    }
  }
}
