import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/financial_reports/presentation/cubit/financial_reports_cubit.dart';

/// FinancialReportsCubit — عقود استجابات وحدة التقارير المالية:
///  - fetchIncomeStatement: {revenues, expenses, totalRevenues,
///    totalExpenses, netIncome} — الحسابات كلها من الخادم.
///  - fetchVatReport: {outputVat, inputVat, netVat, vatableSales, ...}.
///  - fetchAging: {buckets, unallocated, customers|suppliers, total}.
///  - أقسام مستقلة: خطأ قسم لا يمس الأقسام الأخرى.
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  const Map<String, dynamic> incomeStatement = {
    'from': '2026-09-01T00:00:00.000Z',
    'to': '2026-09-30T23:59:59.000Z',
    'revenues': [
      {'accountId': 'acc-4000', 'code': '4000', 'name': 'إيرادات المبيعات', 'amount': 2000},
      {'accountId': 'acc-4100', 'code': '4100', 'name': 'إيرادات أخرى', 'amount': 300},
    ],
    'expenses': [
      {'accountId': 'acc-5000', 'code': '5000', 'name': 'مصروف الرواتب', 'amount': 500},
    ],
    'totalRevenues': 2300,
    'totalExpenses': 500,
    'netIncome': 1800,
  };

  const Map<String, dynamic> balanceSheet = {
    'asOf': '2026-09-30T23:59:59.000Z',
    'assets': [
      {'accountId': 'acc-1000', 'code': '1000', 'name': 'الخزينة', 'amount': 5000},
    ],
    'liabilities': [
      {'accountId': 'acc-2000', 'code': '2000', 'name': 'ذمم الموردين', 'amount': 1500},
    ],
    'equity': [
      {'accountId': 'acc-3000', 'code': '3000', 'name': 'رأس المال', 'amount': 2000},
    ],
    'retainedEarnings': 1500,
    'totalAssets': 5000,
    'totalLiabilities': 1500,
    'totalEquity': 3500,
    'netIncome': 1500,
    'checkAssetsEqualLiabilitiesEquity': true,
    'difference': 0,
  };

  const Map<String, dynamic> vatReport = {
    'from': '2026-09-01T00:00:00.000Z',
    'to': '2026-09-30T23:59:59.000Z',
    'outputVat': 700,
    'inputVat': 200,
    'netVat': 500,
    'vatableSales': 5000,
    'vatablePurchases': 0,
    'salesOrders': {'count': 3, 'total': 5700},
    'details': [
      {
        'accountId': 'acc-2300',
        'code': '2300',
        'name': 'ضريبة القيمة المضافة المستحقة',
        'role': 'output',
        'debit': 0,
        'credit': 700,
        'net': 700,
      },
    ],
  };

  const Map<String, dynamic> agingReport = {
    'type': 'AR',
    'asOf': '2026-09-30T00:00:00.000Z',
    'buckets': {'0-30': 1000, '31-60': 500, '61-90': 300, '90+': 200},
    'unallocated': 100,
    'customers': [
      {
        'id': 'customer-1',
        'name': 'مصنع النور',
        'balance': 1200,
        'oldestOpenDate': '2026-09-05T00:00:00.000Z',
        'bucket': '0-30',
      },
      {
        'id': 'customer-2',
        'name': 'شركة الفجر',
        'balance': 900,
        'oldestOpenDate': '2026-05-01T00:00:00.000Z',
        'bucket': '90+',
      },
    ],
    'total': 2100,
  };

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/financial-reports/income-statement' => incomeStatement,
        '/financial-reports/balance-sheet' => balanceSheet,
        '/financial-reports/vat' => vatReport,
        '/financial-reports/aging' => agingReport,
        _ => throw StateError('طلب غير متوقع: ${options.path}'),
      };

  Dio stubDio({
    List<RequestOptions>? requests,
    Object? Function(RequestOptions)? respondWith,
    DioException? Function(RequestOptions)? rejectWith,
  }) {
    final instance = Dio(BaseOptions(baseUrl: 'https://erp.test'));
    instance.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests?.add(options);
          final rejection = rejectWith?.call(options);
          if (rejection != null) {
            handler.reject(rejection, true);
            return;
          }
          handler.resolve(
            Response<Object>(
              requestOptions: options,
              statusCode: 200,
              data: (respondWith ?? respondFor).call(options),
            ),
          );
        },
      ),
    );
    return instance;
  }

  group('fetchIncomeStatement — قائمة الدخل', () {
    test('النجاح: المجاميع والصفوف من الخادم كما هي', () async {
      final requests = <RequestOptions>[];
      final cubit = FinancialReportsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchIncomeStatement(from: '2026-09-01', to: '2026-09-30');

      final state = cubit.state;
      expect(state, isA<FinancialReportsLoaded>());
      final loaded = state as FinancialReportsLoaded;
      final report = loaded.incomeStatement!;
      // المجاميع من الخادم — الشاشة عرض صرف.
      expect(report['totalRevenues'], 2300);
      expect(report['totalExpenses'], 500);
      expect(report['netIncome'], 1800);
      // اتساق حساب الخادم: الصافي = مجموع صفوف الإيرادات − المصروفات.
      final revenues = report['revenues'] as List;
      final expenses = report['expenses'] as List;
      expect(revenues.length, 2);
      expect(expenses.length, 1);
      num rowsSum = 0;
      for (final row in revenues) {
        rowsSum += (row as Map)['amount'] as num;
      }
      for (final row in expenses) {
        rowsSum -= (row as Map)['amount'] as num;
      }
      expect(report['netIncome'], rowsSum);

      expect(requests.single.path, '/financial-reports/income-statement');
      expect(requests.single.queryParameters['from'], '2026-09-01');
      expect(requests.single.queryParameters['to'], '2026-09-30');
    });

    test('الميزانية: الأقسام وفحص التوازن', () async {
      final cubit = FinancialReportsCubit(dio: stubDio());
      addTearDown(cubit.close);

      await cubit.fetchBalanceSheet(asOf: '2026-09-30');

      final loaded = cubit.state as FinancialReportsLoaded;
      final report = loaded.balanceSheet!;
      expect(report['totalAssets'], 5000);
      expect(report['totalLiabilities'], 1500);
      expect(report['totalEquity'], 3500);
      expect(report['checkAssetsEqualLiabilitiesEquity'], isTrue);
      expect(report['difference'], 0);
      // حقوق الملكية تشمل الأرباح المحتجزة (رأس المال + صافي الربح).
      expect(
        report['totalEquity'],
        (report['retainedEarnings'] as num) + 2000,
      );
    });
  });

  group('fetchVatReport — ضريبة القيمة المضافة', () {
    test('النجاح: المخرجات والمدخلات والصافي من الخادم', () async {
      final requests = <RequestOptions>[];
      final cubit = FinancialReportsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchVatReport(from: '2026-09-01', to: '2026-09-30');

      final loaded = cubit.state as FinancialReportsLoaded;
      final report = loaded.vatReport!;
      expect(report['outputVat'], 700);
      expect(report['inputVat'], 200);
      expect(report['netVat'], 500);
      // الصافي = المخرجات − المدخلات (معادلة الخادم).
      expect(report['netVat'], (report['outputVat'] as num) - (report['inputVat'] as num));
      expect(report['vatableSales'], 5000);
      final salesOrders = report['salesOrders'] as Map;
      expect(salesOrders['count'], 3);

      expect(requests.single.path, '/financial-reports/vat');
      expect(requests.single.queryParameters['from'], '2026-09-01');
    });
  });

  group('fetchAging — أعمار الذمم', () {
    test('النجاح: الدلاء والصفوف بمعامل AR الافتراضي', () async {
      final requests = <RequestOptions>[];
      final cubit = FinancialReportsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchAging(asOf: '2026-09-30');

      final loaded = cubit.state as FinancialReportsLoaded;
      final report = loaded.agingReport!;
      final buckets = report['buckets'] as Map;
      expect(buckets['0-30'], 1000);
      expect(buckets['31-60'], 500);
      expect(buckets['61-90'], 300);
      expect(buckets['90+'], 200);
      expect(report['unallocated'], 100);
      // مجموع الدلاء + غير المخصص = الإجمالي (اتساق الخادم).
      final bucketsSum = buckets.values.fold<num>(0, (s, v) => s + (v as num));
      expect(report['total'], bucketsSum + (report['unallocated'] as num));
      final customers = report['customers'] as List;
      expect(customers.length, 2);
      expect(customers.first['bucket'], '0-30');
      expect(loaded.agingType, 'AR');

      expect(requests.single.path, '/financial-reports/aging');
      expect(requests.single.queryParameters['type'], 'AR');
      expect(requests.single.queryParameters['asOf'], '2026-09-30');
    });

    test('تبديل AP: يُرسل نوع الذمم للخادم', () async {
      final requests = <RequestOptions>[];
      final cubit = FinancialReportsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchAging(type: 'AP', asOf: '2026-09-30');

      expect(requests.single.queryParameters['type'], 'AP');
      expect((cubit.state as FinancialReportsLoaded).agingType, 'AP');
    });
  });

  group('استقلال الأقسام — خطأ قسم لا يسقط البقية', () {
    test('خطأ قائمة الدخل: القسم يسجل الخطأ والميزانية صالحة', () async {
      final cubit = FinancialReportsCubit(
        dio: stubDio(
          rejectWith: (options) =>
              options.path == '/financial-reports/income-statement'
                  ? DioException(
                      requestOptions: options,
                      type: DioExceptionType.badResponse,
                      response: Response<Object>(
                        requestOptions: options,
                        statusCode: 403,
                        data: {'message': 'ليس لديك صلاحية'},
                      ),
                    )
                  : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetchBalanceSheet(asOf: '2026-09-30');
      await cubit.fetchIncomeStatement(from: '2026-09-01', to: '2026-09-30');

      final loaded = cubit.state as FinancialReportsLoaded;
      expect(loaded.balanceSheet, isNotNull);
      expect(loaded.incomeStatement, isNull);
      expect(loaded.sectionErrors[kIncomeSection], contains('صلاحية'));
      expect(loaded.sectionErrors[kBalanceSheetSection], isNull);
      expect(loaded.loadingSections, isEmpty);
    });
  });
}
