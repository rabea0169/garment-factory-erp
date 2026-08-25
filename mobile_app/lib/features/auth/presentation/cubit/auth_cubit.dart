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

      emit(AuthAuthenticated(<String, dynamic>{}));
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
      if (responseData is! Map || responseData['access_token'] is! String) {
        throw const FormatException('استجابة تسجيل الدخول غير صالحة');
      }

      final token = responseData['access_token'] as String;
      final user = responseData['user'];
      await _storage.writeAccessToken(token);
      _apiClient.dio.options.headers['Authorization'] = 'Bearer $token';

      emit(
        AuthAuthenticated(
          user is Map<String, dynamic>
              ? user
              : <String, dynamic>{},
        ),
      );
    } catch (error) {
      emit(AuthError(_apiClient.messageFor(error)));
    }
  }

  Future<void> logout() async {
    await _apiClient.clearSession();
    emit(AuthUnauthenticated());
  }
}
