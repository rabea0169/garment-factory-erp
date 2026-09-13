import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حالات شاشة الورديات (SELIM-ERP W1).
abstract class ShiftsState {}

class ShiftsInitial extends ShiftsState {}

class ShiftsLoading extends ShiftsState {}

class ShiftsLoaded extends ShiftsState {
  /// قائمة الورديات (صفحة واحدة حتى 100 وردية — عقد limit الأقصى).
  final List<Map<String, dynamic>> shifts;

  /// وردية المستخدم الحالية المفتوحة — أو null (شاشة الـ POS تسألها دائمًا).
  final Map<String, dynamic>? currentShift;

  /// إجمالي الورديات داخل المرشح الحالي (total من الاستجابة).
  final int total;

  /// عدّاد الورديات المفتوحة الآن في كل المستخدمين (لوحة الإشراف).
  final int openCount;

  ShiftsLoaded(
    this.shifts, {
    this.currentShift,
    this.total = 0,
    this.openCount = 0,
  });
}

class ShiftsError extends ShiftsState {
  final String message;
  ShiftsError(this.message);
}

/// Cubit الورديات — يستدعي وحدة /shifts الخادمية المقلدة من Selim ERP.
///
/// الوردية مستند رقابة نقدية للـ POS: فتح برصيد افتتاحي → إغلاق برصيد
/// فعلي يُقارن بالمتوقع (الافتتاحي + المبيعات النقدية) فيُحسب الفرق —
/// كل الحسابات على الخادم داخل معاملة الإغلاق (قاعدة مجال مشتركة).
class ShiftsCubit extends Cubit<ShiftsState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  ShiftsCubit({Dio? dio})
      : _injectedDio = dio,
        super(ShiftsInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  String _statusFilter = '';

  /// آخر خطأ إجراء (فتح/إغلاق) — تقرأه الشاشة عند فشل العملية ليعرضه
  /// للمستخدم برسالة الخادم الدقيقة (تعارض الوردية المفتوحة مثلًا).
  String? lastActionError;

  /// جلب قائمة الورديات + وردية المستخدم الحالية المفتوحة.
  ///
  /// فشل /shifts/current صامت (null) — قائمة الورديات تبقى صالحة حتى لو
  /// لم يكن للمستخدم وردية أصلًا؛ فشل القائمة نفسها يُسقط الشاشة للخطأ.
  Future<void> fetch({String? status}) async {
    if (status != null) _statusFilter = status;
    emit(ShiftsLoading());
    try {
      Map<String, dynamic>? current;
      try {
        final currentResponse = await _dio.get('/shifts/current');
        if (currentResponse.data is Map) {
          current = Map<String, dynamic>.from(currentResponse.data as Map);
        }
      } catch (_) {}
      final params = <String, dynamic>{'limit': 100};
      if (_statusFilter.isNotEmpty && _statusFilter != 'ALL') {
        params['status'] = _statusFilter;
      }
      final response = await _dio.get('/shifts', queryParameters: params);
      final payload = response.data is Map
          ? Map<String, dynamic>.from(response.data as Map)
          : const <String, dynamic>{};
      emit(
        ShiftsLoaded(
          _rowsOf(response.data, 'الورديات'),
          currentShift: current,
          total: _intOf(payload['total']),
          openCount: _intOf(payload['openCount']),
        ),
      );
    } catch (error) {
      emit(ShiftsError(_message(error)));
    }
  }

  /// فتح وردية جديدة — يرفض الخادم وجود وردية مفتوحة للمستخدم (409).
  Future<bool> open({double? startCash, String? notes}) async {
    lastActionError = null;
    try {
      await _dio.post('/shifts/open', data: {
        if (startCash != null) 'startCash': startCash,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      });
      await fetch();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// إغلاق وردية — المتوقع والفرق يُحسبان على الخادم، والإغلاق نفسه
  /// شرط ذري (updateMany WHERE status=OPEN) يمنع الإغلاق المزدوج.
  /// (سمّيناها closeShift لا close كي لا تتصادم مع Cubit.close.)
  Future<bool> closeShift(String id,
      {required double endCash, String? notes}) async {
    lastActionError = null;
    try {
      await _dio.post('/shifts/$id/close', data: {
        'endCash': endCash,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      });
      await fetch();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// تفاصيل وردية واحدة (GET /shifts/:id) — يستخدمها حوار الإغلاق لقراءة
  /// الافتتاحي والمتوقع المرتقب. الفشل يُعاد null فيبقى الحوار عمليًا.
  Future<Map<String, dynamic>?> loadShift(String id) async {
    try {
      final response = await _dio.get('/shifts/$id');
      if (response.data is Map) {
        return Map<String, dynamic>.from(response.data as Map);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// استخراج صفوف القائمة — وحدات Selim تعيد {items, ...} بينما تعيد
  /// الوحدات الأقدم {data, meta}؛ نقبل الشكلين لصيانة أسهل.
  List<Map<String, dynamic>> _rowsOf(dynamic payload, String context) {
    final rows = payload is Map ? (payload['items'] ?? payload['data']) : payload;
    return ApiParsing.mapList(rows, context: context);
  }

  int _intOf(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  String _message(Object error) => ApiClient.instance.messageFor(error);
}
