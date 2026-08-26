import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../../core/network/api_client.dart';
import 'dashboard_state.dart';

/// MOBILE-F03 (Flutter side): cubit حقيقي يستدعي GET /dashboard/stats
/// الذي يوفّره backend/src/modules/dashboard/*.
///
/// لا تستخدم بيانات hardcoded — كل رقم يُعرض في الـ UI يجب أن يأتي من
/// `state.stats.*`. غياب البيانات يظهر كحالة error أو empty عربيًا.
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
      final stats = DashboardStats.fromJson(
        Map<String, dynamic>.from(data),
      );
      // حالة empty: لا توجد بيانات حقيقية بعد (مثلاً تثبيت أولي بلا seed)
      final isEmpty = stats.salesToday == 0 &&
          stats.productionToday == 0 &&
          stats.inventoryValue == 0 &&
          stats.pendingWorkOrders == 0 &&
          stats.treasuryBalance == 0 &&
          stats.recentTransactions.isEmpty;
      emit(isEmpty ? const DashboardEmpty() : DashboardLoaded(stats));
    } catch (error) {
      emit(DashboardError(_apiClient.messageFor(error)));
    }
  }

  /// يُرجع تاريخ اليوم منسَّقًا عربيًا عبر intl.DateFormat.yMMMd('ar').
  /// لا يعتمد على بيانات الخادم — التاريخ المحلي للمستخدم هو الأنسب للعرض.
  String get todayArabicDate {
    final now = DateTime.now();
    try {
      return DateFormat.yMMMd('ar').format(now);
    } catch (_) {
      // احتياط لو لم يُحمَّل ICU للعربية — يُرجع تاريخ ISO مقروء.
      return now.toIso8601String().split('T').first;
    }
  }
}
