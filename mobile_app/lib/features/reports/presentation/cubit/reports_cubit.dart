import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import 'reports_state.dart';

/// MOBILE-F04 (Flutter side): يستدعي نفس endpoint `/dashboard/stats` الذي
/// يوفّره backend DashboardController. الـ endpoint أصبح حقيقيًا الآن ولن
/// يرجع 404 بعد الآن؛ ومع ذلك، نُحوّل 404 (أو أي خطأ آخر) إلى رسالة عربية
/// ودودة عبر [ApiClient.messageFor] (يحتوي الآن على حالة 404 صريحة).
///
/// ملاحظة دفاعية: نحن متسامحون مع غياب بعض المفاتيح في الاستجابة — أي مفتاح
/// مفقود يُعامل كقائمة فارغة بدلاً من رفض الاستجابة بالكامل. هذا يحمي الشاشة
/// من الانكسار عند تغيّر طفيف في شكل الـ API.
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
      // نأخذ قيمًا افتراضية فارغة عند غياب أي مفتاح — الشاشة تعرض empty state.
      final sales = _asList(report['sales']);
      final production = _asList(report['production']);
      final topWorkers = _asList(report['topWorkers']);

      final allEmpty =
          sales.isEmpty && production.isEmpty && topWorkers.isEmpty;
      if (allEmpty) {
        // نُمرر تقريرًا فارغًا فعليًا بدلاً من اعتباره خطأ — الـ UI سيعرض empty.
        emit(const ReportsLoaded(<String, dynamic>{}));
        return;
      }

      emit(ReportsLoaded({
        'sales': sales,
        'production': production,
        'topWorkers': topWorkers,
      }));
    } catch (error) {
      // MOBILE-F04: 404 (لو الغوا الـ endpoint) أو أي خطأ آخر → رسالة عربية.
      emit(ReportsError(_apiClient.messageFor(error)));
    }
  }

  List<dynamic> _asList(Object? value) {
    if (value is List) return value;
    return const <dynamic>[];
  }
}
