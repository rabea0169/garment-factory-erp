import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حالات شاشة حركات الخزينة (SELIM-ERP W1).
abstract class TreasuryState {}

class TreasuryInitial extends TreasuryState {}

class TreasuryLoading extends TreasuryState {}

/// الحركات المحمّلة + ملخص الخزائن (الرصيد الكلي ومجاميع الأنواع وقائمة
/// الخزائن للفلاتر والنماذج).
class TreasuryLoaded extends TreasuryState {
  final List<Map<String, dynamic>> transactions;
  final Map<String, dynamic> stats;

  TreasuryLoaded(this.transactions, {this.stats = const {}});

  /// قائمة الخزائن من الملخص (لحوار الإنشاء وفلتر الخزينة).
  List<Map<String, dynamic>> get treasuries =>
      (stats['treasuries'] as List?)
          ?.whereType<Map>()
          .map((treasury) => Map<String, dynamic>.from(treasury))
          .toList(growable: false) ??
      const [];
}

class TreasuryError extends TreasuryState {
  final String message;
  TreasuryError(this.message);
}

/// Cubit حركات الخزينة — يستدعي وحدة /treasury-transactions الخادمية
/// (SELIM-B1) المقلدة من Selim ERP.
///
/// عقد الخادم:
/// - GET /treasury-transactions?treasuryId&type&from&to&page&limit →
///   {items, total, page, limit, pages} (عقد CC-6 بلا مفتاح data).
/// - GET /treasury-transactions/summary → {treasuries:[{id,name,type,
///   currencyId,isActive,balance}], totalActiveBalance, byType:{
///   DEPOSIT:{count,totalAmount}, WITHDRAWAL:{...}, TRANSFER:{...}}} —
///   ملخص محاسبي (أرصدة كل الخزائن) — فشله (403 لكاشير مثلًا) صامت
///   والشاشة تعمل من الحركات نفسها.
/// - POST /treasury-transactions {treasuryId, toTreasuryId?, type:
///   'DEPOSIT'|'WITHDRAWAL'|'TRANSFER', amount, date?, description,
///   category?, notes?} — أرصدة وقيد داخل معاملة واحدة وترقيم TRT-0001.
/// - DELETE /treasury-transactions/:id — للحركات اليدوية فقط (بلا
///   referenceId) ويعكس القيد ويعيد الأرصدة.
class TreasuryCubit extends Cubit<TreasuryState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  TreasuryCubit({Dio? dio})
      : _injectedDio = dio,
        super(TreasuryInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// سقف limit المقبول خادميًا (الحد الأقصى 100).
  static const int _listLimit = 100;

  String _typeFilter = 'ALL';
  String _treasuryId = '';

  /// جلب الحركات المفلترة (نوع/خزينة) + ملخص الخزائن.
  Future<void> fetch({String? type, String? treasuryId}) async {
    if (type != null) _typeFilter = type;
    if (treasuryId != null) _treasuryId = treasuryId;
    emit(TreasuryLoading());
    try {
      final params = <String, dynamic>{'limit': _listLimit};
      if (_typeFilter.isNotEmpty && _typeFilter != 'ALL') {
        params['type'] = _typeFilter;
      }
      if (_treasuryId.trim().isNotEmpty) {
        params['treasuryId'] = _treasuryId.trim();
      }
      final response =
          await _dio.get('/treasury-transactions', queryParameters: params);
      final transactions = _pageItems(response.data);

      // الملخص المحاسبي — فشله صامت (نمط stats في عروض الأسعار).
      Map<String, dynamic> stats = const {};
      try {
        final summaryResponse = await _dio.get('/treasury-transactions/summary');
        if (summaryResponse.data is Map<String, dynamic>) {
          stats = summaryResponse.data as Map<String, dynamic>;
        }
      } catch (_) {}
      emit(TreasuryLoaded(transactions, stats: stats));
    } catch (error) {
      emit(TreasuryError(ApiClient.instance.messageFor(error)));
    }
  }

  /// حذف حركة يدوية (بلا مرجع مستند) — عكس القيد وإعادة الأرصدة خادميًا.
  Future<bool> delete(String id) async {
    try {
      await _dio.delete('/treasury-transactions/$id');
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// إنشاء حركة من خريطة JSON جاهزة (يبنيها حوار الإدخال) — الخطأ يُعاد
  /// رفعه ليعرض الحوار رسالة الخادم (رصيد غير كافٍ / عملات مختلفة...).
  Future<Map<String, dynamic>?> create(Map<String, dynamic> data) async {
    final response = await _dio.post('/treasury-transactions', data: data);
    await fetch();
    return (response.data is Map<String, dynamic>)
        ? response.data as Map<String, dynamic>
        : null;
  }

  /// استخراج صفحات القائمة بالتوافق مع عقدي الترقيم {items,...}/{data,...}.
  List<Map<String, dynamic>> _pageItems(Object? payload) {
    if (payload is Map && payload['items'] is List) {
      return ApiParsing.mapList(payload['items'], context: 'حركات الخزينة');
    }
    return ApiParsing.paginatedMaps(payload, context: 'حركات الخزينة');
  }
}
