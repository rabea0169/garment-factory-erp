import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/shifts/presentation/cubit/shifts_cubit.dart';

/// ShiftsCubit — عقود استجابات وحدة الورديات الخادمية الحرفية:
///  - fetch: GET /shifts/current (وردية مفتوحة أو null) ثم GET /shifts
///    بقائمة {items, total, openCount} ومرشح الحالة.
///  - open: POST /shifts/open {startCash?, notes?} ثم إعادة الجلب.
///  - closeShift: POST /shifts/:id/close {endCash, notes?} — المتوقع
///    والفرق من الخادم، والفشل يعاد برسالة عربية.
///  - loadShift: GET /shifts/:id لقراءة لقطة الوردية لحوار الإغلاق.
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  Map<String, dynamic> paginated(List<Map<String, dynamic>> items) =>
      <String, dynamic>{
        'items': items,
        'total': items.length,
        'page': 1,
        'limit': items.length,
        'pages': 1,
        'openCount': 1,
      };

  const Map<String, dynamic> openShift = {
    'id': 'shift-1',
    'code': 'SHF-0001',
    'openedById': 'user-1',
    'openedByName': 'أمين الصندوق',
    'startTime': '2026-09-10T08:00:00.000Z',
    'endTime': null,
    'startCash': '500.00',
    'expectedCash': null,
    'endCash': null,
    'difference': null,
    'status': 'OPEN',
    'notes': 'وردية صباحية',
  };

  const Map<String, dynamic> closedShift = {
    'id': 'shift-1',
    'code': 'SHF-0001',
    'openedById': 'user-1',
    'openedByName': 'أمين الصندوق',
    'startTime': '2026-09-10T08:00:00.000Z',
    'endTime': '2026-09-10T16:30:00.000Z',
    'startCash': '500.00',
    'expectedCash': '3500.50',
    'endCash': '3480.00',
    'difference': '-20.50',
    'status': 'CLOSED',
    'notes': 'وردية صباحية | إغلاق: فرق عُزى لمردود عميل',
  };

  /// وردية المستخدم الحالية — null يعني لا وردية مفتوحة (200 بجسم فارغ).
  Object? currentPayload = openShift;

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/shifts/current' => currentPayload,
        '/shifts' => paginated(
            [currentPayload == null ? closedShift : openShift],
          ),
        '/shifts/shift-1' => openShift,
        '/shifts/open' => openShift,
        '/shifts/shift-1/close' => closedShift,
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

  group('fetch — الوردية الحالية + القائمة', () {
    test('النجاح: current ثم القائمة بlimit=100 وحالة مفتوحة', () async {
      final requests = <RequestOptions>[];
      final cubit = ShiftsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();

      final state = cubit.state;
      expect(state, isA<ShiftsLoaded>());
      final loaded = state as ShiftsLoaded;
      expect(loaded.currentShift?['code'], 'SHF-0001');
      expect(loaded.currentShift?['status'], 'OPEN');
      expect(loaded.shifts.length, 1);
      expect(loaded.total, 1);
      expect(loaded.openCount, 1);

      // current بلا معاملات ثم القائمة بحد 100.
      expect(requests.length, 2);
      expect(requests.first.path, '/shifts/current');
      expect(requests.first.queryParameters, isEmpty);
      expect(requests.last.path, '/shifts');
      expect(requests.last.queryParameters['limit'], 100);
      expect(requests.last.queryParameters['status'], isNull);
    });

    test('لا وردية مفتوحة: current يعيد null والقائمة تعمل', () async {
      currentPayload = null;
      addTearDown(() => currentPayload = openShift);
      final cubit = ShiftsCubit(dio: stubDio());
      addTearDown(cubit.close);

      await cubit.fetch();

      final state = cubit.state as ShiftsLoaded;
      expect(state.currentShift, isNull);
      expect(state.shifts.first['status'], 'CLOSED');
    });

    test('مرشح الحالة: status=OPEN يُرسل ولا يُرسل ALL', () async {
      final requests = <RequestOptions>[];
      final cubit = ShiftsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(status: 'OPEN');
      expect(requests.last.path, '/shifts');
      expect(requests.last.queryParameters['status'], 'OPEN');

      await cubit.fetch(status: 'ALL');
      expect(requests.last.queryParameters['status'], isNull);
      expect(requests.last.queryParameters['limit'], 100);
    });

    test('فشل القائمة: ShiftsError برسالة الخادم', () async {
      final cubit = ShiftsCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/shifts'
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

      await cubit.fetch();

      expect(cubit.state, isA<ShiftsError>());
      expect((cubit.state as ShiftsError).message, contains('صلاحية'));
    });
  });

  group('open — فتح وردية', () {
    test('النجاح: POST بالافتتاحي والملاحظات ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = ShiftsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.open(startCash: 500, notes: 'وردية صباحية');

      expect(ok, isTrue);
      expect(cubit.state, isA<ShiftsLoaded>());
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/shifts/open');
      expect(post.data['startCash'], 500);
      expect(post.data['notes'], 'وردية صباحية');
      // إعادة الجلب بعد الفتح: current ثم القائمة.
      expect(requests[1].path, '/shifts/current');
      expect(requests[2].path, '/shifts');
    });

    test('تعارض الوردية المفتوحة: false مع رسالة الخادم', () async {
      final cubit = ShiftsCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/shifts/open'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 409,
                    data: {'message': 'توجد وردية مفتوحة بالفعل لهذا المستخدم'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      final ok = await cubit.open(startCash: 100);

      expect(ok, isFalse);
      expect(cubit.lastActionError, contains('وردية مفتوحة'));
    });
  });

  group('closeShift — إغلاق وردية', () {
    test('النجاح: POST بالفعلي والملاحظات ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = ShiftsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.closeShift(
        'shift-1',
        endCash: 3480,
        notes: 'فرق عُزى لمردود عميل',
      );

      expect(ok, isTrue);
      expect(cubit.state, isA<ShiftsLoaded>());
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/shifts/shift-1/close');
      expect(post.data['endCash'], 3480);
      expect(post.data['notes'], 'فرق عُزى لمردود عميل');
      // الفرق يأتي من الخادم داخل الاستجابة (لا يحسبه العميل).
      expect(requests[1].path, '/shifts/current');
      expect(requests[2].path, '/shifts');
    });

    test('خطأ الإغلاق: false ورسالة الخادم والحالة لا تتحطم', () async {
      final cubit = ShiftsCubit(
        dio: stubDio(
          rejectWith: (options) =>
              options.method == 'POST' && options.path.contains('/close')
                  ? DioException(
                      requestOptions: options,
                      type: DioExceptionType.badResponse,
                      response: Response<Object>(
                        requestOptions: options,
                        statusCode: 400,
                        data: {'message': 'الوردية مغلقة بالفعل'},
                      ),
                    )
                  : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      expect(cubit.state, isA<ShiftsLoaded>());

      final ok = await cubit.closeShift('shift-1', endCash: 100);

      expect(ok, isFalse);
      expect(cubit.lastActionError, contains('مغلقة'));
      // فشل الإجراء لا يمس الحالة المحمّلة.
      expect(cubit.state, isA<ShiftsLoaded>());
    });
  });

  group('loadShift — لقطة الوردية لحوار الإغلاق', () {
    test('GET /shifts/:id يعيد الخريطة كاملة', () async {
      final requests = <RequestOptions>[];
      final cubit = ShiftsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final shift = await cubit.loadShift('shift-1');

      expect(shift?['id'], 'shift-1');
      expect(shift?['startCash'], '500.00');
      expect(requests.single.path, '/shifts/shift-1');
    });
  });
}
