import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'reports_state.dart';

class ReportsCubit extends Cubit<ReportsState> {
  ReportsCubit() : super(ReportsInitial());

  Future<void> fetchDashboardStats() async {
    emit(ReportsLoading());
    try {
      // Assuming a generic dashboard endpoint we will create or have
      final response = await ApiClient.instance.dio.get('/dashboard/stats');
      emit(ReportsLoaded(response.data));
    } catch (e) {
      // Mock Data if backend doesn't have it yet to show the UI
      final mockData = {
        'sales': [12000, 15000, 10000, 22000, 18000, 25000],
        'production': [500, 600, 450, 700, 800, 750],
        'topWorkers': [
          {'name': 'أحمد محمد', 'pieces': 450},
          {'name': 'سعيد علي', 'pieces': 390},
          {'name': 'محمود سيد', 'pieces': 310},
        ]
      };
      emit(ReportsLoaded(mockData));
    }
  }
}
