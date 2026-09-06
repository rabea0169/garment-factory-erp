import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../../core/network/api_client.dart';
import 'payrolls_state.dart';

/// MOB-8: مرشح حالة كشوف الرواتب (PayrollStatus في الخادم: DRAFT/
/// APPROVED/PAID + الكل). القيمة الخام تُرسل كما هي في query string.
enum PayrollStatusFilter {
  all('الكل', null),
  draft('مسودة', 'DRAFT'),
  approved('معتمد', 'APPROVED'),
  paid('مدفوع', 'PAID');

  const PayrollStatusFilter(this.label, this.queryValue);

  /// التسمية العربية للشريحة في الواجهة.
  final String label;

  /// قيمة status للخادم — null يعني بلا مرشح.
  final String? queryValue;
}

/// MOB-8: كشوف الرواتب — يستهلك GET /hr/payrolls?status=&workerId=&page=&limit=
/// ويعيد { items: [...], total, page, limit } (لاحظ: المفتاح items لا data).
class PayrollsCubit extends Cubit<PayrollsState> {
  PayrollsCubit({Dio? dio})
      : _injectedDio = dio,
        super(const PayrollsInitial(filter: PayrollStatusFilter.all));

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  PayrollStatusFilter _filter = PayrollStatusFilter.all;
  PayrollStatusFilter get filter => _filter;

  /// يجلب الكشوف بالمرشح الحالي (يُستخدم أيضًا للتحديث بالسحب).
  Future<void> fetchPayrolls({bool refreshing = false}) async {
    if (refreshing && state is PayrollsLoaded) {
      emit(PayrollsLoaded(
        payrolls: (state as PayrollsLoaded).payrolls,
        filter: _filter,
        isRefreshing: true,
      ));
    } else {
      emit(PayrollsLoading(filter: _filter));
    }
    try {
      final response = await _dio.get<dynamic>(
        '/hr/payrolls',
        queryParameters: <String, dynamic>{
          if (_filter.queryValue != null) 'status': _filter.queryValue,
          'page': 1,
          'limit': 50,
        },
      );
      final payrolls = _parseItems(response.data);
      emit(
        payrolls.isEmpty
            ? PayrollsEmpty(filter: _filter)
            : PayrollsLoaded(payrolls: payrolls, filter: _filter),
      );
    } catch (error) {
      emit(PayrollsError(
        message: ApiClient.instance.messageFor(error),
        filter: _filter,
      ));
    }
  }

  /// يضبط المرشح ويعيد الجلب.
  Future<void> setFilter(PayrollStatusFilter filter) async {
    if (filter == _filter) return;
    _filter = filter;
    await fetchPayrolls();
  }

  /// يستخرج قائمة الكشوف من عقد pagination المعلن للموارد البشرية
  /// ({ items: [...], total, page, limit }).
  static List<Map<String, dynamic>> _parseItems(Object? payload) {
    if (payload is! Map) {
      throw const FormatException('استجابة كشوف الرواتب غير صالحة');
    }
    final items = payload['items'];
    if (items is! List) {
      throw const FormatException('قائمة كشوف الرواتب غير صالحة');
    }
    return items
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }
}
