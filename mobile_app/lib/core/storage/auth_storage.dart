import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// تخزين بيانات الجلسة الحساسة في Keychain/Keystore بدل SharedPreferences.
class AuthStorage {
  AuthStorage({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  static const accessTokenKey = 'access_token';
  // MOB-1: مفتاح رمز التحديث — نفس نمط access_token (نفس التخزين الآمن).
  // ضروري لدورة تجديد الجلسة عند انتهاء رمز الوصول (30 دقيقة افتراضيًا).
  static const refreshTokenKey = 'refresh_token';
  static const userKey = 'auth_user';

  final FlutterSecureStorage _storage;

  Future<String?> readAccessToken() => _storage.read(key: accessTokenKey);

  Future<void> writeAccessToken(String token) =>
      _storage.write(key: accessTokenKey, value: token);

  /// MOB-1: قراءة رمز التحديث المحفوظ — يستخدمه معالج 401 لطلب زوج توكنات
  /// جديد من POST /auth/refresh.
  Future<String?> readRefreshToken() => _storage.read(key: refreshTokenKey);

  /// MOB-1: حفظ رمز التحديث عند تسجيل الدخول أو بعد كل دوران ناجح.
  Future<void> writeRefreshToken(String token) =>
      _storage.write(key: refreshTokenKey, value: token);

  Future<Map<String, dynamic>?> readUser() async {
    final encoded = await _storage.read(key: userKey);
    if (encoded == null || encoded.isEmpty) return null;
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    } on FormatException {
      // A malformed legacy profile must not keep an invalid session alive.
    }
    return null;
  }

  Future<void> writeUser(Map<String, dynamic> user) =>
      _storage.write(key: userKey, value: jsonEncode(user));

  /// مسح الجلسة كاملة — يشمل refresh_token (MOB-1) كي لا تبقى دورة تجديد
  /// حية بعد الخروج.
  Future<void> deleteSession() async {
    await _storage.delete(key: accessTokenKey);
    await _storage.delete(key: refreshTokenKey);
    await _storage.delete(key: userKey);
  }
}
