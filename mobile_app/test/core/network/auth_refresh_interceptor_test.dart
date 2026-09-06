import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/network/auth_refresh_interceptor.dart';
import 'package:garment_factory_erp/core/storage/auth_storage.dart';

/// MOB-1: اختبارات معالج 401 — تجديد الجلسة عبر /auth/refresh ثم إعادة
/// الطلب الأصلي مرة واحدة، مع mutex يمنع تحديثات متزامنة.

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

class _ScriptedResponse {
  const _ScriptedResponse(this.statusCode, this.body);

  final int statusCode;
  final String body;
}

/// محول Dio مُبرمج — يقرر الاستجابة من (المسار، ترتيب الاستدعاء للمسار نفسه)
/// ويسجل كل الطلبات الواردة. لا شبكة حقيقية إطلاقًا.
class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter(this._script, {Duration? refreshDelay})
      : _refreshDelay = refreshDelay;

  final _ScriptedResponse Function(String path, int index) _script;
  final Duration? _refreshDelay;

  final List<RequestOptions> requests = [];

  int count(String path) => requests.where((r) => r.path == path).length;

  List<RequestOptions> callsFor(String path) =>
      requests.where((r) => r.path == path).toList();

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.path;
    final index = count(path);
    requests.add(options);
    final refreshDelay = _refreshDelay;
    if (path == '/auth/refresh' && refreshDelay != null) {
      // يضمن وصول طلبات 401 المتزامنة الأخرى قبل اكتمال التجديد
      // (determinism لاختبار الـ mutex).
      await Future<void>.delayed(refreshDelay);
    }
    final response = _script(path, index);
    return ResponseBody.fromString(
      response.body,
      response.statusCode,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

const _refreshSuccessBody = '''
{"access_token": "new-access", "refresh_token": "new-refresh", "user": {"id": "u-1"}}
''';

void main() {
  late Map<String, String> store;
  late AuthStorage authStorage;

  setUp(() {
    store = <String, String>{};
    authStorage = AuthStorage(storage: _InMemorySecureStorage(store));
  });

  Dio buildDio(
    _ScriptedAdapter adapter, {
    void Function()? onSessionExpired,
  }) {
    final dio = Dio(BaseOptions(baseUrl: 'https://test.local'))
      ..httpClientAdapter = adapter;
    dio.interceptors.add(
      AuthRefreshInterceptor(
        dio: dio,
        authStorage: authStorage,
        onSessionExpired: onSessionExpired,
      ),
    );
    return dio;
  }

  Future<void> seedSession() async {
    await authStorage.writeAccessToken('expired-access');
    await authStorage.writeRefreshToken('stored-refresh');
  }

  group('MOB-1 — 401 ثم تجديد ناجح', () {
    test('401 → POST /auth/refresh → إعادة الطلب الأصلي مرة واحدة', () async {
      await seedSession();
      final adapter = _ScriptedAdapter((path, index) {
        if (path == '/auth/refresh') {
          return const _ScriptedResponse(200, _refreshSuccessBody);
        }
        if (path == '/protected') {
          return index == 0
              ? const _ScriptedResponse(401, '{}')
              : const _ScriptedResponse(200, '{"ok": true}');
        }
        throw StateError('مسار غير متوقع: $path');
      });
      final dio = buildDio(adapter);

      final response = await dio.get<dynamic>('/protected');

      expect(response.statusCode, 200);
      // الطلب الأصلي أرسل مرتين فقط: المحاولة الأولى (401) + إعادة واحدة
      expect(adapter.count('/protected'), 2);
      // طلب تجديد واحد فقط — لا حلقات
      expect(adapter.count('/auth/refresh'), 1);
      // التوكنان الجديدان خُزنا في التخزين الآمن
      expect(store[AuthStorage.accessTokenKey], 'new-access');
      expect(store[AuthStorage.refreshTokenKey], 'new-refresh');
      // إعادة الطلب استخدمت التوكن الجديد صراحة
      final retried = adapter.callsFor('/protected').last;
      expect(retried.headers['Authorization'], 'Bearer new-access');
    });

    test('التجديد أرسل refresh_token المحفوظ في جسم الطلب', () async {
      await seedSession();
      final adapter = _ScriptedAdapter((path, index) {
        if (path == '/auth/refresh') {
          return const _ScriptedResponse(200, _refreshSuccessBody);
        }
        return index == 0
            ? const _ScriptedResponse(401, '{}')
            : const _ScriptedResponse(200, '{"ok": true}');
      });
      final dio = buildDio(adapter);

      await dio.get<dynamic>('/protected');

      final refreshRequest = adapter.callsFor('/auth/refresh').single;
      expect(refreshRequest.data, isMap);
      expect(
        (refreshRequest.data as Map<dynamic, dynamic>)['refresh_token'],
        'stored-refresh',
      );
      expect(refreshRequest.method, 'POST');
    });

    test('401 ثانٍ بعد الإعادة لا يكرر التجديد — الجلسة تُمسح', () async {
      await seedSession();
      final adapter = _ScriptedAdapter((path, index) {
        if (path == '/auth/refresh') {
          return const _ScriptedResponse(200, _refreshSuccessBody);
        }
        // /protected يرجع 401 دائمًا — حتى بعد إعادة الطلب بعد التجديد
        return const _ScriptedResponse(401, '{}');
      });
      var expiredCalls = 0;
      final dio = buildDio(adapter, onSessionExpired: () => expiredCalls++);

      await expectLater(
        dio.get<dynamic>('/protected'),
        throwsA(
          isA<DioException>()
              .having((e) => e.response?.statusCode, 'status', 401),
        ),
      );

      // طلب واحد للتجديد فقط — إعادة الطلب 401 مرة ثانية لا تعيد التجديد
      expect(adapter.count('/auth/refresh'), 1);
      expect(adapter.count('/protected'), 2);
      expect(expiredCalls, 1);
      expect(store[AuthStorage.accessTokenKey], isNull);
      expect(store[AuthStorage.refreshTokenKey], isNull);
    });
  });

  group('MOB-1 — فشل التجديد', () {
    test('فشل التجديد بـ 401 → مسح الجلسة والتوجيه لتسجيل الدخول', () async {
      await seedSession();
      final adapter = _ScriptedAdapter((path, index) {
        if (path == '/auth/refresh') {
          return const _ScriptedResponse(401, '{}');
        }
        return const _ScriptedResponse(401, '{}');
      });
      var expiredCalls = 0;
      final dio = buildDio(adapter, onSessionExpired: () => expiredCalls++);

      await expectLater(
        dio.get<dynamic>('/protected'),
        throwsA(
          isA<DioException>()
              .having((e) => e.response?.statusCode, 'status', 401),
        ),
      );

      expect(expiredCalls, 1);
      // الجلسة مسحت بالكامل (access + refresh)
      expect(store[AuthStorage.accessTokenKey], isNull);
      expect(store[AuthStorage.refreshTokenKey], isNull);
      // لم يعد الطلب الأصلي — الجلسة انتهت
      expect(adapter.count('/protected'), 1);
    });

    test('لا refresh_token محفوظ → مسح الجلسة مباشرة بلا طلب تجديد', () async {
      // جلسة قديمة قبل MOB-1: access فقط بلا refresh
      await authStorage.writeAccessToken('expired-access');
      final adapter = _ScriptedAdapter(
        (path, index) => const _ScriptedResponse(401, '{}'),
      );
      var expiredCalls = 0;
      final dio = buildDio(adapter, onSessionExpired: () => expiredCalls++);

      await expectLater(
        dio.get<dynamic>('/protected'),
        throwsA(isA<DioException>()),
      );

      expect(adapter.count('/auth/refresh'), 0);
      expect(expiredCalls, 1);
      expect(store[AuthStorage.accessTokenKey], isNull);
    });

    test('فشل التجديد بخطأ غير 401 (503) → الجلسة المحلية تبقى', () async {
      await seedSession();
      final adapter = _ScriptedAdapter((path, index) {
        if (path == '/auth/refresh') {
          return const _ScriptedResponse(503, '{}');
        }
        return const _ScriptedResponse(401, '{}');
      });
      var expiredCalls = 0;
      final dio = buildDio(adapter, onSessionExpired: () => expiredCalls++);

      // الخطأ الأصلي (401) يمر كما هو
      await expectLater(
        dio.get<dynamic>('/protected'),
        throwsA(
          isA<DioException>()
              .having((e) => e.response?.statusCode, 'status', 401),
        ),
      );

      // مستخدم بلا اتصال لا يُطرد من جلسته المحلية
      expect(expiredCalls, 0);
      expect(store[AuthStorage.accessTokenKey], 'expired-access');
      expect(store[AuthStorage.refreshTokenKey], 'stored-refresh');
    });
  });

  group('MOB-1 — mutex الطلبات المتزامنة', () {
    test('طلبان متوازيان يفشلان بـ 401 → تحديث واحد فقط ويُعاد الطلبان',
        () async {
      await seedSession();
      final adapter = _ScriptedAdapter(
        (path, index) {
          if (path == '/auth/refresh') {
            return const _ScriptedResponse(200, _refreshSuccessBody);
          }
          // أول استدعاءين لـ /protected يفشلان (401) ثم النجاح بعد التجديد
          return index < 2
              ? const _ScriptedResponse(401, '{}')
              : const _ScriptedResponse(200, '{"ok": true}');
        },
        refreshDelay: const Duration(milliseconds: 40),
      );
      final dio = buildDio(adapter);

      final results = await Future.wait(
        <Future<Response<dynamic>>>[
          dio.get<dynamic>('/protected'),
          dio.get<dynamic>('/protected'),
        ],
      );

      expect(results[0].statusCode, 200);
      expect(results[1].statusCode, 200);
      // الجوهر: طلب /auth/refresh واحد فقط رغم طلبين متزامنين
      expect(adapter.count('/auth/refresh'), 1);
      // كل طلب أرسل مرتين (401 + إعادة بعد التجديد)
      expect(adapter.count('/protected'), 4);
    });
  });

  group('MOB-1 — مسارات المصادقة مستثناة', () {
    test('401 من /auth/login لا يجرّب التجديد (اعتمادات خاطئة)', () async {
      await seedSession();
      final adapter = _ScriptedAdapter(
        (path, index) => const _ScriptedResponse(401, '{"message": "خاطئة"}'),
      );
      var expiredCalls = 0;
      final dio = buildDio(adapter, onSessionExpired: () => expiredCalls++);

      await expectLater(
        dio.post<dynamic>('/auth/login', data: <String, dynamic>{
          'email': 'a@b.c',
          'password': 'x',
        }),
        throwsA(isA<DioException>()),
      );

      expect(adapter.count('/auth/refresh'), 0);
      expect(expiredCalls, 0);
      // الجلسة لم تُمسح — الخطأ من الدخول نفسه
      expect(store[AuthStorage.accessTokenKey], 'expired-access');
    });

    test('401 من /auth/refresh نفسه لا يُعالج (لا حلقة)', () async {
      await seedSession();
      final adapter = _ScriptedAdapter(
        (path, index) => const _ScriptedResponse(401, '{}'),
      );
      var expiredCalls = 0;
      final dio = buildDio(adapter, onSessionExpired: () => expiredCalls++);

      await expectLater(
        dio.post<dynamic>(
          '/auth/refresh',
          data: <String, dynamic>{'refresh_token': 'stored-refresh'},
        ),
        throwsA(isA<DioException>()),
      );

      // طلب واحد فقط — لم يحاول المعالج تجديد التجديد
      expect(adapter.count('/auth/refresh'), 1);
      expect(expiredCalls, 0);
    });
  });
}
