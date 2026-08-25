import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// تخزين بيانات الجلسة الحساسة في Keychain/Keystore بدل SharedPreferences.
class AuthStorage {
  AuthStorage({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  static const accessTokenKey = 'access_token';
  static const userKey = 'auth_user';

  final FlutterSecureStorage _storage;

  Future<String?> readAccessToken() => _storage.read(key: accessTokenKey);

  Future<void> writeAccessToken(String token) =>
      _storage.write(key: accessTokenKey, value: token);

  Future<void> deleteSession() async {
    await _storage.delete(key: accessTokenKey);
    await _storage.delete(key: userKey);
  }
}
