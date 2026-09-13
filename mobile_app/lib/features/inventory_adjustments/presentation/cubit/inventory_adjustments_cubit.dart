import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import '../../../../core/widgets/selim/format.dart';

/// حالات شاشة تسويات الجرد (SELIM-ERP W1).
abstract class InventoryAdjustmentsState {}

class InventoryAdjustmentsInitial extends InventoryAdjustmentsState {}

class InventoryAdjustmentsLoading extends InventoryAdjustmentsState {}

/// القائمة المحمّلة + عدادات الحالات لشريط الشرائح.
class InventoryAdjustmentsLoaded extends InventoryAdjustmentsState {
  final List<Map<String, dynamic>> adjustments;
  final Map<String, dynamic> stats;

  InventoryAdjustmentsLoaded(this.adjustments, {this.stats = const {}});
}

class InventoryAdjustmentsError extends InventoryAdjustmentsState {
  final String message;
  InventoryAdjustmentsError(this.message);
}

/// Cubit تسويات الجرد — يستدعي وحدة /inventory-adjustments الخادمية
/// (SELIM-B1) المقلدة من Selim ERP.
///
/// عقد الخادم:
/// - GET /inventory-adjustments?status&warehouseId&from&to&page&limit →
///   {items, total, page, limit, pages} (عقد CC-6 بلا مفتاح data).
/// - POST /inventory-adjustments {warehouseId, date?, notes?, items:[...]}
///   — مسودة DRAFT بلا أثر؛ الفروق والقيم تُحسب خادميًا من رصيد النظام.
/// - POST /:id/approve — DRAFT فقط: يطبّق الفروق على المخزون ويرحّل القيود.
/// - POST /:id/reject {reason} — سبب إلزامي.
/// - DELETE /:id — DRAFT فقط.
///
/// عدادات الشرائح تجلب بطلب ثانٍ بلا مرشح (نمط list+stats في عروض
/// الأسعار) لأن الطلب المفلتر يعيد فقط حالة واحدة فتنكسر العدادات.
class InventoryAdjustmentsCubit extends Cubit<InventoryAdjustmentsState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  InventoryAdjustmentsCubit({Dio? dio})
      : _injectedDio = dio,
        super(InventoryAdjustmentsInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// سقف limit المقبول خادميًا (الحد الأقصى 100).
  static const int _listLimit = 100;

  String _statusFilter = 'ALL';
  String _warehouseId = '';

  /// جلب التسويات المفلترة + طلب عدادات غير مفلتر لشرائح الحالة.
  Future<void> fetch({String? status, String? warehouseId}) async {
    if (status != null) _statusFilter = status;
    if (warehouseId != null) _warehouseId = warehouseId;
    emit(InventoryAdjustmentsLoading());
    try {
      final params = <String, dynamic>{'limit': _listLimit};
      if (_statusFilter.isNotEmpty && _statusFilter != 'ALL') {
        params['status'] = _statusFilter;
      }
      if (_warehouseId.trim().isNotEmpty) {
        params['warehouseId'] = _warehouseId.trim();
      }
      final response = await _dio.get(
        '/inventory-adjustments',
        queryParameters: params,
      );
      final items = _pageItems(response.data, 'تسويات الجرد');
      // العدادات بلا مرشح حالة (الطلب المفلتر يعيد حالة واحدة فتنكسر
      // الشرائح) — فشلها صامت: الشاشة تعمل بلا عدادات (نمط quotations).
      Map<String, dynamic> stats = const {};
      try {
        final countsResponse = await _dio.get(
          '/inventory-adjustments',
          queryParameters: {'limit': _listLimit},
        );
        final all =
            _pageItems(countsResponse.data, 'تسويات الجرد (العدادات)');
        stats = _statsFor(countsResponse.data, all);
      } catch (_) {}
      emit(InventoryAdjustmentsLoaded(items, stats: stats));
    } catch (error) {
      emit(InventoryAdjustmentsError(ApiClient.instance.messageFor(error)));
    }
  }

  /// اعتماد مسودة — تطبيق الفروق على أرصدة المخزون وقيود المحاسبة خادميًا.
  Future<bool> approve(String id) async {
    try {
      await _dio.post('/inventory-adjustments/$id/approve');
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// رفض مسودة بسبب إلزامي — بلا أثر مخزوني.
  Future<bool> reject(String id, String reason) async {
    try {
      await _dio.post(
        '/inventory-adjustments/$id/reject',
        data: {'reason': reason},
      );
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// حذف مسودة — DRAFT فقط (لم تُطبق فروقها فلا شيء يُعكس).
  Future<bool> delete(String id) async {
    try {
      await _dio.delete('/inventory-adjustments/$id');
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// إنشاء مسودة تسوية من خريطة JSON جاهزة — الخطأ يُعاد رفعه ليعرضه
  /// النموذج برسالة الخادم (فروق سالبة/كميات غير صحيحة...).
  Future<Map<String, dynamic>?> create(Map<String, dynamic> data) async {
    final response = await _dio.post('/inventory-adjustments', data: data);
    await fetch();
    return (response.data is Map<String, dynamic>)
        ? response.data as Map<String, dynamic>
        : null;
  }

  /// استخراج صفحات القائمة بالتوافق مع عقدي الترقيم {items,...}/{data,...}.
  List<Map<String, dynamic>> _pageItems(Object? payload, String context) {
    if (payload is Map && payload['items'] is List) {
      return ApiParsing.mapList(payload['items'], context: context);
    }
    return ApiParsing.paginatedMaps(payload, context: context);
  }

  /// عدادات الحالات من الحمولة غير المفلترة.
  Map<String, dynamic> _statsFor(
    Object? payload,
    List<Map<String, dynamic>> all,
  ) {
    int countOf(String status) => all
        .where((item) => (item['status']?.toString() ?? '') == status)
        .length;
    final total =
        payload is Map ? asNum(payload['total']).toInt() : all.length;
    return {
      'total': total,
      'draft': countOf('DRAFT'),
      'approved': countOf('APPROVED'),
      'rejected': countOf('REJECTED'),
    };
  }
}
