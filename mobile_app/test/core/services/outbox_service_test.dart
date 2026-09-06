import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';

import 'package:garment_factory_erp/core/services/outbox_service.dart';

/// MOB-3: طابور الكتابة الصادر (Outbox) — إدراج/إرسال FIFO عند عودة
/// الاتصال/إبقاء عند الفشل — بصندوق Hive حقيقي وعميل Dio مُبرمج.
void main() {
  late Directory tempDir;
  late _ScriptedAdapter adapter;
  late Dio dio;

  setUpAll(() async {
    tempDir = await Directory.systemTemp.createTemp('gf_outbox_test_');
    Hive.init(tempDir.path);
  });

  tearDownAll(() async {
    await Hive.close();
    await tempDir.delete(recursive: true);
  });

  setUp(() async {
    if (Hive.isBoxOpen(OutboxService.boxName)) {
      await Hive.box(OutboxService.boxName).clear();
    }
    adapter = _ScriptedAdapter();
    dio = Dio(BaseOptions(baseUrl: 'https://erp.test'))
      ..httpClientAdapter = adapter;
  });

  OutboxService newOutbox() {
    final outbox = OutboxService(dio: dio);
    return outbox;
  }

  group('enqueue', () {
    test('يدرج العملية بالحقول كاملة ويعلن التغيير', () async {
      final outbox = newOutbox();
      await outbox.init();

      var notifications = 0;
      outbox.addListener(() => notifications++);

      final entry = await outbox.enqueue(
        method: 'POST',
        path: '/hr/production',
        body: {'workerId': 'w-1', 'piecesCount': 12},
        idempotencyKey: 'key-1',
      );

      expect(entry, isNotNull);
      expect(entry!.method, 'POST');
      expect(entry.path, '/hr/production');
      expect(entry.body, {'workerId': 'w-1', 'piecesCount': 12});
      expect(entry.idempotencyKey, 'key-1');
      expect(outbox.pendingCount, 1);
      expect(notifications, 1);
      // الحقول محفوظة عبر Hive كما هي.
      expect(outbox.pendingEntries.single.idempotencyKey, 'key-1');
      expect(
        outbox.pendingEntries.single.body['workerId'],
        'w-1',
      );
    });

    test('idempotencyKey يُولَّد عند عدم تمريره', () async {
      final outbox = newOutbox();
      await outbox.init();
      final entry = await outbox.enqueue(
        method: 'POST',
        path: '/hr/production',
        body: const {},
      );
      expect(entry!.idempotencyKey, isNotEmpty);
    });
  });

  group('drain — FIFO', () {
    test('يرسل بالترتيب الزمني ويمحو المُرسل', () async {
      final outbox = newOutbox();
      await outbox.init();
      await outbox.enqueue(
          method: 'POST', path: '/first', body: {'n': 1}, idempotencyKey: 'k1');
      await outbox.enqueue(
          method: 'POST',
          path: '/second',
          body: {'n': 2},
          idempotencyKey: 'k2');
      await outbox.enqueue(
          method: 'POST', path: '/third', body: {'n': 3}, idempotencyKey: 'k3');

      await outbox.drain();

      // FIFO: ترتيب الإدراج نفسه.
      expect(adapter.paths, ['/first', '/second', '/third']);
      // نفس مفاتيح الاندماجية الأصلية — لا توليد جديد عند الإرسال.
      expect(adapter.keys, ['k1', 'k2', 'k3']);
      // كل طلب POST بجسمه الصحيح.
      expect(adapter.requests.first.data, {'n': 1});
      expect(adapter.requests.first.method, 'POST');
      expect(outbox.pendingCount, 0);
      expect(outbox.pendingEntries, isEmpty);
    });

    test('فشل أول عنصر يوقف الجولة ويُبقي الكل', () async {
      final outbox = newOutbox();
      await outbox.init();
      await outbox.enqueue(
          method: 'POST', path: '/boom', body: {'n': 1}, idempotencyKey: 'k1');
      await outbox.enqueue(
          method: 'POST', path: '/after', body: {'n': 2}, idempotencyKey: 'k2');

      adapter.failStatusFor.add('/boom');
      await outbox.drain();

      // توقف عند أول فشل: الثاني لم يُحاول (ترتيب FIFO محفوظ).
      expect(adapter.paths, ['/boom']);
      expect(outbox.pendingCount, 2);
      expect(outbox.pendingEntries.map((e) => e.path), ['/boom', '/after']);
    });

    test('نجاح لاحق بعد فشل سابق يمحو العناصر', () async {
      final outbox = newOutbox();
      await outbox.init();
      await outbox.enqueue(
          method: 'POST', path: '/boom', body: {'n': 1}, idempotencyKey: 'k1');
      adapter.failStatusFor.add('/boom');
      await outbox.drain();
      expect(outbox.pendingCount, 1);

      // الشبكة "عادت": نفس المفتاح يُرسل مجددًا وينجح.
      adapter.failStatusFor.clear();
      await outbox.drain();

      expect(adapter.paths, ['/boom', '/boom']);
      expect(adapter.keys, ['k1', 'k1']);
      expect(outbox.pendingCount, 0);
    });

    test('drain بصندوق فارغ no-op', () async {
      final outbox = newOutbox();
      await outbox.init();
      await outbox.drain();
      expect(adapter.requests, isEmpty);
      expect(outbox.pendingCount, 0);
    });

    test('النجاح أثناء drain يعلن التغيير لكل عنصر', () async {
      final outbox = newOutbox();
      await outbox.init();
      var notifications = 0;
      outbox.addListener(() => notifications++);
      await outbox.enqueue(
          method: 'POST', path: '/a', body: {'n': 1}, idempotencyKey: 'k1');
      await outbox.enqueue(
          method: 'POST', path: '/b', body: {'n': 2}, idempotencyKey: 'k2');

      await outbox.drain();
      // واحد للإدراج الأول + إدراج + حذفين.
      expect(notifications, 4);
    });
  });

  group('bindConnectivity', () {
    test('عودة الاتصال ترسل المعلّق تلقائيًا', () async {
      final outbox = newOutbox();
      await outbox.init();
      await outbox.enqueue(
          method: 'POST',
          path: '/queued',
          body: {'n': 1},
          idempotencyKey: 'k1');

      final controller = StreamController<bool>.broadcast();
      addTearDown(controller.close);
      // نبدأ غير متصلين: لا إرسال عند الربط.
      outbox.bindConnectivity(controller.stream, isOnlineNow: false);
      expect(adapter.requests, isEmpty);

      // عودة الاتصال → إرسال تلقائي.
      controller.add(true);
      await pumpEventQueue();
      await Future<void>.delayed(Duration.zero);
      expect(adapter.paths, ['/queued']);
      expect(outbox.pendingCount, 0);
    });

    test('الربط أثناء الاتصال يرسل المعلّق فورًا', () async {
      final outbox = newOutbox();
      await outbox.init();
      await outbox.enqueue(
          method: 'POST',
          path: '/queued',
          body: {'n': 1},
          idempotencyKey: 'k1');

      final controller = StreamController<bool>.broadcast();
      addTearDown(controller.close);
      outbox.bindConnectivity(controller.stream, isOnlineNow: true);
      await pumpEventQueue();
      await Future<void>.delayed(Duration.zero);
      expect(adapter.paths, ['/queued']);
      expect(outbox.pendingCount, 0);
    });
  });

  test('dispose يلغي الاشتراك دون أثر', () async {
    final outbox = newOutbox();
    await outbox.init();
    final controller = StreamController<bool>.broadcast();
    outbox.bindConnectivity(controller.stream);
    outbox.dispose();
    await controller.close();
  });
}

/// محول Dio مُبرمج: يسجل الطلبات ويعيد 200، مع مسارات تفشل بـ 500 عند
/// الطلب (لمحاكاة خادم متعثر).
class _ScriptedAdapter implements HttpClientAdapter {
  final Set<String> failStatusFor = <String>{};
  final List<RequestOptions> requests = <RequestOptions>[];

  List<String> get paths => requests.map((r) => r.path).toList(growable: false);

  List<String> get keys => requests
      .map((r) => r.headers['Idempotency-Key']?.toString() ?? '')
      .toList(growable: false);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final status = failStatusFor.contains(options.path) ? 500 : 200;
    return ResponseBody.fromString('{"ok": true}', status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}
