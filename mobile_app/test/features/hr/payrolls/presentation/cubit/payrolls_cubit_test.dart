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

  group('إجراءات دورة الرواتب (GF-IMP-W3)', () {
    test('createPayroll: العقد الحرفي + دمج المكافأة/الخصم في الملاحظات',
        () async {
      final transport = _PathTransport();
      transport.payloads['/hr/payrolls'] = (_) =>
          payrollsPayload([payrollItem('4', 'DRAFT')]);
      final cubit = PayrollsCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchPayrolls();

      final error = await cubit.createPayroll(
        workerId: 'w-1',
        from: DateTime(2026, 8, 1),
        to: DateTime(2026, 8, 31),
        bonus: 200,
        deductions: 50,
        notes: 'كشف أغسطس',
      );

      expect(error, isNull);
      final post =
          transport.requests.lastWhere((r) => r.path == '/hr/payrolls' && r.method == 'POST');
      final body = post.data as Map;
      expect(body['workerId'], 'w-1');
      expect(body['periodStart'], DateTime(2026, 8, 1).toIso8601String());
      expect(body['periodEnd'], DateTime(2026, 8, 31).toIso8601String());
      // ADR-0015: لا حقول مبالغ من العميل — تُدمج في الملاحظات.
      expect(body.containsKey('bonus'), isFalse);
      expect(body.containsKey('deductions'), isFalse);
      expect(body['notes'],
          'كشف أغسطس | مكافأة إضافية: 200.00 | خصم إضافي: 50.00');
      // مفتاح اندماجية صريح.
      expect(post.headers['Idempotency-Key'], isA<String>());
      // نجاح الإنشاء → إعادة جلب الكشوف.
      expect(
        transport.requests
            .where((r) => r.path == '/hr/payrolls' && r.method == 'GET')
            .length,
        2,
      );
    });

    test('createPayroll: فترة افتراضية = الشهر الحالي عند غياب from/to',
        () async {
      final transport = _PathTransport();
      transport.payloads['/hr/payrolls'] = (_) =>
          payrollsPayload([payrollItem('5', 'DRAFT')]);
      final cubit = PayrollsCubit(dio: transport.dio);
      addTearDown(cubit.close);

      await cubit.createPayroll(workerId: 'w-2');

      final body = transport.requests
          .lastWhere((r) => r.path == '/hr/payrolls' && r.method == 'POST')
          .data as Map;
      final now = DateTime.now();
      expect(body['periodStart'], DateTime(now.year, now.month, 1).toIso8601String());
      expect(
          body['periodEnd'], DateTime(now.year, now.month + 1, 0).toIso8601String());
      // لا ملاحظات → الحقل لا يُرسل.
      expect(body.containsKey('notes'), isFalse);
    });

    test('createPayroll: خطأ 409 → رسالة نصية والقائمة لا تمس', () async {
      final transport = _PathTransport();
      transport.payloads['/hr/payrolls'] = (_) =>
          payrollsPayload([payrollItem('6', 'DRAFT')]);
      transport.errorStatus['POST:/hr/payrolls'] = 409;
      final cubit = PayrollsCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchPayrolls();

      final error = await cubit.createPayroll(workerId: 'w-1');

      expect(error, isNotNull);
      expect(cubit.state, isA<PayrollsLoaded>());
    });

    test('approvePayroll: POST بلا جسم + مفتاح اندماجية + إعادة جلب',
        () async {
      final transport = _PathTransport();
      transport.payloads['/hr/payrolls'] = (_) =>
          payrollsPayload([payrollItem('7', 'APPROVED')]);
      transport.payloads['/hr/payrolls/p-7/approve'] = (_) => {'ok': true};
      final cubit = PayrollsCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchPayrolls();

      final error = await cubit.approvePayroll('p-7');

      expect(error, isNull);
      final post = transport.requests
          .lastWhere((r) => r.path == '/hr/payrolls/p-7/approve');
      expect(post.method, 'POST');
      expect(post.data, isNull);
      expect(post.headers['Idempotency-Key'], isA<String>());
      expect(
        transport.requests
            .where((r) => r.path == '/hr/payrolls' && r.method == 'GET')
            .length,
        2,
      );
    });

    test('cancelPayroll: مسار الإبطال الصحيح', () async {
      final transport = _PathTransport();
      transport.payloads['/hr/payrolls'] = (_) =>
          payrollsPayload([payrollItem('8', 'DRAFT')]);
      transport.payloads['/hr/payrolls/p-8/cancel'] = (_) => {'cancelled': true};
      final cubit = PayrollsCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchPayrolls();

      final error = await cubit.cancelPayroll('p-8');

      expect(error, isNull);
      expect(
        transport.requests.lastWhere((r) => r.path == '/hr/payrolls/p-8/cancel').method,
        'POST',
      );
    });

    test('payPayroll: الخزينة في الجسم عند توفيرها فقط', () async {
      final transport = _PathTransport();
      transport.payloads['/hr/payrolls'] = (_) =>
          payrollsPayload([payrollItem('9', 'PAID')]);
      transport.payloads['/hr/payrolls/p-9/pay'] = (_) => {'ok': true};
      final cubit = PayrollsCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchPayrolls();

      expect(await cubit.payPayroll('p-9', treasuryId: 't-1'), isNull);
      var body = transport.requests
          .lastWhere((r) => r.path == '/hr/payrolls/p-9/pay')
          .data as Map;
      expect(body['treasuryId'], 't-1');

      // بلا خزينة (صافٍ صفر — HR-4): جسم فارغ بلا المفتاح.
      expect(await cubit.payPayroll('p-9'), isNull);
      body = transport.requests
          .lastWhere((r) => r.path == '/hr/payrolls/p-9/pay')
          .data as Map;
      expect(body.containsKey('treasuryId'), isFalse);
    });

    test('approvePayroll: خطأ خادم 400 → رسالة نصية', () async {
      final transport = _PathTransport();
      transport.payloads['/hr/payrolls'] = (_) =>
          payrollsPayload([payrollItem('10', 'DRAFT')]);
      transport.errorStatus['POST:/hr/payrolls/p-10/approve'] = 400;
      final cubit = PayrollsCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchPayrolls();

      final error = await cubit.approvePayroll('p-10');

      expect(error, isNotNull);
      expect(error, isNotEmpty);
      expect(cubit.state, isA<PayrollsLoaded>());
    });

    test('fetchWorkers: data[] تُحل؛ والفشل يعيد قائمة فارغة', () async {
      final transport = _PathTransport()
        ..payloads['/hr/workers'] = (_) => const {
              'data': [
                {'id': 'w-1', 'name': 'أحمد', 'code': 'W-001'},
              ],
            };
      final cubit = PayrollsCubit(dio: transport.dio);
      addTearDown(cubit.close);

      final workers = await cubit.fetchWorkers();
      expect(workers.length, 1);
      expect(workers.single['name'], 'أحمد');

      // فشل الجلب → قائمة فارغة (الحوار يعطّل الحفظ بصمت).
      final failing = _PathTransport()..errorStatus['GET:/hr/workers'] = 403;
      final cubit2 = PayrollsCubit(dio: failing.dio);
      addTearDown(cubit2.close);
      expect(await cubit2.fetchWorkers(), isEmpty);
    });

    test('fetchTreasuries: data[] تُحل؛ والفشل يعيد قائمة فارغة', () async {
      final transport = _PathTransport()
        ..payloads['/accounting/treasuries'] = (_) => const {
              'data': [
                {'id': 't-1', 'name': 'الخزينة الرئيسية'},
              ],
            };
      final cubit = PayrollsCubit(dio: transport.dio);
      addTearDown(cubit.close);

      final treasuries = await cubit.fetchTreasuries();
      expect(treasuries.single['id'], 't-1');

      final failing = _PathTransport()
        ..errorStatus['GET:/accounting/treasuries'] = 403;
      final cubit2 = PayrollsCubit(dio: failing.dio);
      addTearDown(cubit2.close);
      expect(await cubit2.fetchTreasuries(), isEmpty);
    });
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

/// نقل وهمي بمسارات: يفصل بين الطلبات حسب المسار — يسجل كل طلب ويرد
/// بالحمولة أو يرفض بخطأ حالة (المفتاح "METHOD:path" للفصل).
class _PathTransport {
  final List<RequestOptions> requests = <RequestOptions>[];

  final Map<String, Object? Function(int index)> payloads =
      <String, Object? Function(int index)>{};

  final Map<String, int> errorStatus = <String, int>{};

  Dio get dio {
    final instance = Dio(BaseOptions(baseUrl: 'https://erp.test'));
    instance.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests.add(options);
          final methodKey = '${options.method}:${options.path}';
          final status = errorStatus[options.path] ?? errorStatus[methodKey];
          if (status != null) {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.badResponse,
                response: Response<Object>(
                  requestOptions: options,
                  statusCode: status,
                  data: {'message': 'خطأ من الخادم'},
                ),
              ),
              true,
            );
            return;
          }
          final index = requests
                  .where((r) => r.path == options.path)
                  .length -
              1;
          handler.resolve(
            Response<Object>(
              requestOptions: options,
              statusCode: 200,
              data: payloads[options.path]?.call(index),
            ),
          );
        },
      ),
    );
    return instance;
  }
}
