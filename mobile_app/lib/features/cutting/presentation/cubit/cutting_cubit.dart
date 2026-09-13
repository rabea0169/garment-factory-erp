import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حالات شاشة القص (SELIM-ERP W1).
abstract class CuttingState {}

class CuttingInitial extends CuttingState {}

class CuttingLoading extends CuttingState {}

/// الحالة المحمّلة — تبويبان في شاشة واحدة:
/// أوامر القص (orders) + الإعدادات (الألوان/مجموعات المقاسات).
class CuttingLoaded extends CuttingState {
  /// أوامر القص داخل مرشح الحالة (صفحة واحدة حتى 100 أمر). كل أمر يحمل
  /// بنوده (lines) ولقطات المنتج/العامل/المخزن من عقد القائمة الخادمي.
  final List<Map<String, dynamic>> orders;

  /// إجمالي الأوامر داخل المرشح (total من الاستجابة).
  final int ordersTotal;

  /// الألوان النشطة (تبويب الإعدادات) — {id, name, hex, isActive}.
  final List<Map<String, dynamic>> colors;

  /// مجموعات المقاسات النشطة — {id, name, sizes: [], isActive}.
  final List<Map<String, dynamic>> sizeGroups;

  CuttingLoaded(
    this.orders, {
    this.ordersTotal = 0,
    this.colors = const [],
    this.sizeGroups = const [],
  });

  /// عدد الأوامر في حالة معينة داخل القائمة المحمّلة (عدادات الشرائح).
  int countOf(String status) =>
      orders.where((o) => o['status']?.toString() == status).length;

  /// إجمالي القطع في الأوامر المحمّلة (بطاقة العنوان).
  num get totalPieces => orders.fold(
        0,
        (sum, order) => sum + _numOf(order['totalPieces']),
      );

  /// إجمالي أجر القص في الأوامر المحمّلة.
  num get totalWages =>
      orders.fold(0, (sum, order) => sum + _numOf(order['wageTotal']));

  static num _numOf(Object? value) {
    if (value is num) return value;
    return num.tryParse(value?.toString() ?? '') ?? 0;
  }
}

class CuttingError extends CuttingState {
  final String message;
  CuttingError(this.message);
}

