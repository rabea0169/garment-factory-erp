import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/payroll_statements/presentation/cubit/payroll_statements_cubit.dart';

/// PayrollStatementsCubit — عقود استجابات وحدة كشوف الرواتب المجمدة:
///  - fetch: GET /payroll-statements {items, total} — كل صف يحمل لقطة
///    JSON كاملة (lines: صفوف العمال، totals: المجاميع، workerCount).
///  - generate: POST /generate {periodFrom, periodTo, notes?} — الرفض
///    عند خلو الفترة (400 برسالة عربية).
///  - post: POST /:id/post يرحّل القيد ويعلّم الكشوف مُدفوعة.
///  - delete: DELETE /:id للمسودة فقط (يفك ربط الكشوف).
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  Map<String, dynamic> paginated(List<Map<String, dynamic>> items) =>
      <String, dynamic>{
        'items': items,
        'total': items.length,
        'page': 1,
        'limit': items.length,
        'pages': 1,
      };

  const Map<String, dynamic> draftStatement = {
    'id': 'psm-1',
    'code': 'PSM-0001',
    'periodFrom': '2026-09-01T00:00:00.000Z',
    'periodTo': '2026-09-30T00:00:00.000Z',
    'status': 'DRAFT',
    'lines': [
      {
        'payrollId': 'payroll-1',
        'workerId': 'worker-1',
        'workerName': 'أحمد',
        'workerCode': 'W-001',
        'gross': 3000,
        'advanceDeductions': 500,
        'absenceDeductions': 100,
        'deductions': 600,
        'net': 2400,
      },
      {
        'payrollId': 'payroll-2',
        'workerId': 'worker-2',
        'workerName': 'سعيد',
        'workerCode': 'W-002',
        'gross': 2000,
        'advanceDeductions': 200,
        'absenceDeductions': 0,
        'deductions': 200,
        'net': 1800,
      },
    ],
    'totals': {
      'gross': 5000,
      'advanceDeductions': 700,
      'absenceDeductions': 100,
      'deductions': 800,
      'net': 4200,
      'count': 2,
    },
    'workerCount': 2,
    'approvedById': null,
    'approvedAt': null,
    'notes': 'رواتب سبتمبر 2026',
    'journalEntryId': null,
    'createdAt': '2026-10-01T09:00:00.000Z',
  };

  final Map<String, dynamic> postedStatement = {
    ...draftStatement,
    'status': 'POSTED',
    'approvedById': 'user-1',
    'approvedAt': '2026-10-02T10:00:00.000Z',
    'journalEntryId': 'entry-1',
  };

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/payroll-statements' => paginated(const [draftStatement]),
        '/payroll-statements/generate' => draftStatement,
        '/payroll-statements/psm-1/post' => postedStatement,
        '/payroll-statements/psm-1' => draftStatement,
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

  group('fetch — الكشوف المجمدة', () {
    test('النجاح: القائمة بلقطة lines/totals وعدادات الشرائح', () async {
      final requests = <RequestOptions>[];
      final cubit = PayrollStatementsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();

      final state = cubit.state;
      expect(state, isA<PayrollStatementsLoaded>());
      final loaded = state as PayrollStatementsLoaded;
      expect(loaded.statements.length, 1);
      expect(loaded.total, 1);
      expect(loaded.countOf('DRAFT'), 1);
      expect(loaded.countOf('POSTED'), 0);

      // اللقطة المجمدة قابلة للقراءة عبر مساعدي الحالة.
      final totals = loaded.totalsOf(loaded.statements.first);
      expect(totals['net'], 4200);
      expect(totals['gross'], 5000);
      expect(totals['deductions'], 800);
      final lines = loaded.linesOf(loaded.statements.first);
      expect(lines.length, 2);
      expect(lines.first['workerName'], 'أحمد');
      expect(lines.last['net'], 1800);
      expect(loaded.statements.first['workerCount'], 2);

      expect(requests.single.path, '/payroll-statements');
      expect(requests.single.queryParameters['limit'], 100);
      expect(requests.single.queryParameters['status'], isNull);
    });

    test('مرشح الحالة: status=POSTED يُرسل للخادم', () async {
      final requests = <RequestOptions>[];
      final cubit = PayrollStatementsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(status: 'POSTED');

      expect(requests.last.queryParameters['status'], 'POSTED');

      // ALL يعني بلا مرشح (قاعدة الشرائح).
      await cubit.fetch(status: 'ALL');
      expect(requests.last.queryParameters['status'], isNull);
    });

    test('فشل القائمة: PayrollStatementsError', () async {
      final cubit = PayrollStatementsCubit(
        dio: stubDio(
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

      await cubit.fetch();

      expect(cubit.state, isA<PayrollStatementsError>());
      expect((cubit.state as PayrollStatementsError).message, contains('صلاحية'));
    });
  });

  group('generate — توليد كشف مجمع', () {
    test('النجاح: POST بالفترة والملاحظات ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = PayrollStatementsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.generate(
        periodFrom: '2026-09-01',
        periodTo: '2026-09-30',
        notes: 'رواتب سبتمبر',
      );

      expect(ok, isTrue);
      expect(cubit.state, isA<PayrollStatementsLoaded>());
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/payroll-statements/generate');
      expect(post.data['periodFrom'], '2026-09-01');
      expect(post.data['periodTo'], '2026-09-30');
      expect(post.data['notes'], 'رواتب سبتمبر');
      // إعادة الجلب بعد التوليد.
      expect(
        requests.map((r) => r.path),
        contains('/payroll-statements'),
      );
    });

    test('فترة فارغة: false مع رسالة الرفض العربية', () async {
      final cubit = PayrollStatementsCubit(
        dio: stubDio(
          rejectWith: (options) =>
              options.method == 'POST' && options.path.endsWith('/generate')
                  ? DioException(
                      requestOptions: options,
                      type: DioExceptionType.badResponse,
                      response: Response<Object>(
                        requestOptions: options,
                        statusCode: 400,
                        data: {
                          'message': 'لا توجد كشوف رواتب معتمدة غير مدفوعة في الفترة',
                        },
                      ),
                    )
                  : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      expect(cubit.state, isA<PayrollStatementsLoaded>());

      final ok = await cubit.generate(
        periodFrom: '2026-12-01',
        periodTo: '2026-12-31',
      );

      expect(ok, isFalse);
      expect(cubit.lastActionError, contains('لا توجد كشوف رواتب معتمدة'));
      // فشل التوليد لا يمس الحالة المحمّلة.
      expect(cubit.state, isA<PayrollStatementsLoaded>());
    });
  });

  group('post — ترحيل الكشف المجمع', () {
    test('النجاح: POST /:id/post ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = PayrollStatementsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.post('psm-1');

      expect(ok, isTrue);
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/payroll-statements/psm-1/post');
      // الترحيل بلا جسم — التحقق والحسابات كلها على الخادم.
      expect(post.data, isNull);
      expect(cubit.state, isA<PayrollStatementsLoaded>());
    });

    test('كشف مرحّل مسبقًا: false مع رسالة الخادم', () async {
      final cubit = PayrollStatementsCubit(
        dio: stubDio(
          rejectWith: (options) => options.path.endsWith('/post')
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'الكشف المجمع مرحّل بالفعل'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      final ok = await cubit.post('psm-1');

      expect(ok, isFalse);
      expect(cubit.lastActionError, contains('مرحّل'));
    });
  });

  group('delete — حذف مسودة', () {
    test('النجاح: DELETE ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = PayrollStatementsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.delete('psm-1');

      expect(ok, isTrue);
      final delete = requests.first;
      expect(delete.method, 'DELETE');
      expect(delete.path, '/payroll-statements/psm-1');
      expect(cubit.state, isA<PayrollStatementsLoaded>());
    });

    test('حذف مرحّل: false مع رسالة الرفض', () async {
      final cubit = PayrollStatementsCubit(
        dio: stubDio(
          rejectWith: (options) => options.method == 'DELETE'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {
                      'message': 'لا يمكن حذف كشف مجمع مرحّل — له قيد مالي وأثر دفع',
                    },
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      final ok = await cubit.delete('psm-1');

      expect(ok, isFalse);
      expect(cubit.lastActionError, contains('قيد مالي'));
    });
  });
}
