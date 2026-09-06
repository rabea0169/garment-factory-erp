import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/storage/auth_storage.dart';

abstract class AuthState {}

class AuthInitial extends AuthState {}

class AuthLoading extends AuthState {}

class AuthAuthenticated extends AuthState {
  AuthAuthenticated(this.user);

  final Map<String, dynamic> user;
}

class AuthUnauthenticated extends AuthState {}

class AuthError extends AuthState {
  AuthError(this.message);

  final String message;
}

class AuthCubit extends Cubit<AuthState> {
  AuthCubit({AuthStorage? storage, ApiClient? apiClient})
      : _storage = storage ?? AuthStorage(),
        _apiClient = apiClient ?? ApiClient.instance,
        super(AuthInitial());

  final AuthStorage _storage;
  final ApiClient _apiClient;

  Future<void> checkAuthStatus() async {
    try {
      final token = await _storage.readAccessToken();
      if (token == null || token.isEmpty) {
        emit(AuthUnauthenticated());
        return;
      }

      final cachedUser = await _storage.readUser();
      if (cachedUser == null) {
        await _apiClient.clearSession();
        emit(AuthUnauthenticated());
        return;
      }

      try {
        final response = await _apiClient.dio.get('/auth/me');
        final responseData = response.data;
        if (responseData is! Map) {
          throw const FormatException('استجابة بيانات المستخدم غير صالحة');
        }
        final user = Map<String, dynamic>.from(responseData);
        await _storage.writeUser(user);
        emit(AuthAuthenticated(user));
      } catch (error) {
        await _apiClient.clearSession();
        emit(AuthUnauthenticated());
      }
    } catch (error) {
      await _apiClient.clearSession();
      emit(AuthUnauthenticated());
    }
  }

  Future<void> login(String email, String password) async {
    emit(AuthLoading());
    try {
      final response = await _apiClient.dio.post(
        '/auth/login',
        data: <String, dynamic>{
          'email': email.trim(),
          'password': password,
        },
      );

      final responseData = response.data;
      if (responseData is! Map ||
          responseData['access_token'] is! String ||
          // MOB-1: refresh_token جزء إلزامي من الاستجابة — بدونه لا دورة
          // تجديد للجلسة عند انتهاء رمز الوصول (30 دقيقة افتراضيًا).
          responseData['refresh_token'] is! String) {
        throw const FormatException('استجابة تسجيل الدخول غير صالحة');
      }

      final token = responseData['access_token'] as String;
      final refreshToken = responseData['refresh_token'] as String;
      final user = responseData['user'];
      if (user is! Map) {
        throw const FormatException('بيانات المستخدم غير موجودة');
      }
      final normalizedUser = Map<String, dynamic>.from(user);
      // MOB-1: نخزن التوكنين معًا — access_token وrefresh_token بنفس
      // النمط في التخزين الآمن (Keystore/Keychain) كي يتوفر رمز التحديث
      // لمعالج 401 في ApiClient.
      await _storage.writeAccessToken(token);
      await _storage.writeRefreshToken(refreshToken);
      await _storage.writeUser(normalizedUser);
      _apiClient.dio.options.headers['Authorization'] = 'Bearer $token';

      emit(AuthAuthenticated(normalizedUser));
    } catch (error) {
      emit(AuthError(_apiClient.messageFor(error)));
    }
  }

  /// MOB-2: الخروج لم يعد محليًا فقط — نبلّغ الخادم (POST /auth/logout)
  /// بأفضل جهد قبل مسح التخزين المحلي:
  /// - timeout قصير (5 ثوانٍ إرسالًا واستقبالًا) + تعطيل إعادة المحاولة
  ///   (extra['noRetry']) كي لا يعلّق الخروج على شبكة متعثرة.
  /// - أي فشل (شبكة/خادم) يُبتلع بصمت — نجاح الخروج المحلي لا يتوقف على
  ///   الخادم أبدًا، لكن نحاول إبطال رمز التحديث عنده كي لا تبقى جلسة
  ///   قابلة للتجديد على الخادم بعد خروج الجهاز.
  /// - المسح المحلي يشمل refresh_token (MOB-1) عبر deleteSession.
  Future<void> logout() async {
    final refreshToken = await _storage.readRefreshToken();
    if (refreshToken != null && refreshToken.isNotEmpty) {
      try {
        await _apiClient.dio.post(
          '/auth/logout',
          data: <String, dynamic>{'refresh_token': refreshToken},
          options: Options(
            sendTimeout: const Duration(seconds: 5),
            receiveTimeout: const Duration(seconds: 5),
            extra: const <String, dynamic>{'noRetry': true},
          ),
        );
      } catch (_) {
        // أفضل جهد: فشل الاتصال بالخادم لا يمنع الخروج المحلي أبدًا.
      }
    }
    await _apiClient.clearSession();
    emit(AuthUnauthenticated());
  }
}
