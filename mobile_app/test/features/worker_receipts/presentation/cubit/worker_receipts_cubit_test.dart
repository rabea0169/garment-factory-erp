import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/worker_receipts/presentation/cubit/worker_receipts_cubit.dart';

/// WorkerReceiptsCubit — عقود استجابات وحدة سندات قبض العمال:
///  - fetch: GET /worker-receipts {items, total, workerTotals} + العمال
///    من /hr/workers (PaginatedResult) لقائمة الاختيار.
///  - create: POST {workerId, amount, date?, notes?, treasuryId?} — حرس
///    رصيد الخزينة خادميًا يُعاد برسالة عربية دقيقة.
///  - delete: DELETE /:id يعكس القيد ويعيد رصيد الخزينة.
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  Map<String, dynamic> paginated(List<Map<String, dynamic>> data) =>
      <String, dynamic>{
        'data': data,
        'meta': {
          'total': data.length,
          'page': 1,
          'pageSize': data.length,
          'totalPages': 1,
          'hasNextPage': false,
          'hasPreviousPage': false,
        },
      };

  const Map<String, dynamic> receipt = {
    'id': 'receipt-1',
    'code': 'WRC-0001',
    'workerId': 'worker-1',
    'amount': '250.00',
    'date': '2026-09-10T10:30:00.000Z',
    'notes': 'تسوية سلفة شهر 8',
    'treasuryId': 'treasury-1',
    'journalEntryId': 'entry-1',
    'worker': {'id': 'worker-1', 'name': 'أحمد', 'code': 'W-001'},
    'treasury': {'id': 'treasury-1', 'name': 'الخزينة الرئيسية'},
    'createdAt': '2026-09-10T10:31:00.000Z',
  };

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/worker-receipts' => <String, dynamic>{
            'items': [receipt],
            'total': 3,
            'page': 1,
            'limit': 100,
            'pages': 1,
            'workerTotals': [
              {'workerId': 'worker-1', 'count': 2, 'total': 500},
              {'workerId': 'worker-2', 'count': 1, 'total': 300},
            ],
          },
        '/hr/workers' => paginated(const [
            {'id': 'worker-1', 'name': 'أحمد', 'code': 'W-001'},
            {'id': 'worker-2', 'name': 'سعيد', 'code': 'W-002'},
          ]),
        '/accounting/treasuries' => paginated(const [
            {'id': 'treasury-1', 'name': 'الخزينة الرئيسية', 'balance': '5000.00'},
          ]),
        '/worker-receipts/receipt-1' => receipt,
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

  group('fetch — السندات + العمال', () {
    test('النجاح: السندات ومجاميع كل عامل والعمال للاختيار', () async {
      final requests = <RequestOptions>[];
      final cubit = WorkerReceiptsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();

      final state = cubit.state;
      expect(state, isA<WorkerReceiptsLoaded>());
      final loaded = state as WorkerReceiptsLoaded;
      expect(loaded.receipts.length, 1);
      expect(loaded.receipts.first['code'], 'WRC-0001');
      expect(loaded.total, 3);
      expect(loaded.workers.length, 2);
      expect(loaded.workerTotals.length, 2);
      // مجمع العامل داخل المرشحات (تقرير التسويات).
      expect(loaded.totalFor('worker-1'), 500);
      expect(loaded.totalFor('worker-2'), 300);
      expect(loaded.totalFor('worker-404'), 0);

      expect(requests.length, 2);
      expect(requests.first.path, '/worker-receipts');
      expect(requests.first.queryParameters['limit'], 100);
      expect(requests.last.path, '/hr/workers');
      expect(requests.last.queryParameters['limit'], 100);
    });

    test('مرشح العامل: workerId يُرسل مع النطاق الزمني', () async {
      final requests = <RequestOptions>[];
      final cubit = WorkerReceiptsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(workerId: 'worker-1', from: '2026-09-01', to: '2026-09-30');

      final listRequest =
          requests.firstWhere((r) => r.path == '/worker-receipts');
      expect(listRequest.queryParameters['workerId'], 'worker-1');
      expect(listRequest.queryParameters['from'], '2026-09-01');
      expect(listRequest.queryParameters['to'], '2026-09-30');
    });

    test('فشل القائمة: WorkerReceiptsError', () async {
      final cubit = WorkerReceiptsCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/worker-receipts'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.connectionError,
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();

      expect(cubit.state, isA<WorkerReceiptsError>());
      expect(
        (cubit.state as WorkerReceiptsError).message,
        contains('الاتصال'),
      );
    });
  });

  group('create — إنشاء سند', () {
    test('النجاح: POST بالحمولة الكاملة ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = WorkerReceiptsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.create(
        workerId: 'worker-1',
        amount: 250,
        date: '2026-09-10',
        treasuryId: 'treasury-1',
        notes: 'تسوية سلفة',
      );

      expect(ok, isTrue);
      expect(cubit.state, isA<WorkerReceiptsLoaded>());
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/worker-receipts');
      expect(post.data['workerId'], 'worker-1');
      expect(post.data['amount'], 250);
      expect(post.data['date'], '2026-09-10');
      expect(post.data['treasuryId'], 'treasury-1');
      expect(post.data['notes'], 'تسوية سلفة');
      // إعادة الجلب بعد الإنشاء.
      expect(
        requests.map((r) => r.path),
        contains('/worker-receipts'),
      );
    });

    test('حرس الخزينة: false مع رسالة الخادم الدقيقة', () async {
      final cubit = WorkerReceiptsCubit(
        dio: stubDio(
          rejectWith: (options) => options.method == 'POST'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'رصيد الخزينة لا يكفي — المتاح: 200'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      expect(cubit.state, isA<WorkerReceiptsLoaded>());

      final ok = await cubit.create(workerId: 'worker-1', amount: 250);

      expect(ok, isFalse);
      expect(cubit.lastActionError, contains('رصيد الخزينة'));
      // فشل الإجراء لا يمس الحالة المحمّلة.
      expect(cubit.state, isA<WorkerReceiptsLoaded>());
    });
  });

  group('delete — حذف سند', () {
    test('النجاح: DELETE ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = WorkerReceiptsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.delete('receipt-1');

      expect(ok, isTrue);
      final delete = requests.first;
      expect(delete.method, 'DELETE');
      expect(delete.path, '/worker-receipts/receipt-1');
      expect(cubit.state, isA<WorkerReceiptsLoaded>());
    });
  });

  group('fetchTreasuries — خزائن حوار الإنشاء', () {
    test('GET /accounting/treasuries يعيد قائمة PaginatedResult', () async {
      final requests = <RequestOptions>[];
      final cubit = WorkerReceiptsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final treasuries = await cubit.fetchTreasuries();

      expect(treasuries.length, 1);
      expect(treasuries.first['name'], 'الخزينة الرئيسية');
      expect(requests.single.path, '/accounting/treasuries');
      expect(requests.single.queryParameters['limit'], 100);
    });
  });
}
