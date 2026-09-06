import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';

import 'package:garment_factory_erp/core/services/cache_service.dart';
import 'package:garment_factory_erp/core/services/outbox_service.dart';
import 'package:garment_factory_erp/features/hr/presentation/cubit/hr_cubit.dart';
import 'package:garment_factory_erp/features/hr/presentation/cubit/hr_state.dart';

/// MOB-3/MOB-7: HrCubit — جلب العمال مع write-through كاش، والاتصال
/// المقطوع يعرض الكاش (شارة fromCache) أو HrOffline، وتسجيل الإنتاج
/// بلا اتصال يُدرج في الطابور بنفس مفتاح الاندماجية.
///
/// Hive حقيقي في مجلد مؤقت + Dio وهمي عبر اعتراض (بلا شبكة).
void main() {
  late Directory tempDir;
  late CacheService cache;
  late OutboxService outbox;
  late _DrainAdapter drainAdapter;
  late Dio drainDio;

  setUpAll(() async {
    tempDir = await Directory.systemTemp.createTemp('gf_hr_cubit_test_');
    Hive.init(tempDir.path);
  });

  tearDownAll(() async {
    await Hive.close();
    await tempDir.delete(recursive: true);
  });

  setUp(() async {
    if (Hive.isBoxOpen(CacheService.boxName)) {
      await Hive.box(CacheService.boxName).clear();
    }
    if (Hive.isBoxOpen(OutboxService.boxName)) {
      await Hive.box(OutboxService.boxName).clear();
    }
    cache = CacheService();
    await cache.init();
    drainAdapter = _DrainAdapter();
    drainDio = Dio(BaseOptions(baseUrl: 'https://erp.test'))
      ..httpClientAdapter = drainAdapter;
    outbox = OutboxService(dio: drainDio);
    await outbox.init();
  });

  final workersPayload = <String, dynamic>{
    'data': [
      {
        'id': 'w-1',
        'name': 'أحمد',
        'code': 'W-001',
        'specialty': 'SEWING',
        'nfcId': '04A2B3',
      },
      {'id': 'w-2', 'name': 'سعيد', 'code': 'W-002', 'specialty': 'CUTTING'},
    ],
  };

  group('fetchWorkers', () {
    test('loading ثم loaded مع كتابة الكاش', () async {
      final transport = _StubTransport()
        ..payloads['/hr/workers'] = (_) => workersPayload;
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          isA<HrLoading>(),
          predicate<HrLoaded>(
              (state) => !state.fromCache && state.workers.length == 2),
        ]),
      );
      await cubit.fetchWorkers();
      await expectation;

      // MOB-3: آخر حالة ناجحة خُزنت (write-through).
      final snapshot = await cache.read('hr_workers');
      expect(snapshot, isNotNull);
      expect((snapshot!.data as List).length, 2);
    });

    test('انقطاع الاتصال مع كاش → HrLoaded من الكاش مع شارة', () async {
      await cache.writeThrough('hr_workers', workersPayload['data']);
      final transport = _StubTransport()..offlinePaths.add('/hr/workers');
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          isA<HrLoading>(),
          predicate<HrLoaded>((state) =>
              state.fromCache &&
              state.cachedAt != null &&
              state.workers.length == 2),
        ]),
      );
      await cubit.fetchWorkers();
      await expectation;
    });

    test('انقطاع الاتصال بلا كاش → HrOffline', () async {
      final transport = _StubTransport()..offlinePaths.add('/hr/workers');
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([isA<HrLoading>(), isA<HrOffline>()]),
      );
      await cubit.fetchWorkers();
      await expectation;
    });

    test('خطأ خادم 500 → HrError (ليس offline)', () async {
      final transport = _StubTransport()..errorStatus['/hr/workers'] = 500;
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          isA<HrLoading>(),
          predicate<HrError>((state) => state.message.isNotEmpty),
        ]),
      );
      await cubit.fetchWorkers();
      await expectation;
    });
  });

  group('recordProduction', () {
    test('النجاح يرسل فورًا ويعيد الجلب', () async {
      final transport = _StubTransport();
      transport.payloads['/hr/workers'] = (_) => workersPayload;
      transport.payloads['/hr/production'] = (_) => {'id': 'p-1'};
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();

      final outcome = await cubit.recordProduction(
        workerId: 'w-1',
        piecesCount: 25,
      );

      expect(outcome, RecordProductionOutcome.sent);
      // الجسم المرسل صحيح.
      final post =
          transport.requests.lastWhere((r) => r.path == '/hr/production');
      expect(post.method, 'POST');
      expect(post.data, isA<Map>());
      expect((post.data as Map)['workerId'], 'w-1');
      expect((post.data as Map)['piecesCount'], 25);
      // أعيد جلب العمال بعد النجاح.
      expect(
        transport.requests.where((r) => r.path == '/hr/workers').length,
        2,
      );
      // لا شيء في الطابور.
      expect(outbox.pendingCount, 0);
    });

    test('بلا اتصال: يُدرج في الطابور بنفس مفتاح الاندماجية', () async {
      final transport = _StubTransport();
      transport.payloads['/hr/workers'] = (_) => workersPayload;
      transport.offlinePaths.add('/hr/production');
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();

      final outcome = await cubit.recordProduction(
        workerId: 'w-1',
        piecesCount: 30,
      );

      expect(outcome, RecordProductionOutcome.queued);
      // الطابور فيه عنصر واحد بالجسم كاملًا.
      expect(outbox.pendingCount, 1);
      final entry = outbox.pendingEntries.single;
      expect(entry.path, '/hr/production');
      expect(entry.method, 'POST');
      expect(entry.body['workerId'], 'w-1');
      expect(entry.body['piecesCount'], 30);
      // نفس مفتاح المحاولة الأولى (لم يُولَّد مفتاح جديد).
      final attemptedPost =
          transport.requests.lastWhere((r) => r.path == '/hr/production');
      expect(
        attemptedPost.headers['Idempotency-Key'],
        entry.idempotencyKey,
      );

      // عودة الاتصال: الإرسال المتأخر بنفس المفتاح ثم حذف العنصر.
      await outbox.drain();
      expect(drainAdapter.requests.length, 1);
      expect(
        drainAdapter.requests.single.headers['Idempotency-Key'],
        entry.idempotencyKey,
      );
      expect(outbox.pendingCount, 0);
    });

    test('خطأ خادم 400 → failed مع HrError (لا طابور)', () async {
      final transport = _StubTransport();
      transport.payloads['/hr/workers'] = (_) => workersPayload;
      transport.errorStatus['/hr/production'] = 400;
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();

      final outcome = await cubit.recordProduction(
        workerId: 'w-1',
        piecesCount: -1,
      );

      expect(outcome, RecordProductionOutcome.failed);
      expect(outbox.pendingCount, 0);
      expect(cubit.state, isA<HrError>());
    });
  });

  group('recordAttendance', () {
    test('النجاح يرسل فورًا بعقد CreateAttendanceDto', () async {
      final transport = _StubTransport();
      transport.payloads['/hr/workers'] = (_) => workersPayload;
      transport.payloads['/hr/attendance'] = (_) => {'id': 'a-1'};
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();

      final outcome = await cubit.recordAttendance(
        workerId: 'w-1',
        isPresent: true,
        notes: '  حضور صباحي  ',
      );

      expect(outcome, RecordAttendanceOutcome.sent);
      final post =
          transport.requests.lastWhere((r) => r.path == '/hr/attendance');
      expect(post.method, 'POST');
      final body = post.data as Map;
      expect(body['workerId'], 'w-1');
      expect(body['isPresent'], isTrue);
      expect(body['date'], isA<String>());
      // الملاحظات تُقص (trim) قبل الإرسال.
      expect(body['notes'], 'حضور صباحي');
      expect(outbox.pendingCount, 0);
    });

    test('ملاحظات فارغة/فارغة تمامًا → لا تُرسل في الجسم', () async {
      final transport = _StubTransport();
      transport.payloads['/hr/workers'] = (_) => workersPayload;
      transport.payloads['/hr/attendance'] = (_) => {'id': 'a-2'};
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();

      await cubit.recordAttendance(
        workerId: 'w-1',
        isPresent: false,
        notes: '   ',
      );

      final body = transport.requests
          .lastWhere((r) => r.path == '/hr/attendance')
          .data as Map;
      expect(body.containsKey('notes'), isFalse);
    });

    test('بلا اتصال: يُدرج في الطابور بنفس مفتاح الاندماجية ويعيد queued',
        () async {
      final transport = _StubTransport();
      transport.payloads['/hr/workers'] = (_) => workersPayload;
      transport.offlinePaths.add('/hr/attendance');
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();

      final outcome = await cubit.recordAttendance(
        workerId: 'w-2',
        isPresent: false,
      );

      expect(outcome, RecordAttendanceOutcome.queued);
      expect(outbox.pendingCount, 1);
      final entry = outbox.pendingEntries.single;
      expect(entry.path, '/hr/attendance');
      expect(entry.method, 'POST');
      expect(entry.body['workerId'], 'w-2');
      expect(entry.body['isPresent'], isFalse);

      // نفس مفتاح المحاولة الأولى — لا مفتاح ثانٍ لنفس العملية.
      final attemptedPost =
          transport.requests.lastWhere((r) => r.path == '/hr/attendance');
      expect(
        attemptedPost.headers['Idempotency-Key'],
        entry.idempotencyKey,
      );

      // عودة الاتصال: الإرسال المتأخر بنفس المفتاح ثم حذف العنصر.
      await outbox.drain();
      expect(
        drainAdapter.requests.single.headers['Idempotency-Key'],
        entry.idempotencyKey,
      );
      expect(drainAdapter.requests.single.path, '/hr/attendance');
      expect(outbox.pendingCount, 0);
    });

    test('خطأ خادم 422 → failed (لا طابور ولا قفز إلى offline)', () async {
      final transport = _StubTransport();
      transport.payloads['/hr/workers'] = (_) => workersPayload;
      transport.errorStatus['/hr/attendance'] = 422;
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();

      final outcome =
          await cubit.recordAttendance(workerId: 'w-1', isPresent: true);

      expect(outcome, RecordAttendanceOutcome.failed);
      expect(outbox.pendingCount, 0);
      expect(cubit.state, isA<HrError>());
    });
  });

  group('findWorkerByTagId (MOB-4)', () {
    test('يطابق nfcId غير حساس لحالة الأحرف', () async {
      final transport = _StubTransport()
        ..payloads['/hr/workers'] = (_) => workersPayload;
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();

      final worker = cubit.findWorkerByTagId('04a2b3');
      expect(worker, isNotNull);
      expect(worker!['id'], 'w-1');
    });

    test('يسقط إلى مطابقة الكود', () async {
      final transport = _StubTransport()
        ..payloads['/hr/workers'] = (_) => workersPayload;
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();

      expect(cubit.findWorkerByTagId('w-002')?['id'], 'w-2');
    });

    test('لا تطابق → null، وبلا حالة محملة → null', () async {
      final transport = _StubTransport()
        ..payloads['/hr/workers'] = (_) => workersPayload;
      final cubit = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(cubit.close);
      await cubit.fetchWorkers();
      expect(cubit.findWorkerByTagId('ZZZZ'), isNull);

      final fresh = HrCubit(dio: transport.dio, cache: cache, outbox: outbox);
      addTearDown(fresh.close);
      expect(fresh.findWorkerByTagId('04A2B3'), isNull);
    });
  });
}

/// نقل وهمي: اعتراض Dio يحلّ/يرفض حسب المسار — يسجل كل طلب.
class _StubTransport {
  final List<RequestOptions> requests = <RequestOptions>[];

  /// مسارات تُحاكي انقطاع الشبكة.
  final Set<String> offlinePaths = <String>{};

  /// مسارات ترد بخطأ خادم بهذه الحالة.
  final Map<String, int> errorStatus = <String, int>{};

  /// ردود ناجحة لكل مسار.
  final Map<String, Object? Function(int index)> payloads =
      <String, Object? Function(int index)>{};

  Dio get dio {
    final instance = Dio();
    instance.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests.add(options);
          if (offlinePaths.contains(options.path)) {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.connectionError,
              ),
              true,
            );
            return;
          }
          final status = errorStatus[options.path];
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
          final index =
              requests.where((r) => r.path == options.path).length - 1;
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

/// محول تسجيل للإرسال المتأخر (drain) — يعيد 200 دائمًا.
class _DrainAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString('{"ok": true}', 200, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}
