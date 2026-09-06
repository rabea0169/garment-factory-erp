import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/storage/auth_storage.dart';

/// MOB-1: تخزين رمز التحديث (refresh_token) في التخزين الآمن — نفس نمط
/// access_token — ومسح الجلسة يشملهما معًا.

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

void main() {
  late Map<String, String> store;
  late AuthStorage authStorage;

  setUp(() {
    store = <String, String>{};
    authStorage = AuthStorage(storage: _InMemorySecureStorage(store));
  });

  test('writeRefreshToken/readRefreshToken — تخزين وقراءة رمز التحديث',
      () async {
    await authStorage.writeRefreshToken('refresh-raw-96-hex-chars-value');
    expect(
      await authStorage.readRefreshToken(),
      'refresh-raw-96-hex-chars-value',
    );
    expect(
        store[AuthStorage.refreshTokenKey], 'refresh-raw-96-hex-chars-value');
  });

  test('رمز التحديث مستقل عن رمز الوصول (مفتاحان منفصلان)', () async {
    await authStorage.writeAccessToken('access-1');
    await authStorage.writeRefreshToken('refresh-1');
    expect(store[AuthStorage.accessTokenKey], 'access-1');
    expect(store[AuthStorage.refreshTokenKey], 'refresh-1');
    expect(store.length, 2);
  });

  test('deleteSession يمسح access + refresh + user معًا (MOB-1/MOB-2)',
      () async {
    await authStorage.writeAccessToken('access-1');
    await authStorage.writeRefreshToken('refresh-1');
    await authStorage.writeUser(<String, dynamic>{'id': 'u-1', 'name': 'مدير'});

    await authStorage.deleteSession();

    expect(await authStorage.readAccessToken(), isNull);
    expect(await authStorage.readRefreshToken(), isNull);
    expect(await authStorage.readUser(), isNull);
    expect(store, isEmpty);
  });

  test('readUser يرجع بيانات المستخدم كما خُزنت (JSON مسلسل)', () async {
    await authStorage
        .writeUser(<String, dynamic>{'id': 'u-1', 'role': 'SUPER_ADMIN'});
    final user = await authStorage.readUser();
    expect(user, isNotNull);
    expect(user!['id'], 'u-1');
    expect(user['role'], 'SUPER_ADMIN');
    // التخزين نص JSON مسلسل (يُفك ترميزه عبر jsonDecode عند القراءة) —
    // ليس كائن Dart خامًا ولا نصًا قابلًا للقراءة المباشرة كخريطة
    final stored = store[AuthStorage.userKey];
    expect(stored, isA<String>());
    expect(jsonDecode(stored!)['id'], 'u-1');
  });

  test('readUser لملف JSON تالف يرجع null (جلسة قديمة غير صالحة)', () async {
    store[AuthStorage.userKey] = 'not-json{{{';
    expect(await authStorage.readUser(), isNull);
  });
}
