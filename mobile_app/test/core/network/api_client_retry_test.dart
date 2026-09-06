import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/network/api_client.dart';
import 'package:garment_factory_erp/core/storage/auth_storage.dart';

/// MOB-7: تغطية معالج retry داخل ApiClient (D5) فوق العميل الكامل
/// التركيب (تحديث الجلسة + retry) بمحول مُبرمج بلا شبكة:
/// 503 تُعاد المحاولة بنفس مفتاح الاندماجية (آمنة خادميًا — replay)،
/// حد أقصى 3 محاولات، و4xx لا تُعاد أبدًا.
///
/// ملاحظة المحاكاة: الأخطاء تُرجع ResponseBody بحالة HTTP (لا رمي
/// DioException يدويًا بـ RequestOptions جديدة) — نفس مسار dio الحقيقي،
/// لأن عداد المحاولات يُخزَّن في extra للطلب الأصلي.

/// تخزين آمن وهمي في الذاكرة — نفس توقيعات flutter_secure_storage 11.
class _InMemorySecureStorage extends FlutterSecureStorage {
  _InMemorySecureStorage(this._store);

  final Map<String, String> _store;

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async =>
      _store[key];

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (value == null) {
      _store.remove(key);
    } else {
      _store[key] = value;
    }
  }

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    _store.remove(key);
  }
}

/// محول مُبرمج: يرد بـ status متسلسل (قائمة قرارات لكل نداء) ويسجل
/// كل الطلبات الواردة مع ترويساتها.
class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter(List<int> statuses) : _statuses = List<int>.from(statuses);

  final List<int> _statuses;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    // نفدت القرارات → 200 (أو الاختبار فشل منطقيًا؛ الاحتياط يكشفه).
    final status = _statuses.length > requests.length - 1
        ? _statuses[requests.length - 1]
        : 200;
    return ResponseBody.fromString('{"ok": true}', status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  setUpAll(() {
    ApiClient.instance.init(
      authStorage: AuthStorage(
        storage: _InMemorySecureStorage(<String, String>{}),
      ),
      onUnauthorized: () {},
    );
  });

  // محول الاختبار الحالي — يُعاد إنشاؤه بكل اختبار.
  var adapter = _ScriptedAdapter(<int>[200]);

  void useStatuses(List<int> statuses) {
    adapter = _ScriptedAdapter(statuses);
    ApiClient.instance.dio.httpClientAdapter = adapter;
  }

  test('503 مرتين ثم نجاح: نفس Idempotency-Key في كل المحاولات الثلاث',
      () async {
    useStatuses([503, 503, 200]);

    final response = await ApiClient.instance.dio.post<dynamic>(
      '/sales/orders',
      data: <String, dynamic>{'customerId': 'c-1'},
    );

    expect(response.statusCode, 200);
    // 3 نداءات: الأصل + محاولتا إعادة.
    expect(adapter.requests.length, 3);

    // مفتاح الاندماجية واحد في النداءات كلها (وُلد مرة في onRequest ثم
    // حُفظ في options نفسها عبر إعادة المحاولة — replay آمن خادميًا).
    final keys = adapter.requests
        .map((r) => r.headers['Idempotency-Key']?.toString())
        .toList();
    expect(keys, isNotEmpty);
    expect(keys.every((k) => k != null && k.isNotEmpty), isTrue);
    expect(keys.toSet().length, 1);
  });

  test('503 مستمرة: حد أقصى 3 محاولات إعادة ثم الخطأ يمر', () async {
    useStatuses([503, 503, 503, 503]);

    await expectLater(
      ApiClient.instance.dio.get<dynamic>('/dashboard/stats'),
      throwsA(
        isA<DioException>().having(
          (e) => e.response?.statusCode,
          'status',
          503,
        ),
      ),
    );

    // 4 نداءات: الأصل + 3 محاولات — لا دوران بلا نهاية.
    expect(adapter.requests.length, 4);
  });

  test('4xx (404) لا تُعاد أبدًا — نداء واحد', () async {
    useStatuses([404]);

    await expectLater(
      ApiClient.instance.dio.get<dynamic>('/unknown'),
      throwsA(isA<DioException>()),
    );
    expect(adapter.requests.length, 1);
  });

  test('مفتاح يضبطه المستدعي (طابور الإرسال) يُحفظ كما هو عبر الإعادة',
      () async {
    useStatuses([503, 200]);

    final response = await ApiClient.instance.dio.post<dynamic>(
      '/hr/production',
      data: <String, dynamic>{'workerId': 'w-1', 'piecesCount': 5},
      options: Options(
        headers: <String, dynamic>{'Idempotency-Key': 'outbox-fixed-key'},
      ),
    );

    expect(response.statusCode, 200);
    expect(adapter.requests.length, 2);
    expect(
      adapter.requests.first.headers['Idempotency-Key'],
      'outbox-fixed-key',
    );
    expect(
      adapter.requests.last.headers['Idempotency-Key'],
      'outbox-fixed-key',
    );
  });
}
