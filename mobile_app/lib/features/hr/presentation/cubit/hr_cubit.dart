import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import 'hr_state.dart';

class HrCubit extends Cubit<HrState> {
  HrCubit({Uuid? uuid})
      : _uuid = uuid ?? const Uuid(),
        super(HrInitial());

  final Uuid _uuid;

  Future<void> fetchWorkers() async {
    emit(HrLoading());
    try {
      final dio = ApiClient.instance.dio;
      final response = await dio.get('/hr/workers');
      emit(HrLoaded(ApiParsing.paginatedMaps(
        response.data,
        context: 'العمال',
      )));
    } catch (error) {
      emit(HrError(ApiClient.instance.messageFor(error)));
    }
  }

  /// MOBILE-F07 fix: إضافة Idempotency-Key + معالجة موحّدة للأخطاء عبر
  /// messageFor. رسالة النجاح تظهر فقط بعد نجاح فعلي للـ await.
  Future<void> createWorker({
    required String name,
    String? phone,
    String? nationalId,
    required String specialty,
    double? pieceRate,
    DateTime? hireDate,
  }) async {
    try {
      final dio = ApiClient.instance.dio;
      await dio.post(
        '/hr/workers',
        data: {
          'name': name,
          if (phone != null && phone.isNotEmpty) 'phone': phone,
          if (nationalId != null && nationalId.isNotEmpty)
            'nationalId': nationalId,
          'specialty': specialty,
          if (pieceRate != null) 'pieceRate': pieceRate,
          if (hireDate != null) 'hireDate': hireDate.toIso8601String(),
        },
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchWorkers();
    } catch (error) {
      emit(HrError(ApiClient.instance.messageFor(error)));
      rethrow;
    }
  }

  /// MOBILE-F07 fix: Idempotency-Key يمنع تسجيل الإنتاج مرتين عند
  /// إعادة الإرسال بسبب ضعف الشبكة. messageFor يعطي رسالة موحّدة.
  Future<void> recordProduction({
    required String workerId,
    required int piecesCount,
  }) async {
    try {
      final dio = ApiClient.instance.dio;
      await dio.post(
        '/hr/production',
        data: {
          'workerId': workerId,
          'piecesCount': piecesCount,
          'date': DateTime.now().toIso8601String(),
        },
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchWorkers();
    } catch (error) {
      emit(HrError(ApiClient.instance.messageFor(error)));
      rethrow;
    }
  }
}
