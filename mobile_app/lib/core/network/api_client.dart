import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../storage/auth_storage.dart';

class ApiClient {
  ApiClient._();

  static final ApiClient instance = ApiClient._();

  late final Dio _dio;
  late final AuthStorage _authStorage;
  VoidCallback? _onUnauthorized;
  bool _handlingUnauthorized = false;

  // D2: مولّد UUID v4 لرأس Idempotency-Key على كل POST/PUT/PATCH.
  final Uuid _uuid = const Uuid();
  // D5: عداد المحاولات الأقصى + أزمنة backoff (100ms · 200ms · 400ms).
  static const int _maxRetries = 3;
  static const List<Duration> _retryBackoff = [
    Duration(milliseconds: 100),
    Duration(milliseconds: 200),
    Duration(milliseconds: 400),
  ];

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
          // D1: لا نقرأ التوكن من SharedPreferences ولا من body؛ مصدره Keystore/Keychain.
          final token = await _authStorage.readAccessToken();
          if (token != null && token.isNotEmpty &&
              options.headers['Authorization'] == null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          // D2: Idempotency-Key على كل POST/PUT/PATCH إن لم يضبطه العميل.
          // UUID v4 (crypto-random) — يسمح للخادم بإعادة stored response عند إعادة
          // الإرسال (نفس المفتاح = نفس الـ payload = نفس النتيجة).
          final method = options.method.toUpperCase();
          if ((method == 'POST' || method == 'PUT' || method == 'PATCH') &&
              options.headers['Idempotency-Key'] == null) {
            options.headers['Idempotency-Key'] = _uuid.v4();
          }
          handler.next(options);
        },
        onResponse: (response, handler) {
          handler.next(response);
        },
        onError: (error, handler) async {
          final isLoginRequest = error.requestOptions.path == '/auth/login';
          // D4: عند 401 (وليس من /auth/login) نمسح الجلسة ونطلق redirect.
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

          // D5: Retry على 5xx + connection/timeout errors — exponential backoff.
          // لا نعيد retry على 4xx (خطأ عميل) ولا على 401 (تمت معالجته أعلاه).
          final status = error.response?.statusCode;
          final isRetryable = error.type == DioExceptionType.connectionTimeout ||
              error.type == DioExceptionType.sendTimeout ||
              error.type == DioExceptionType.receiveTimeout ||
              error.type == DioExceptionType.connectionError ||
              error.type == DioExceptionType.unknown ||
              (status != null && status >= 500 && status < 600);
          if (isRetryable && !isLoginRequest) {
            // قراءة عدد المحاولات السابق من extra — نبدأ من 0 لو غير مضبوط.
            final attempt =
                (error.requestOptions.extra['retryAttempt'] as int?) ?? 0;
            if (attempt < _maxRetries) {
              await Future<void>.delayed(_retryBackoff[attempt]);
              final retriedRequest = error.requestOptions
                ..extra['retryAttempt'] = attempt + 1;
              try {
                final response = await _dio.fetch(retriedRequest);
                handler.resolve(response);
                return;
              } on DioException catch (e) {
                handler.next(e);
                return;
              }
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
      if (status == 429) return 'تجاوزت عدد الطلبات المسموح، انتظر قليلاً';
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