/// Cubit القص — يستدعي وحدة /cutting الخادمية المقلدة من Selim ERP.
///
/// دورة حياة أمر القص: DRAFT → ACTIVE → REVERSED. المسودة تخطيط بلا
/// حركات، والتفعيل يصرف رصيد الموديل المصدر ويُدخل التوليفات (لون×مقاس)
/// وأجر العامل في معاملة واحدة، والعكس يرد كل الحركات من دفتر المخزون.
///
/// ملاحظة عقد: وحدة الخادم لا تقدم DELETE لأوامر القص (الأوامر غير
/// قابلة للحذف — العكس هو مسار التراجع)، فلا يعرض التطبيق حذف أمر.
class CuttingCubit extends Cubit<CuttingState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  CuttingCubit({Dio? dio})
      : _injectedDio = dio,
        super(CuttingInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  String _statusFilter = '';

  // مخازن التبويب الثاني (الإعدادات) تُحفظ في الكيوبت فلا تضيع عند
  // إعادة جلب الأوامر، والعكس صحيح — تبويب واحد لا يمسح الآخر.
  List<Map<String, dynamic>> _colors = const [];
  List<Map<String, dynamic>> _sizeGroups = const [];
  List<Map<String, dynamic>> _orders = const [];
  int _ordersTotal = 0;

  /// آخر خطأ إجراء (تفعيل/عكس/إنشاء/إعدادات) — تقرأه الشاشة عند فشل
  /// العملية ليعرض رسالة الخادم الدقيقة (رصيد المصدر لا يكفي مثلًا).
  String? lastActionError;

  /// جلب أوامر القص بمرشح الحالة (الكل/مسودة/مفعّل/معكوس).
  Future<void> fetchOrders({String? status}) async {
    if (status != null) _statusFilter = status;
    emit(CuttingLoading());
    try {
      final params = <String, dynamic>{'limit': 100};
      if (_statusFilter.isNotEmpty && _statusFilter != 'ALL') {
        params['status'] = _statusFilter;
      }
      final response = await _dio.get('/cutting/orders', queryParameters: params);
      final payload = response.data is Map
          ? Map<String, dynamic>.from(response.data as Map)
          : const <String, dynamic>{};
      _orders = _rowsOf(response.data, 'أوامر القص');
      _ordersTotal = _intOf(payload['total']);
      _emitLoaded();
    } catch (error) {
      emit(CuttingError(_message(error)));
    }
  }

  /// جلب الألوان + مجموعات المقاسات (تبويب الإعدادات) — قائمتان
  /// عاديتان من الخادم (بلا ترقيم صفحات).
  Future<void> fetchSettings() async {
    try {
      final results = await Future.wait([
        _dio.get('/cutting/colors'),
        _dio.get('/cutting/size-groups'),
      ]);
      _colors = ApiParsing.mapList(results[0].data, context: 'الألوان');
      _sizeGroups = ApiParsing.mapList(results[1].data, context: 'مجموعات المقاسات');
      _emitLoaded();
    } catch (error) {
      lastActionError = _message(error);
    }
  }

  /// إنشاء أمر قص مسودة — الكميات والإجماليات تُحسب على الخادم (لا
  /// حركات مخزون قبل التفعيل). [data] جاهزة بعقد CreateCuttingOrderDto.
  Future<bool> createOrder(Map<String, dynamic> data) async {
    lastActionError = null;
    try {
      await _dio.post('/cutting/orders', data: data);
      await fetchOrders();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// تفعيل أمر مسودة — صرف رصيد الموديل المصدر وإدخال التوليفات وأجر
  /// العامل في معاملة واحدة. الخادم يختار تلقائيًا توليفة المصدر صاحبة
  /// أكبر رصيد (sourceVariantId اختياري — نرسله بلا قيمة عمدًا).
  Future<bool> activate(String id, {String? sourceVariantId}) async {
    lastActionError = null;
    try {
      await _dio.post('/cutting/orders/$id/activate', data: {
        if (sourceVariantId != null && sourceVariantId.isNotEmpty)
          'sourceVariantId': sourceVariantId,
      });
      await fetchOrders();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// عكس أمر مفعّل — رد كل الحركات من دفتر المخزون وحذف سجل الأجر.
  Future<bool> reverse(String id) async {
    lastActionError = null;
    try {
      await _dio.post('/cutting/orders/$id/reverse');
      await fetchOrders();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// إنشاء لون — الاسم فريد وhex بصيغة #RRGGBB (يُتحقق في الحوار).
  Future<bool> createColor({required String name, required String hex}) async {
    lastActionError = null;
    try {
      await _dio.post('/cutting/colors', data: {'name': name, 'hex': hex});
      await fetchSettings();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// حذف لون — منطقي (isActive=false): التوليفات القديمة تُبقي مرجعها.
  Future<bool> deleteColor(String id) async {
    lastActionError = null;
    try {
      await _dio.delete('/cutting/colors/$id');
      await fetchSettings();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// إنشاء مجموعة مقاسات — الاسم فريد والمقاسات مرتبة كما أُدخلت.
  Future<bool> createSizeGroup({
    required String name,
    required List<String> sizes,
  }) async {
    lastActionError = null;
    try {
      await _dio.post('/cutting/size-groups', data: {
        'name': name,
        'sizes': sizes,
      });
      await fetchSettings();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// حذف مجموعة مقاسات — منطقي.
  Future<bool> deleteSizeGroup(String id) async {
    lastActionError = null;
    try {
      await _dio.delete('/cutting/size-groups/$id');
      await fetchSettings();
      return true;
    } catch (error) {
      lastActionError = _message(error);
      return false;
    }
  }

  /// المنتجات النشطة لقائمة حوار الإنشاء — تُطلب عند فتح الحوار فقط.
  Future<List<Map<String, dynamic>>> fetchProducts() async {
    final response = await _dio.get(
      '/products',
      queryParameters: {'limit': 100},
    );
    return ApiParsing.paginatedMaps(response.data, context: 'المنتجات');
  }

  /// مخازن المنتج التام لحوار الإنشاء.
  Future<List<Map<String, dynamic>>> fetchWarehouses() async {
    final response = await _dio.get(
      '/inventory/warehouses',
      queryParameters: {'limit': 100},
    );
    return ApiParsing.paginatedMaps(response.data, context: 'المخازن');
  }

  /// عمال القص لحوار الإنشاء (اختياري — يلزم لأجر القطعة).
  Future<List<Map<String, dynamic>>> fetchWorkers() async {
    final response = await _dio.get(
      '/hr/workers',
      queryParameters: {'limit': 100},
    );
    return ApiParsing.paginatedMaps(response.data, context: 'العمال');
  }

  void _emitLoaded() {
    // لا نُصدر حالة محمّلة جديدة فوق خطأ قائمة الأوامر قبل أول نجاح.
    if (state is CuttingError && _orders.isEmpty) return;
    emit(CuttingLoaded(
      _orders,
      ordersTotal: _ordersTotal,
      colors: _colors,
      sizeGroups: _sizeGroups,
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
