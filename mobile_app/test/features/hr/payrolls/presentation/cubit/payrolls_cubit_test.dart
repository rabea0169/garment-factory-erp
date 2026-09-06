import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/hr/payrolls/presentation/cubit/payrolls_cubit.dart';
import 'package:garment_factory_erp/features/hr/payrolls/presentation/cubit/payrolls_state.dart';

/// MOB-8: PayrollsCubit — يستهلك GET /hr/payrolls بعقد الاستجابة الحرفي
/// { items: [...], total, page, limit } مع مرشح الحالة:
/// تحميل/نجاح/فراغ/خطأ، تمرير المرشح في query string، والتحديث بالسحب.
/// Dio وهمي عبر اعتراض (بلا شبكة).
void main() {
  Map<String, dynamic> payrollItem(String id, String status) =>
      <String, dynamic>{
        'id': id,
        'workerId': 'w-$id',
        'periodStart': '2026-08-01T00:00:00.000Z',
        'periodEnd': '2026-08-31T00:00:00.000Z',
        'grossAmount': 5000,
        'advanceDeduct': 300,
        'absenceDeduct': 200,
        'netAmount': 4500,
        'status': status,
        'createdAt': '2026-09-01T10:00:00.000Z',
        'worker': {'id': 'w-$id', 'name': 'عامل $id', 'code': 'W-00$id'},
      };

  Map<String, dynamic> payrollsPayload(List<Map<String, dynamic>> items) =>
      <String, dynamic>{
        'items': items,
        'total': items.length,
        'page': 1,
        'limit': 50,
      };

  final mixedItems = [
    payrollItem('1', 'DRAFT'),
    payrollItem('2', 'APPROVED'),
    payrollItem('3', 'PAID'),
  ];

  group('fetchPayrolls — الحالات', () {
    test('تحميل ثم نجاح: items كاملة → PayrollsLoaded', () async {
      final cubit = PayrollsCubit(
        dio: _stubDio(
          respondWith: (options) => payrollsPayload(mixedItems),
        ),
      );
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          isA<PayrollsLoading>(),
          predicate<PayrollsLoaded>((state) =>
              state.payrolls.length == 3 &&
              state.payrolls.first['worker'] is Map &&
              (state.payrolls.first['worker'] as Map)['name'] == 'عامل 1' &&
              !state.isRefreshing),
        ]),
      );
      await cubit.fetchPayrolls();
      await expectation;
    });

    test('items فارغة → PayrollsEmpty (حتى مع total>0)', () async {
      final cubit = PayrollsCubit(
        dio: _stubDio(
          respondWith: (options) => {
            'items': <Map<String, dynamic>>[],
            'total': 0,
            'page': 1,
            'limit': 50,
          },
        ),
      );
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([isA<PayrollsLoading>(), isA<PayrollsEmpty>()]),
      );
      await cubit.fetchPayrolls();
      await expectation;
    });

    test('خطأ خادم 403 → PayrollsError برسالة messageFor', () async {
      final cubit = PayrollsCubit(
        dio: _stubDio(
          rejectWith: (options) => DioException(
            requestOptions: options,
            type: DioExceptionType.badResponse,
            response: Response<Object>(
              requestOptions: options,
              statusCode: 403,
              data: {'message': 'ليس لديك صلاحية'},
            ),
          ),
        ),
      );
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          isA<PayrollsLoading>(),
          predicate<PayrollsError>((state) => state.message.contains('صلاحية')),
        ]),
      );
      await cubit.fetchPayrolls();
      await expectation;
    });

    test('استجابة بلا items → PayrollsError (عقد الاستجابة ملزم)', () async {
      final cubit = PayrollsCubit(
        dio: _stubDio(respondWith: (options) => {'data': mixedItems}),
      );
      addTearDown(cubit.close);

      await cubit.fetchPayrolls();
      expect(cubit.state, isA<PayrollsError>());
    });

    test('التحديث بالسحب: loaded تبقى أثناء refreshing ثم تُستبدل', () async {
      var call = 0;
      final cubit = PayrollsCubit(
        dio: _stubDio(respondWith: (options) {
          call++;
          return payrollsPayload(
              call == 1 ? mixedItems : [payrollItem('9', 'PAID')]);
        }),
      );
      addTearDown(cubit.close);

      await cubit.fetchPayrolls();
      expect(cubit.state, isA<PayrollsLoaded>());

      // السحب: القائمة القديمة تبقى مرئية مع isRefreshing=true ثم الجديدة.
      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          predicate<PayrollsLoaded>(
              (state) => state.isRefreshing && state.payrolls.length == 3),
          predicate<PayrollsLoaded>(
              (state) => !state.isRefreshing && state.payrolls.length == 1),
        ]),
      );
      await cubit.fetchPayrolls(refreshing: true);
      await expectation;
    });
  });

  group('setFilter — المرشح', () {
    test('المرشح يُرسل في query string ويعيد الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = PayrollsCubit(
        dio: _stubDio(
          requests: requests,
          respondWith: (options) => payrollsPayload(mixedItems),
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetchPayrolls();
      expect(requests.single.queryParameters.containsKey('status'), isFalse);
      expect(requests.single.queryParameters['page'], 1);
      expect(requests.single.queryParameters['limit'], 50);

      await cubit.setFilter(PayrollStatusFilter.paid);
      expect(requests.last.queryParameters['status'], 'PAID');
      expect(cubit.state, isA<PayrollsLoaded>());

      // نفس المرشح مرة أخرى → لا طلب جديد (no-op).
      final countBefore = requests.length;
      await cubit.setFilter(PayrollStatusFilter.paid);
      expect(requests.length, countBefore);
    });

    test('الحالات تحمل المرشح الحالي (لا وميض للشرائح)', () async {
      final cubit = PayrollsCubit(
        dio: _stubDio(
          rejectWith: (options) => DioException(
            requestOptions: options,
            type: DioExceptionType.badResponse,
            response: Response<Object>(
              requestOptions: options,
              statusCode: 500,
            ),
          ),
        ),
      );
      addTearDown(cubit.close);

      await cubit.setFilter(PayrollStatusFilter.approved);
      expect(cubit.state, isA<PayrollsError>());
      expect(
          (cubit.state as PayrollsError).filter, PayrollStatusFilter.approved);
    });
  });

  test('PayrollStatusFilter: القيم الخام واللابلات العربية', () {
    expect(PayrollStatusFilter.all.queryValue, isNull);
    expect(PayrollStatusFilter.draft.queryValue, 'DRAFT');
    expect(PayrollStatusFilter.approved.queryValue, 'APPROVED');
    expect(PayrollStatusFilter.paid.queryValue, 'PAID');
    expect(PayrollStatusFilter.values.map((f) => f.label), contains('الكل'));
  });
}

/// Dio وهمي عبر اعتراض: يسجل الطلبات ويرد بالحمولة أو يرفض بخطأ.
Dio _stubDio({
  List<RequestOptions>? requests,
  Map<String, dynamic> Function(RequestOptions options)? respondWith,
  DioException Function(RequestOptions options)? rejectWith,
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
            data: respondWith?.call(options),
          ),
        );
      },
    ),
  );
  return instance;
}
