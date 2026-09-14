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

  group('SELIM-ERP W3 — طابور موسّع (حالات/إعادة محاولة/حذف)', () {
    test('رفض الخادم 400 يعلّم العنصر فاشلًا ويمرّ للعنصر التالي', () async {
      final outbox = newOutbox();
      await outbox.init();
      adapter.statusByPath['/hr/attendance'] = 400;

      await outbox.enqueue(
        method: 'POST',
        path: '/hr/attendance',
        body: const {'workerId': 'w-1'},
        idempotencyKey: 'k-rejected',
        title: 'تسجيل حضور',
      );
      await outbox.enqueue(
        method: 'POST',
        path: '/hr/production',
        body: const {'workerId': 'w-2'},
        idempotencyKey: 'k-ok',
      );

      await outbox.drain();

      // الفاشل يبقى بعنصر واحد؛ الناجح أُرسل وحُذف.
      expect(outbox.pendingCount, 1);
      final failed = outbox.pendingEntries.single;
      expect(failed.status, OutboxStatus.failed);
      expect(failed.lastError, isNotNull);
      expect(failed.attempts, 1);
      expect(failed.title, 'تسجيل حضور');
      // طلبان أُرسلا فعليًا (الرفض لم يوقف الجولة).
      expect(adapter.paths, contains('/hr/attendance'));
      expect(adapter.paths, contains('/hr/production'));
    });

    test('فشل الشبكة يوقف الجولة (5xx يعامل كعابر)', () async {
      final outbox = newOutbox();
      await outbox.init();
      adapter.statusByPath['/hr/attendance'] = 500;

      await outbox.enqueue(
        method: 'POST',
        path: '/hr/attendance',
        body: const {},
        idempotencyKey: 'k-500',
      );
      await outbox.enqueue(
        method: 'POST',
        path: '/hr/production',
        body: const {},
        idempotencyKey: 'k-after',
      );

      await outbox.drain();

      // 5xx = عابر: العنصران يبقيان معلقين ولا يُعلّم فاشل.
      expect(outbox.pendingCount, 2);
      expect(
        outbox.pendingEntries
            .every((e) => e.status == OutboxStatus.pending),
        isTrue,
      );
      // الجولة توقفت عند أول فشل: الثاني لم يُرسل.
      expect(adapter.paths, ['/hr/attendance']);
    });

    test('retryOne ينجح بعد إصلاح الخادم ويحذف العنصر', () async {
      final outbox = newOutbox();
      await outbox.init();
      adapter.statusByPath['/pos/quick-sale'] = 400;

      final entry = await outbox.enqueue(
        method: 'POST',
        path: '/pos/quick-sale',
        body: const {'items': []},
        idempotencyKey: 'k-retry',
        isFinancial: true,
        title: 'بيع نقطة بيع',
        amount: 250,
      );
      await outbox.drain();
      expect(outbox.failedCount, 1);

      // الخادم عاد للعمل — إعادة المحاولة اليدوية تنجح.
      adapter.statusByPath.remove('/pos/quick-sale');
      final ok = await outbox.retryOne(entry!.id);
      expect(ok, isTrue);
      expect(outbox.pendingCount, 0);
      // نفس مفتاح الاندماجية أعيد إرساله (لا تكرار خادميًا).
      expect(adapter.keys, contains('k-retry'));
    });

    test('retryOne يبقي الفشل عند استمرار الرفض', () async {
      final outbox = newOutbox();
      await outbox.init();
      adapter.statusByPath['/hr/attendance'] = 400;
      final entry = await outbox.enqueue(
        method: 'POST',
        path: '/hr/attendance',
        body: const {},
        idempotencyKey: 'k-still-bad',
      );
      await outbox.drain();
      final ok = await outbox.retryOne(entry!.id);
      expect(ok, isFalse);
      expect(outbox.failedCount, 1);
      expect(outbox.pendingEntries.single.attempts, 2);
    });

    test('deleteOne يحذف الفاشل؛ clearFailed يمسح الفاشلة فقط',
        () async {
      final outbox = newOutbox();
      await outbox.init();
      // فاشل (رفض 400 يُعلّم ويمرّ) + معلق (فشل شبكة يوقف الجولة عنده —
      // يبقى معلقًا بانتظار عودة الاتصال).
      adapter.statusByPath['/a'] = 400;
      adapter.failStatusFor.add('/b');

      final failedEntry = await outbox.enqueue(
        method: 'POST',
        path: '/a',
        body: const {},
        idempotencyKey: 'k-f',
      );
      final pendingEntry = await outbox.enqueue(
        method: 'POST',
        path: '/b',
        body: const {},
        idempotencyKey: 'k-p',
      );
      await outbox.drain();
      // الصندوق: الفاشل يبقى (بقرار المستخدم) + المعلّق بانتظار الشبكة.
      // pendingCount = إجمالي الصندوق (معلّق + فاشل) — نفس دلالة اللوحة.
      expect(outbox.failedCount, 1);
      expect(outbox.pendingCount, 2);

      // حذف فردي للفاشل.
      final removed = await outbox.deleteOne(failedEntry!.id);
      expect(removed, isTrue);
      expect(outbox.pendingCount, 1);
      expect(outbox.pendingEntries.single.id, pendingEntry!.id);

      // فاشل آخر: إعادة محاولة فردية (retryOne يرسل العنصر وحده —
      // بلا مساس بترتيب الطابور ولا بالمعلّق قبله).
      adapter.statusByPath['/c'] = 400;
      final another = await outbox.enqueue(
        method: 'POST',
        path: '/c',
        body: const {},
        idempotencyKey: 'k-f2',
      );
      final retried = await outbox.retryOne(another!.id);
      expect(retried, isFalse);
      expect(outbox.failedCount, 1);

      final cleared = await outbox.clearFailed();
      expect(cleared, 1);
      // المعلّق الأصلي لم يُمس.
      expect(outbox.pendingEntries.single.id, pendingEntry.id);
    });

    test('توافق خلفي: إدخال قديم (بلا حقول W3) يُقرأ معلّقًا', () async {
      final outbox = newOutbox();
      await outbox.init();
      // حقن إدخال بصيغة ما قبل الترقية يدويًا في الصندوق.
      final box = Hive.isBoxOpen(OutboxService.boxName)
          ? Hive.box(OutboxService.boxName)
          : await Hive.openBox(OutboxService.boxName);
      await box.add(<String, dynamic>{
        'id': 'legacy-1',
        'method': 'POST',
        'path': '/hr/production',
        'body': <String, dynamic>{'piecesCount': 5},
        'idempotencyKey': 'legacy-key',
        'createdAt': DateTime.now().toIso8601String(),
      });

      final entries = outbox.pendingEntries;
      expect(entries.single.id, 'legacy-1');
      expect(entries.single.status, OutboxStatus.pending);
      expect(entries.single.isFinancial, isFalse);
      expect(entries.single.maxAttempts, OutboxService.defaultMaxAttempts);
    });
  });

  // ------------------------------------------------------------------
  group('SELIM-ERP W4 — التعارض (409) ومحلّ القرار', () {
    test('drain يعلّم عنصر 409 كتعارض (لا failed) مع بيانات الخادم', () async {
      adapter.statusByPath['/pos/orders'] = 409;
      final outbox = newOutbox();
      await outbox.init();
      await outbox.enqueue(
        method: 'POST',
        path: '/pos/orders',
        body: {'total': 100},
        idempotencyKey: 'k-conflict-1',
      );
      await outbox.drain();

      expect(outbox.pendingCount, 1);
      expect(outbox.conflictCount, 1);
      expect(outbox.failedCount, 0);
      final entry = outbox.pendingEntries.single;
      expect(entry.status, OutboxStatus.conflict);
      expect(entry.lastError, contains('تعارض'));
      expect(entry.serverData, isNotNull);
      // بيانات الخادم من جسم 409.
      expect((entry.serverData as Map)['message'], contains('الخادم'));
    });

    test('التعارض يبقى بعد جولة drain ثانية — لا إعادة إرسال تلقائية', () async {
      adapter.statusByPath['/pos/orders'] = 409;
      final outbox = newOutbox();
      await outbox.init();
      await outbox.enqueue(
        method: 'POST',
        path: '/pos/orders',
        body: {'total': 100},
        idempotencyKey: 'k-conflict-2',
      );
      await outbox.drain();
      await outbox.drain();
      // طلب واحد فقط — المتعارض لا يُعاد أبدًا تلقائيًا.
      expect(adapter.requests, hasLength(1));
      expect(outbox.conflictCount, 1);
    });

    test('retryWithFreshKey: مفتاح اندماجية جديد ونجاح يحذف العنصر', () async {
      adapter.statusByPath['/pos/orders'] = 409;
      final outbox = newOutbox();
      await outbox.init();
      final entry = await outbox.enqueue(
        method: 'POST',
        path: '/pos/orders',
        body: {'total': 100},
        idempotencyKey: 'k-conflict-3',
      );
      await outbox.drain();
      expect(outbox.conflictCount, 1);

      // الخادم يقبل الآن (لا 409) — القرار keepLocal.
      adapter.statusByPath.clear();
      final ok = await outbox.retryWithFreshKey(entry!.id);
      expect(ok, isTrue);
      expect(outbox.pendingCount, 0);
      // الطلب الثاني بمفتاح مختلف عن الأصل (keepLocal بالمرجع).
      expect(adapter.keys, isNot(contains('k-conflict-3')));
      expect(adapter.keys.last, isNot(equals(adapter.keys.first)));
    });

    test('deleteOne يحذف المتعارض (قرار اعتماد الخادم)', () async {
      adapter.statusByPath['/pos/orders'] = 409;
      final outbox = newOutbox();
      await outbox.init();
      final entry = await outbox.enqueue(
        method: 'POST',
        path: '/pos/orders',
        body: {'total': 100},
        idempotencyKey: 'k-conflict-4',
      );
      await outbox.drain();
      await outbox.deleteOne(entry!.id);
      expect(outbox.pendingCount, 0);
      expect(outbox.conflictCount, 0);
    });

    test('409 أثناء retryOne يعلّم تعارضًا بدل فشل', () async {
      final outbox = newOutbox();
      await outbox.init();
      final entry = await outbox.enqueue(
        method: 'POST',
        path: '/pos/orders',
        body: {'total': 100},
        idempotencyKey: 'k-conflict-5',
      );
      adapter.statusByPath['/pos/orders'] = 409;
      final ok = await outbox.retryOne(entry!.id);
      expect(ok, isFalse);
      expect(outbox.pendingEntries.single.status, OutboxStatus.conflict);
    });
  });

}

/// محول Dio مُبرمج: يسجل الطلبات ويعيد 200، مع مسارات تفشل بـ 500 عند
/// الطلب (لمحاكاة خادم متعثر).
class _ScriptedAdapter implements HttpClientAdapter {
  final Set<String> failStatusFor = <String>{};

  /// SELIM-ERP W3: حالة HTTP لكل مسار (400 لرفض الخادم — بجسم JSON).
  final Map<String, int> statusByPath = <String, int>{};
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
    final status = statusByPath[options.path] ??
        (failStatusFor.contains(options.path) ? 500 : 200);
    final body = status == 400
        ? '{"message": "بيانات غير صالحة"}'
        : status == 409
            ? '{"message": "تغيّرت الحالة على الخادم — تعارض"}'
            : '{"ok": true}';
    return ResponseBody.fromString(body, status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}
