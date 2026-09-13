import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حالات شاشة مركز الطباعة (SELIM-ERP W1).
abstract class PrintingState {}

class PrintingInitial extends PrintingState {}

class PrintingLoading extends PrintingState {}

/// الحالة المحمّلة — تبويبان في شاشة واحدة: القوالب وسجل الطباعة.
class PrintingLoaded extends PrintingState {
  /// قوالب الطباعة داخل مرشح نوع المستند (صفحة الخادم الأولى).
  final List<Map<String, dynamic>> templates;

  /// إجمالي القوالب داخل المرشح (total من الاستجابة).
  final int templatesTotal;

  /// سجل الطباعة (تدقيق) داخل المرشح — حتى 100 سجلًا.
  final List<Map<String, dynamic>> logEntries;

  /// إجمالي سجلات الطباعة داخل المرشح.
  final int logTotal;

  PrintingLoaded(
    this.templates, {
    this.templatesTotal = 0,
    this.logEntries = const [],
    this.logTotal = 0,
  });
}

class PrintingError extends PrintingState {
  final String message;
  PrintingError(this.message);
}

/// Cubit الطباعة — يستدعي وحدة /printing الخادمية المقلدة من Selim ERP:
/// قوالب الطباعة (بيانات لا كود — config JSON) + سجل الطباعة (تدقيق
/// بلقطات اسم المستخدم والقالب لحظة الطباعة).
///
/// ثابت Selim: قالب افتراضي واحد لكل (مستند × حجم ورق) — تعيين
/// الافتراضية يزيلها عن بقية قوالب الزوج داخل معاملة الخادم.
class PrintingCubit extends Cubit<PrintingState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  PrintingCubit({Dio? dio})
      : _injectedDio = dio,
        super(PrintingInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  String _documentTypeFilter = '';

  // مخازن التبويبين تُحفظ في الكيوبت فلا يمسح أحدهما الآخر عند التحديث.
  List<Map<String, dynamic>> _templates = const [];
  int _templatesTotal = 0;
  List<Map<String, dynamic>> _logEntries = const [];
  int _logTotal = 0;

  /// آخر خطأ إجراء (تعيين افتراضي/حذف/إنشاء) — تقرأه الشاشة عند فشل
  /// العملية ليعرض رسالة الخادم الدقيقة.
  String? lastActionError;

  /// جلب القوالب بمرشح نوع المستند (الكل = بلا مرشح). الخادم يرقّم
  /// بصفحات 20 ثابتة — لا يرسل التطبيق limit هنا (عقد الوحدة).
  Future<void> fetchTemplates({String? documentType}) async {
    if (documentType != null) _documentTypeFilter = documentType;
    emit(PrintingLoading());
    try {
      final params = <String, dynamic>{};
      if (_documentTypeFilter.isNotEmpty && _documentTypeFilter != 'ALL') {
        params['documentType'] = _documentTypeFilter;
      }
      final response = await _dio.get('/printing/templates', queryParameters: params);
      final payload = response.data is Map
          ? Map<String, dynamic>.from(response.data as Map)
          : const <String, dynamic>{};
      _templates = _rowsOf(response.data, 'قوالب الطباعة');
      _templatesTotal = _intOf(payload['total']);
      _emitLoaded();
    } catch (error) {
      emit(PrintingError(_message(error)));
    }
  }

  /// جلب سجل الطباعة (تدقيق) بمرشح نوع المستند.
  Future<void> fetchLog({String? documentType}) async {
    try {
      final params = <String, dynamic>{'limit': 100};
      if (documentType != null && documentType.isNotEmpty && documentType != 'ALL') {
        params['documentType'] = documentType;
      }
      final response = await _dio.get('/printing/log', queryParameters: params);
      final payload = response.data is Map
          ? Map<String, dynamic>.from(response.data as Map)
          : const <String, dynamic>{};
      _logEntries = _rowsOf(response.data, 'سجل الطباعة');
      _logTotal = _intOf(payload['total']);
      _emitLoaded();
    } catch (_) {
      // سجل الطباعة تدقيق جانبي — فشله صامت (قائمة فارغة + إعادة محاولة
      // بالسحب للتحديث). لا يُسقط تبويب القوالب.
    }
  }

  /// بذرة idempotent للقوالب العربية الافتراضية (كل مستند × ورق ناقص).
  /// يعيد عدد القوالب التي أُنشئت فعلًا هذه المرة (0 عند التكرار)، أو
  /// null عند الفشل — تقرأه الشاشة لرسالة النجاح/الخطأ.
  Future<int?> seed() async {
    lastActionError = null;
    try {
      final response = await _dio.post('/printing/templates/seed');
      final payload = response.data;
      if (payload is Map) {
        final created = payload['created'];
        if (created is num) return created.toInt();
        return int.tryParse(created?.toString() ?? '') ?? 0;
      }
      return 0;
    } catch (error) {
      lastActionError = _message(error);
      return null;
    }
  }

  /// إنشاء قالب — الافتراضي الواحد لكل زوج يُفرض خادميًا.
  Future<bool> createTemplate({
    required String name,
    required String documentType,
    required String paperSize,
    bool? isDefault,
    Map<String, dynamic>? config,
  }) async {
    lastActionError = null;
    try {
      await _dio.post('/printing/templates', data: {
        'name': name,
        'documentType': documentType,
        'paperSize': paperSize,
        if (isDefault != null) 'isDefault': isDefault,
        if (config != null) 'config': config,
      });
      await fetchTemplates();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// تعيين قالب افتراضيًا لزوجه — يزيل الافتراضية عن غيره خادميًا.
  Future<bool> setDefault(String id) async {
    lastActionError = null;
    try {
      await _dio.patch('/printing/templates/$id', data: {'isDefault': true});
      await fetchTemplates();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// حذف ناعم لقالب (isActive=false) — السجل التاريخي يظل مقروءًا.
  Future<bool> deleteTemplate(String id) async {
    lastActionError = null;
    try {
      await _dio.delete('/printing/templates/$id');
      await fetchTemplates();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  void _emitLoaded() {
    // لا نُصدر حالة محمّلة فوق خطأ القوالب قبل أول نجاح.
    if (state is PrintingError && _templates.isEmpty) return;
    emit(PrintingLoaded(
      _templates,
      templatesTotal: _templatesTotal,
      logEntries: _logEntries,
      logTotal: _logTotal,
    ));
  }

  /// استخراج صفوف القائمة — وحدات Selim تعيد {items, ...}.
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
