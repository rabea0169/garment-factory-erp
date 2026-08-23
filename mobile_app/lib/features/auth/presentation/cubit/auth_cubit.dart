import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../../core/network/api_client.dart';

abstract class AuthState {}

class AuthInitial extends AuthState {}

class AuthLoading extends AuthState {}

class AuthAuthenticated extends AuthState {
  final Map<String, dynamic> user;
  AuthAuthenticated(this.user);
}

class AuthUnauthenticated extends AuthState {}

class AuthError extends AuthState {
  final String message;
  AuthError(this.message);
}

class AuthCubit extends Cubit<AuthState> {
  AuthCubit() : super(AuthInitial());

  Future<void> checkAuthStatus() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('access_token');
    
    if (token != null) {
      ApiClient.instance.dio.options.headers['Authorization'] = 'Bearer $token';
      // يمكن إضافة استدعاء لجلب بيانات المستخدم هنا
      emit(AuthAuthenticated({})); 
    } else {
      emit(AuthUnauthenticated());
    }
  }

  Future<void> login(String email, String password) async {
    emit(AuthLoading());
    try {
      final dio = ApiClient.instance.dio;
      final response = await dio.post('/auth/login', data: {
        'email': email,
        'password': password,
      });

      final token = response.data['access_token'];
      final user = response.data['user'];

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('access_token', token);
      
      ApiClient.instance.dio.options.headers['Authorization'] = 'Bearer $token';
      
      emit(AuthAuthenticated(user));
    } catch (e) {
      emit(AuthError('البريد الإلكتروني أو كلمة المرور غير صحيحة'));
    }
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('access_token');
    ApiClient.instance.dio.options.headers.remove('Authorization');
    emit(AuthUnauthenticated());
  }
}
