import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/network/api_client.dart';
import 'package:garment_factory_erp/core/storage/auth_storage.dart';
import 'package:garment_factory_erp/features/auth/presentation/cubit/auth_cubit.dart';

/// MOB-1 + MOB-2: اختبارات AuthCubit عبر ApiClient كامل التركيب
/// (AuthRefreshInterceptor + retry) مع محول HTTP مُبرمج بلا شبكة حقيقية.

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

/// محول Dio مُبرمج — يقرر الاستجابة من (المسار، ترتيب الاستدعاء للمسار نفسه).
class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter(this._script);

  final _ScriptedResponse Function(String path, int index) _script;

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

const _loginSuccessBody = '''
{"access_token": "access-1", "refresh_token": "refresh-1", "user": {"id": "u-1", "name": "مدير", "role": "SUPER_ADMIN"}}
''';

void main() {
  late Map<String, String> store;
  late AuthStorage authStorage;
  late _ScriptedAdapter adapter;

  setUpAll(() {
    store = <String, String>{};
    authStorage = AuthStorage(storage: _InMemorySecureStorage(store));
    // تهيئة واحدة للعميل الكامل — نفس ما يحدث في main.dart
    ApiClient.instance.init(
      authStorage: authStorage,
      onUnauthorized: () {},
    );
  });

  setUp(() {
    // عزل بين الاختبارات: جلسة نظيفة + محول جديد
    store.clear();
    adapter = _ScriptedAdapter(
      (path, index) => throw StateError('مسار غير متوقع: $path'),
    );
    ApiClient.instance.dio.httpClientAdapter = adapter;
    ApiClient.instance.dio.options.headers.remove('Authorization');
  });

  Future<void> seedSession() async {
    await authStorage.writeAccessToken('expired-access');
    await authStorage.writeRefreshToken('stored-refresh');
    await authStorage.writeUser(<String, dynamic>{'id': 'u-1', 'name': 'مدير'});
  }

  group('MOB-1 — login يخزن التوكنين', () {
    test('الدخول الناجح يخزن access_token وrefresh_token معًا', () async {
      adapter = _ScriptedAdapter(
        (path, index) => const _ScriptedResponse(200, _loginSuccessBody),
      );
      ApiClient.instance.dio.httpClientAdapter = adapter;

      final cubit =
          AuthCubit(storage: authStorage, apiClient: ApiClient.instance);
      addTearDown(cubit.close);
      // نمط المستودع (production_cubit_test): نبني توقع البث قبل استدعاء
      // الدالة — بث Cubit broadcast لا يعيد بث الأحداث الماضية لمشترك لاحق.
      final expectation = expectLater(
        cubit.stream,
        emitsThrough(isA<AuthAuthenticated>()),
      );
      await cubit.login('admin@factory.com', 'Pass@123');
      await expectation;
      expect(store[AuthStorage.accessTokenKey], 'access-1');
      expect(store[AuthStorage.refreshTokenKey], 'refresh-1');
      expect(
        (await authStorage.readUser())?['id'],
        'u-1',
      );
      // نمط login القائم: ترويسة Authorization الافتراضية محدثة
      expect(
        ApiClient.instance.dio.options.headers['Authorization'],
        'Bearer access-1',
      );
    });

    test('استجابة دخول بلا refresh_token ترفض ولا تخزن شيئًا', () async {
      adapter = _ScriptedAdapter(
        (path, index) => const _ScriptedResponse(
          200,
          '{"access_token": "a", "user": {"id": "u-1"}}',
        ),
      );
      ApiClient.instance.dio.httpClientAdapter = adapter;

      final cubit =
          AuthCubit(storage: authStorage, apiClient: ApiClient.instance);
      addTearDown(cubit.close);
      final expectation = expectLater(
        cubit.stream,
        emitsThrough(isA<AuthError>()),
      );
      await cubit.login('admin@factory.com', 'Pass@123');
      await expectation;
      expect(store[AuthStorage.accessTokenKey], isNull);
      expect(store[AuthStorage.refreshTokenKey], isNull);
    });
  });

  group('MOB-2 — logout بأفضل جهد', () {
    test('الخروج يستدعي /auth/logout ثم يمسح المحلي حتى لو فشل الطلب (500)',
        () async {
      await seedSession();
      adapter = _ScriptedAdapter((path, index) {
        if (path == '/auth/logout') {
          return const _ScriptedResponse(500, '{}');
        }
        throw StateError('مسار غير متوقع: $path');
      });
      ApiClient.instance.dio.httpClientAdapter = adapter;

      final cubit =
          AuthCubit(storage: authStorage, apiClient: ApiClient.instance);
      addTearDown(cubit.close);
      final expectation = expectLater(
        cubit.stream,
        emitsThrough(isA<AuthUnauthenticated>()),
      );
      await cubit.logout();
      await expectation;

      // استدعاء الخادم حدث فعلًا — وبرمز التحديث في الجسم
      expect(adapter.count('/auth/logout'), 1);
      final logoutRequest = adapter.callsFor('/auth/logout').single;
      expect(logoutRequest.method, 'POST');
      expect(
        (logoutRequest.data as Map<dynamic, dynamic>)['refresh_token'],
        'stored-refresh',
      );
      // noRetry: فشل 500 لا يُعاد (بدونه لصارت 4 محاولات ببطء backoff)
      expect(adapter.requests.length, 1);
      // المسح المحلي حدث رغم فشل الخادم — الجلسة كلها (توكنان + مستخدم)
      expect(store[AuthStorage.accessTokenKey], isNull);
      expect(store[AuthStorage.refreshTokenKey], isNull);
      expect(await authStorage.readUser(), isNull);
    });

    test('الخروج الناجح على الخادم يمسح المحلي أيضًا', () async {
      await seedSession();
      adapter = _ScriptedAdapter((path, index) {
        if (path == '/auth/logout') {
          return const _ScriptedResponse(200, '{"revoked": true}');
        }
        throw StateError('مسار غير متوقع: $path');
      });
      ApiClient.instance.dio.httpClientAdapter = adapter;

      final cubit =
          AuthCubit(storage: authStorage, apiClient: ApiClient.instance);
      addTearDown(cubit.close);
      final expectation = expectLater(
        cubit.stream,
        emitsThrough(isA<AuthUnauthenticated>()),
      );
      await cubit.logout();
      await expectation;

      expect(adapter.count('/auth/logout'), 1);
      expect(store[AuthStorage.refreshTokenKey], isNull);
    });

    test('لا رمز تحديث محفوظ → لا استدعاء خادم والمسح المحلي يتم', () async {
      await authStorage.writeAccessToken('access-only');
      adapter = _ScriptedAdapter(
        (path, index) => throw StateError('يجب ألا يُستدعى الخادم: $path'),
      );
      ApiClient.instance.dio.httpClientAdapter = adapter;

      final cubit =
          AuthCubit(storage: authStorage, apiClient: ApiClient.instance);
      addTearDown(cubit.close);
      final expectation = expectLater(
        cubit.stream,
        emitsThrough(isA<AuthUnauthenticated>()),
      );
      await cubit.logout();
      await expectation;

      expect(adapter.requests, isEmpty);
      expect(store[AuthStorage.accessTokenKey], isNull);
    });
  });

  group('MOB-1 — التكامل مع ApiClient (401 → refresh → retry)', () {
    test('انتهاء access أثناء /auth/me يجدد الجلسة ويكمل الطلب', () async {
      await seedSession();
      adapter = _ScriptedAdapter((path, index) {
        if (path == '/auth/refresh') {
          return const _ScriptedResponse(
            200,
            '{"access_token": "new-access", "refresh_token": "new-refresh", "user": {"id": "u-1"}}',
          );
        }
        if (path == '/auth/me') {
          // 401 أولًا (توكن منتهٍ) ثم نجاح بعد التجديد
          return index == 0
              ? const _ScriptedResponse(401, '{}')
              : const _ScriptedResponse(200, '{"id": "u-1", "name": "مدير"}');
        }
        throw StateError('مسار غير متوقع: $path');
      });
      ApiClient.instance.dio.httpClientAdapter = adapter;

      final cubit =
          AuthCubit(storage: authStorage, apiClient: ApiClient.instance);
      addTearDown(cubit.close);
      final expectation = expectLater(
        cubit.stream,
        emitsThrough(isA<AuthAuthenticated>()),
      );
      await cubit.checkAuthStatus();
      await expectation;

      // دورة كاملة: me (401) → refresh → me (200)
      expect(adapter.count('/auth/refresh'), 1);
      expect(adapter.count('/auth/me'), 2);
      expect(store[AuthStorage.accessTokenKey], 'new-access');
      expect(store[AuthStorage.refreshTokenKey], 'new-refresh');
    });
  });
}
