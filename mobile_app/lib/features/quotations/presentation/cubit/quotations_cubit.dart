import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حالات شاشة عروض الأسعار (SELIM-ERP W1).
abstract class QuotationsState {}

class QuotationsInitial extends QuotationsState {}

class QuotationsLoading extends QuotationsState {}

class QuotationsLoaded extends QuotationsState {
  final List<Map<String, dynamic>> quotations;
  final Map<String, dynamic> stats;

  QuotationsLoaded(this.quotations, {this.stats = const {}});
}

class QuotationsError extends QuotationsState {
  final String message;
  QuotationsError(this.message);
}

/// Cubit عروض الأسعار — يستدعي وحدة /quotations الخادمية المقلدة من Selim.
class QuotationsCubit extends Cubit<QuotationsState> {
  QuotationsCubit() : super(QuotationsInitial());

  String _statusFilter = '';
  String _search = '';

  /// جلب العروض + الإحصائيات (شرائح الحالة بعداداتها).
  Future<void> fetch({String? status, String? search}) async {
    if (status != null) _statusFilter = status;
    if (search != null) _search = search;
    emit(QuotationsLoading());
    try {
      final dio = ApiClient.instance.dio;
      final params = <String, dynamic>{'limit': 100};
      if (_statusFilter.isNotEmpty && _statusFilter != 'ALL') {
        params['status'] = _statusFilter;
      }
      if (_search.trim().isNotEmpty) params['search'] = _search.trim();
      // الإحصائيات تفشل بصمت — الشاشة تعمل حتى بلا صلاحية /stats.
      final listResponse = await dio.get('/quotations', queryParameters: params);
      Map<String, dynamic> stats = const {};
      try {
        final statsResponse = await dio.get('/quotations/stats');
        if (statsResponse.data is Map<String, dynamic>) {
          stats = statsResponse.data as Map<String, dynamic>;
        }
      } catch (_) {}
      emit(
        QuotationsLoaded(
          ApiParsing.paginatedMaps(listResponse.data, context: 'عروض الأسعار'),
          stats: stats,
        ),
      );
    } catch (error) {
      emit(QuotationsError(ApiClient.instance.messageFor(error)));
    }
  }

  /// انتقال حالة: إرسال / قبول / رفض.
  Future<bool> updateStatus(String id, String action) async {
    try {
      await ApiClient.instance.dio
          .patch('/quotations/$id/status', data: {'action': action});
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// تحويل عرض مقبول إلى أمر بيع.
  Future<bool> convert(String id, {String paymentType = 'CASH'}) async {
    try {
      await ApiClient.instance.dio.post(
        '/quotations/$id/convert',
        data: {'paymentType': paymentType},
      );
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// حذف عرض مسودة.
  Future<bool> delete(String id) async {
    try {
      await ApiClient.instance.dio.delete('/quotations/$id');
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// إنشاء عرض جديد من خريطة JSON جاهزة (يبنيها نموذج الإدخال).
  Future<Map<String, dynamic>?> create(Map<String, dynamic> data) async {
    final response = await ApiClient.instance.dio.post(
      '/quotations',
      data: data,
    );
    await fetch();
    return (response.data is Map<String, dynamic>)
        ? response.data as Map<String, dynamic>
        : null;
  }
}
