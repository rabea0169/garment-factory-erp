import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حالات شاشة التقارير المالية (SELIM-ERP W1) — تقارير مستقلة الأقسام:
/// كل تبويب يُحمّل ويُخفق وحده دون إسقاط بقية التبويبات.
abstract class FinancialReportsState {}

class FinancialReportsInitial extends FinancialReportsState {}

class FinancialReportsLoading extends FinancialReportsState {}

class FinancialReportsLoaded extends FinancialReportsState {
  /// قائمة الدخل: {revenues[], expenses[], totalRevenues, totalExpenses,
  /// netIncome, from, to}.
  final Map<String, dynamic>? incomeStatement;

  /// الميزانية العمومية: {assets[], liabilities[], equity[],
  /// retainedEarnings, totalAssets, totalLiabilities, totalEquity,
  /// checkAssetsEqualLiabilitiesEquity, difference, asOf}.
  final Map<String, dynamic>? balanceSheet;

  /// تقرير VAT: {outputVat, inputVat, netVat, vatableSales, vatablePurchases,
  /// salesOrders, details[]}.
  final Map<String, dynamic>? vatReport;

  /// أعمار الذمم: {type, buckets{'0-30','31-60','61-90','90+'},
  /// unallocated, customers|suppliers[], total, asOf}.
  final Map<String, dynamic>? agingReport;

  /// رسائل خطأ لكل قسم على حدة — القسم المعني يعرضها ويبقى الباقي صالحًا.
  final Map<String, String> sectionErrors;

  /// الأقسام قيد التحميل الآن (سبينر داخل التبويب المعني فقط).
  final Set<String> loadingSections;

  /// نوع الذمم المعروض: AR (عملاء) أو AP (موردون).
  final String agingType;

  FinancialReportsLoaded({
    this.incomeStatement,
    this.balanceSheet,
    this.vatReport,
    this.agingReport,
    this.sectionErrors = const {},
    this.loadingSections = const {},
    this.agingType = 'AR',
  });
}

class FinancialReportsError extends FinancialReportsState {
  final String message;
  FinancialReportsError(this.message);
}

/// مفاتيح الأقسام الأربعة — تُستخدم في العرض والاختبار.
const String kIncomeSection = 'income';
const String kBalanceSheetSection = 'balance-sheet';
const String kVatSection = 'vat';
const String kAgingSection = 'aging';

/// Cubit التقارير المالية — يستدعي وحدة /financial-reports الخادمية
/// المقلدة من Selim ERP: قائمة الدخل، الميزانية العمومية، VAT، أعمار
/// الذمم. كل الحسابات تجري على الخادم من دفتر القيود — التطبيق يعرض
/// الاستجابة كما هي (مبدأ "الخادم مصدر الحقيقة الحسابية").
class FinancialReportsCubit extends Cubit<FinancialReportsState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  FinancialReportsCubit({Dio? dio})
      : _injectedDio = dio,
        super(FinancialReportsInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  // أقسام مستقلة: كل تقرير يُخزَّن كما جاء من الخادم، وخطأ قسم لا يمس
  // الأقسام الأخرى (نفس فلسفة الأقسام الكسولة في شاشة الحسابات).
  Map<String, dynamic>? _income;
  Map<String, dynamic>? _balanceSheet;
  Map<String, dynamic>? _vat;
  Map<String, dynamic>? _aging;
  String _agingType = 'AR';
  final Map<String, String> _sectionErrors = {};
  final Set<String> _loading = {};

  /// قائمة الدخل لفترة (from/to بصيغة ISO؛ عند غيابهما يفترض الخادم
  /// الشهر الحالي).
  Future<void> fetchIncomeStatement({String? from, String? to}) async {
    await _loadSection(
      kIncomeSection,
      () => _dio.get(
        '/financial-reports/income-statement',
        queryParameters: {
          if (from != null && from.isNotEmpty) 'from': from,
          if (to != null && to.isNotEmpty) 'to': to,
        },
      ),
      (map) => _income = map,
    );
  }

  /// الميزانية العمومية لحظة asOf (عند غيابه يفترض الخادم الآن).
  Future<void> fetchBalanceSheet({String? asOf}) async {
    await _loadSection(
      kBalanceSheetSection,
      () => _dio.get(
        '/financial-reports/balance-sheet',
        queryParameters: {
          if (asOf != null && asOf.isNotEmpty) 'asOf': asOf,
        },
      ),
      (map) => _balanceSheet = map,
    );
  }

  /// تقرير VAT لفترة.
  Future<void> fetchVatReport({String? from, String? to}) async {
    await _loadSection(
      kVatSection,
      () => _dio.get(
        '/financial-reports/vat',
        queryParameters: {
          if (from != null && from.isNotEmpty) 'from': from,
          if (to != null && to.isNotEmpty) 'to': to,
        },
      ),
      (map) => _vat = map,
    );
  }

  /// أعمار الذمم — AR (عملاء) أو AP (موردون) لحظة asOf.
  Future<void> fetchAging({String? type, String? asOf}) async {
    final requested = type == 'AP' ? 'AP' : (type == 'AR' ? 'AR' : null);
    if (requested != null) _agingType = requested;
    await _loadSection(
      kAgingSection,
      () => _dio.get(
        '/financial-reports/aging',
        queryParameters: {
          'type': _agingType,
          if (asOf != null && asOf.isNotEmpty) 'asOf': asOf,
        },
      ),
      (map) => _aging = map,
    );
  }

  /// منطق تحميل قسم موحد: شغّل التحميل → خزّن الاستجابة أو خطأ القسم —
  /// ثم أعد إصدار الحالة المحمّلة الكاملة بقسم محدث واحد.
  Future<void> _loadSection(
    String key,
    Future<Response<dynamic>> Function() request,
    void Function(Map<String, dynamic> map) assign,
  ) async {
    _loading.add(key);
    _sectionErrors.remove(key);
    if (state is! FinancialReportsLoaded) emit(FinancialReportsLoading());
    _emitLoaded();
    try {
      final response = await request();
      assign(ApiParsing.map(response.data, context: 'تقرير مالي'));
      _loading.remove(key);
      _emitLoaded();
    } catch (error) {
      _loading.remove(key);
      _sectionErrors[key] = _message(error);
      _emitLoaded();
    }
  }

  void _emitLoaded() {
    emit(FinancialReportsLoaded(
      incomeStatement: _income,
      balanceSheet: _balanceSheet,
      vatReport: _vat,
      agingReport: _aging,
      sectionErrors: Map.unmodifiable(_sectionErrors),
      loadingSections: Set.unmodifiable(_loading),
      agingType: _agingType,
    ));
  }

  String _message(Object error) => ApiClient.instance.messageFor(error);
}
