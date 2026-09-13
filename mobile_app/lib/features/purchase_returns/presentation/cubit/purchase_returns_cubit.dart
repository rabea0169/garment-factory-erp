import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import '../../../../core/widgets/selim/format.dart';

/// حالات شاشة مرتجعات المشتريات (SELIM-ERP W1).
abstract class PurchaseReturnsState {}

class PurchaseReturnsInitial extends PurchaseReturnsState {}

class PurchaseReturnsLoading extends PurchaseReturnsState {}

/// القائمة المحمّلة + الإحصائيات المحسوبة (المجاميع وشارات الفلترة).
class PurchaseReturnsLoaded extends PurchaseReturnsState {
  final List<Map<String, dynamic>> returns;
  final Map<String, dynamic> stats;

  PurchaseReturnsLoaded(this.returns, {this.stats = const {}});
}

class PurchaseReturnsError extends PurchaseReturnsState {
  final String message;
  PurchaseReturnsError(this.message);
}

/// Cubit مرتجعات المشتريات — يستدعي وحدة /purchase-returns الخادمية
/// (SELIM-B1) المقلدة من Selim ERP.
///
/// عقد الخادم:
/// - GET /purchase-returns?search&from&to&supplierId&page&limit →
///   {items, total, page, limit, pages} — بلا مفتاح data (عقد CC-6 الجديد
///   للوحدات المالية) بينما الوحدات القديمة ترجع {data, meta}؛ المُستخرِج
///   الموحد أدناه يقبل الشكلين.
/// - لا مرشح refundMethod خادميًا (استعلام search/from/to/supplierId فقط)
///   — فلترة طريقة الاسترداد تجري على العميل من نفس الحمولة.
/// - DELETE /purchase-returns/:id يعكس القيد ويستعيد المخزون خادميًا.
class PurchaseReturnsCubit extends Cubit<PurchaseReturnsState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  PurchaseReturnsCubit({Dio? dio})
      : _injectedDio = dio,
        super(PurchaseReturnsInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// سقف limit المقبول خادميًا (الحد الأقصى 100).
  static const int _listLimit = 100;

  String _search = '';
  String _refundMethod = 'ALL';

  /// جلب المرتجعات + الإحصائيات (بحث برقم المرتجع/اسم المورد، وفلترة
  /// طريقة الاسترداد client-side لأن الخادم لا يدعمها كمرشح استعلام).
  Future<void> fetch({String? search, String? refundMethod}) async {
    if (search != null) _search = search;
    if (refundMethod != null) _refundMethod = refundMethod;
    emit(PurchaseReturnsLoading());
    try {
      final params = <String, dynamic>{'limit': _listLimit};
      if (_search.trim().isNotEmpty) params['search'] = _search.trim();
      final response =
          await _dio.get('/purchase-returns', queryParameters: params);
      final payload = response.data;
      final allItems = _pageItems(payload);
      // فلترة طريقة الاسترداد على العميل — طريقة الاسترداد لقطة على المستند.
      final visible = _refundMethod == 'ALL'
          ? allItems
          : allItems
              .where((item) => _methodOf(item) == _refundMethod)
              .toList(growable: false);
      emit(PurchaseReturnsLoaded(visible, stats: _statsFor(payload, allItems)));
    } catch (error) {
      emit(PurchaseReturnsError(ApiClient.instance.messageFor(error)));
    }
  }

  /// حذف مرتجع — الخادم يعكس القيد ويستعيد المخزون داخل معاملة واحدة.
  Future<bool> delete(String id) async {
    try {
      await _dio.delete('/purchase-returns/$id');
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// إنشاء مرتجع من خريطة JSON جاهزة (يبنيها نموذج الإدخال) — الخطأ يُعاد
  /// رفعه ليعرض النموذج رسالة الخادم عبر messageFor.
  Future<Map<String, dynamic>?> create(Map<String, dynamic> data) async {
    final response = await _dio.post('/purchase-returns', data: data);
    await fetch();
    return (response.data is Map<String, dynamic>)
        ? response.data as Map<String, dynamic>
        : null;
  }

  /// طريقة الاسترداد الفعلية للمستند (الافتراضي دائن كما في الخادم).
  String _methodOf(Map<String, dynamic> item) =>
      item['refundMethod']?.toString() ?? 'credit';

  /// استخراج صفحات القائمة بالتوافق مع عقدي الترقيم: {items, ...} للوحدات
  /// المالية الجديدة و{data, meta} للوحدات القديمة.
  List<Map<String, dynamic>> _pageItems(Object? payload) {
    if (payload is Map && payload['items'] is List) {
      return ApiParsing.mapList(payload['items'], context: 'مرتجعات المشتريات');
    }
    return ApiParsing.paginatedMaps(payload, context: 'مرتجعات المشتريات');
  }

  /// إحصائيات البطاقة والشرائح من الحمولة الكاملة (قبل فلترة العميل):
  /// الإجمالي وقيمة المرتجعات وعدد كل طريقة استرداد.
  Map<String, dynamic> _statsFor(
    Object? payload,
    List<Map<String, dynamic>> items,
  ) {
    final total =
        payload is Map ? asNum(payload['total']).toInt() : items.length;
    final totalValue = items.fold<double>(
      0,
      (sum, item) => sum + asNum(item['total']).toDouble(),
    );
    final today = DateTime.now();
    final todayCount = items
        .where((item) => _sameDay(item['date'] ?? item['createdAt'], today))
        .length;
    return {
      'total': total,
      'totalValue': totalValue,
      'creditCount': items.where((item) => _methodOf(item) != 'cash').length,
      'cashCount': items.where((item) => _methodOf(item) == 'cash').length,
      'todayCount': todayCount,
    };
  }

  /// هل التاريخ داخل اليوم المطلوب؟ (للمؤشر اليومي في البطاقة).
  bool _sameDay(Object? value, DateTime day) {
    if (value == null) return false;
    final dt = value is DateTime ? value : DateTime.tryParse(value.toString());
    return dt != null &&
        dt.year == day.year &&
        dt.month == day.month &&
        dt.day == day.day;
  }
}
