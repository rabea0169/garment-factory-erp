import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../storage/auth_storage.dart';

class ApiClient {
  ApiClient._();

  static final ApiClient instance = ApiClient._();

  late final Dio _dio;
  late final AuthStorage _authStorage;
  VoidCallback? _onUnauthorized;
  bool _handlingUnauthorized = false;

  bool get isInitialized => _dioInitialized;
  bool _dioInitialized = false;

  /// يهيئ العميل مرة واحدة. يمكن تغيير العنوان عند البناء عبر:
  /// `--dart-define=API_BASE_URL=http://host:3005`.
  void init({
    AuthStorage? authStorage,
    VoidCallback? onUnauthorized,
  }) {
    if (_dioInitialized) {
      _onUnauthorized = onUnauthorized ?? _onUnauthorized;
      return;
    }

    _authStorage = authStorage ?? AuthStorage();
    _onUnauthorized = onUnauthorized;

    const configuredBaseUrl = String.fromEnvironment('API_BASE_URL');
    final baseUrl = configuredBaseUrl.isNotEmpty
        ? configuredBaseUrl
        : defaultTargetPlatform == TargetPlatform.android
            ? 'http://10.0.2.2:3005'
            : 'http://localhost:3005';

    _dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 15),
        sendTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: const {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          // لا نقرأ التوكن من SharedPreferences ولا من body؛ مصدره Keystore/Keychain.
          final token = await _authStorage.readAccessToken();
          if (token != null && token.isNotEmpty &&
              options.headers['Authorization'] == null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onResponse: (response, handler) {
          handler.next(response);
        },
        onError: (error, handler) async {
          final isLoginRequest = error.requestOptions.path == '/auth/login';
          if (error.response?.statusCode == 401 &&
              !isLoginRequest &&
              !_handlingUnauthorized) {
            _handlingUnauthorized = true;
            try {
              await clearSession();
              _onUnauthorized?.call();
            } finally {
              _handlingUnauthorized = false;
            }
          }
          handler.next(error);
        },
      ),
    );

    _dioInitialized = true;
  }

  Dio get dio => _dio;

  Future<void> clearSession() async {
    await _authStorage.deleteSession();
    if (_dioInitialized) {
      _dio.options.headers.remove('Authorization');
    }
  }

  /// Extract the canonical `data` array from a paginated API response.
  /// A raw list remains accepted temporarily for backward compatibility with
  /// endpoints that have not yet migrated.
  static List<dynamic> extractPaginatedData(dynamic payload) {
    if (payload is Map<String, dynamic> && payload['data'] is List<dynamic>) {
      return payload['data'] as List<dynamic>;
    }
    if (payload is List<dynamic>) return payload;
    throw const FormatException('استجابة قائمة غير متوافقة مع عقد Pagination');
  }

  String messageFor(Object error) {
    if (error is DioException) {
      final status = error.response?.statusCode;
      if (status == 401) return 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى';
      if (status == 403) return 'ليس لديك صلاحية لتنفيذ هذا الإجراء';
      if (error.type == DioExceptionType.connectionError ||
          error.type == DioExceptionType.connectionTimeout ||
          error.type == DioExceptionType.receiveTimeout) {
        return 'تعذر الاتصال بالخادم، تحقق من الشبكة وحاول مرة أخرى';
      }
      final serverMessage = error.response?.data;
      if (serverMessage is Map && serverMessage['message'] is String) {
        return serverMessage['message'] as String;
      }
    }
    return 'حدث خطأ غير متوقع، حاول مرة أخرى';
  }
}
