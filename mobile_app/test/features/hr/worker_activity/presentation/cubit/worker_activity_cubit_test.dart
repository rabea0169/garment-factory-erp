import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/hr/worker_activity/presentation/cubit/worker_activity_cubit.dart';
import 'package:garment_factory_erp/features/hr/worker_activity/presentation/cubit/worker_activity_state.dart';

/// MOB-8: WorkerActivityCubit — آخر السلف (GET /hr/advances?workerId=)
/// وآخر إنتاج العامل (GET /hr/production?workerId=) بعقد items الحرفي:
/// تحميل/نجاح بقائمتين/فراغ لكل قائمة/خطأ موحد. Dio وهمي عبر اعتراض.
void main() {
  final advancesPayload = <String, dynamic>{
    'items': [
      {
        'id': 'adv-1',
        'workerId': 'w-1',
        'amount': 500,
        'settledAmount': 200,
        'date': '2026-08-10T00:00:00.000Z',
        'notes': 'سلفة شهر أغسطس',
        'worker': {'id': 'w-1', 'name': 'أحمد', 'code': 'W-001'},
      },
    ],
    'total': 1,
    'page': 1,
    'limit': 20,
  };

  final productionPayload = <String, dynamic>{
    'items': [
      {
        'id': 'prod-1',
        'workerId': 'w-1',
        'workOrderId': 'wo-1',
        'date': '2026-08-25T00:00:00.000Z',
        'piecesCount': 40,
        'pieceRate': 2.5,
        'totalAmount': 100,
        'notes': null,
        'worker': {'id': 'w-1', 'name': 'أحمد', 'code': 'W-001'},
      },
      {
        'id': 'prod-2',
        'workerId': 'w-1',
        'workOrderId': 'wo-1',
        'date': '2026-08-26T00:00:00.000Z',
        'piecesCount': 10,
        'pieceRate': 2.5,
        'totalAmount': 25,
        'notes': null,
        'worker': {'id': 'w-1', 'name': 'أحمد', 'code': 'W-001'},
      },
    ],
    'total': 2,
    'page': 1,
    'limit': 20,
  };

  test('تحميل ثم نجاح: القائمتان معًا بعقد items', () async {
    final requests = <RequestOptions>[];
    final cubit = WorkerActivityCubit(
      workerId: 'w-1',
      workerName: 'أحمد',
      dio: _stubDio(
        requests: requests,
        respondWith: (options) => options.path == '/hr/advances'
            ? advancesPayload
            : productionPayload,
      ),
    );
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<WorkerActivityLoading>(),
        predicate<WorkerActivityLoaded>((state) =>
            state.advances.length == 1 &&
            state.production.length == 2 &&
            state.advances.first['settledAmount'] == 200 &&
            state.production.first['piecesCount'] == 40),
      ]),
    );
    await cubit.fetchActivity();
    await expectation;

    // الطلبان بمقيد العامل.
    expect(requests.length, 2);
    expect(
      requests.every((r) => r.queryParameters['workerId'] == 'w-1'),
      isTrue,
    );
  });

  test('قائمتان فارغتان → WorkerActivityLoaded بفراغين (لا خطأ)', () async {
    final cubit = WorkerActivityCubit(
      workerId: 'w-1',
      workerName: '',
      dio: _stubDio(
        respondWith: (options) => <String, dynamic>{
          'items': <Map<String, dynamic>>[],
          'total': 0,
          'page': 1,
          'limit': 20,
        },
      ),
    );
    addTearDown(cubit.close);

    await cubit.fetchActivity();
    expect(cubit.state, isA<WorkerActivityLoaded>());
    expect((cubit.state as WorkerActivityLoaded).advances, isEmpty);
    expect((cubit.state as WorkerActivityLoaded).production, isEmpty);
  });

  test('فشل أحد الطلبين → WorkerActivityError موحدة برسالة عربية', () async {
    final cubit = WorkerActivityCubit(
      workerId: 'w-1',
      workerName: '',
      dio: _stubDio(
        respondWith: (options) => advancesPayload,
        rejectWith: (options) =>
            options.path == '/hr/production' ? _serverError(options) : null,
      ),
    );
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<WorkerActivityLoading>(),
        isA<WorkerActivityError>(),
      ]),
    );
    await cubit.fetchActivity();
    await expectation;
    expect((cubit.state as WorkerActivityError).message, isNotEmpty);
  });

  test('استجابة بلا items → WorkerActivityError (عقد الاستجابة ملزم)',
      () async {
    final cubit = WorkerActivityCubit(
      workerId: 'w-1',
      workerName: '',
      dio: _stubDio(
          respondWith: (options) => {'data': <Map<String, dynamic>>[]}),
    );
    addTearDown(cubit.close);

    await cubit.fetchActivity();
    expect(cubit.state, isA<WorkerActivityError>());
  });

  test('انقطاع الاتصال → WorkerActivityError برسالة الشبكة', () async {
    final cubit = WorkerActivityCubit(
      workerId: 'w-1',
      workerName: '',
      dio: _stubDio(
        rejectWith: (options) => DioException.connectionError(
          requestOptions: options,
          reason: 'Network is unreachable',
        ),
      ),
    );
    addTearDown(cubit.close);

    await cubit.fetchActivity();
    expect(cubit.state, isA<WorkerActivityError>());
    expect(
        (cubit.state as WorkerActivityError).message, contains('تعذر الاتصال'));
  });
}

DioException _serverError(RequestOptions options) => DioException(
      requestOptions: options,
      type: DioExceptionType.badResponse,
      response: Response<Object>(
        requestOptions: options,
        statusCode: 500,
        data: {'message': 'خطأ داخلي'},
      ),
    );

/// Dio وهمي عبر اعتراض: يسجل الطلبات ويرد بالحمولة أو يرفض بخطأ.
Dio _stubDio({
  List<RequestOptions>? requests,
  Map<String, dynamic> Function(RequestOptions options)? respondWith,
  DioException? Function(RequestOptions options)? rejectWith,
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
