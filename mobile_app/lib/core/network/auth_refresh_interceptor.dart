import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../storage/auth_storage.dart';

/// نتيجة محاولة تجديد الجلسة عبر POST /auth/refresh.
enum RefreshSessionResult {
  /// نجح التجديد وخُزّن زوج التوكنات الجديد — أعِد الطلب الأصلي.
  success,

  /// فشل التجديد بـ 401 (رمز التحديث ملغى/منتهٍ أو غير محفوظ) —
  /// أمسح الجلسة ووجّه لتسجيل الدخول.
  sessionExpired,

  /// تعذر الوصول للتجديد (خطأ شبكة/خادم) — أبقِ الجلسة كما هي
  /// ومرّر خطأ 401 الأصلي؛ قد يكون المستخدم بلا اتصال مؤقتًا.
  unavailable,
}

/// MOB-1: معالج 401 يجرّب تجديد الجلسة عبر POST /auth/refresh بآخر
/// refresh_token محفوظ في التخزين الآمن، ثم يعيد الطلب الأصلي مرة واحدة.
///
/// - **Mutex/طابور**: تحديث واحد فقط في اللحظة — الطلبات المتزامنة التي
///   تصادف 401 تنتظر التحديث الجاري نفسه عبر Completer مشترك، فلا تُرسل
///   طلبات refresh متعددة بالتوازي (دوران SEC-F04 على الخادم يلغي الرمز
///   عند أول استخدام ناجح فأي refresh موازٍ سيفشل ويُبطل العائلة).
/// - **إعادة الطلب مرة واحدة**: الطلب المُعاد يوسم بعلامة داخل extra كي
///   لا يعالج 401 مرة أخرى (منع الحلقات).
/// - **فشل التجديد بـ 401**: مسح الجلسة والتوجيه لتسجيل الدخول — نفس سلوك
///   D4 السابق. فشل الشبكة لا يمسح الجلسة (المستخدم غير متصل).
/// - مسارات /auth/login و /auth/refresh و /auth/logout مستثناة: 401 منها
///   ليس انتهاء جلسة بل نتيجة اعتمادات خاطئة.
class AuthRefreshInterceptor extends Interceptor {
  AuthRefreshInterceptor({
    required Dio dio,
    required AuthStorage authStorage,
    VoidCallback? onSessionExpired,
    Future<void> Function()? clearSession,
  })  : _dio = dio,
        _authStorage = authStorage,
        _onSessionExpired = onSessionExpired,
        // الافتراضي: نفس سلوك ApiClient.clearSession القائم
        _clearSession =
            clearSession ?? (() => _defaultClearSession(dio, authStorage));

  final Dio _dio;
  final AuthStorage _authStorage;
  final VoidCallback? _onSessionExpired;
  final Future<void> Function() _clearSession;

  /// الافتراضي عند عدم تمرير [clearSession] — نفس منطق ApiClient.clearSession
  /// التاريخي: مسح الجلسة من التخزين الآمن + إزالة رأس Authorization الافتراضي.
  static Future<void> _defaultClearSession(
    Dio dio,
    AuthStorage authStorage,
  ) async {
    await authStorage.deleteSession();
    dio.options.headers.remove('Authorization');
  }

  /// علامة "أُعيد بالفعل بعد تجديد ناجح" — تمنع معالجة 401 مرتين لنفس الطلب.
  static const _retriedAfterRefreshKey = 'retriedAfterTokenRefresh';

  /// Completer التحديث الجاري — هو الـ mutex نفسه.
  Completer<RefreshSessionResult>? _refreshCompleter;

  /// يمنع مسح الجلسة/التوجيه المتكرر لطلبات متزامنة فشل تجديدها معًا.
  bool _handlingSessionExpiry = false;

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final options = err.requestOptions;
    final status = err.response?.statusCode;
    final isAuthPath = options.path == '/auth/login' ||
        options.path == '/auth/refresh' ||
        options.path == '/auth/logout';
    final alreadyRetried = options.extra[_retriedAfterRefreshKey] == true;

    // 401 من مسارات المصادقة نفسها ليس انتهاء جلسة — ولا نعيد المحاولة
    // لطلب أُعيد بالفعل بعد تجديد ناجح (الجلسة ميتة فعلًا حينها).
    if (status != 401 || isAuthPath) {
      handler.next(err);
      return;
    }

    if (alreadyRetried) {
      await _handleSessionExpired();
      handler.next(err);
      return;
    }

    final result = await _refreshSession();

    switch (result) {
      case RefreshSessionResult.success:
        final newAccessToken = await _authStorage.readAccessToken();
        if (newAccessToken != null && newAccessToken.isNotEmpty) {
          options.extra[_retriedAfterRefreshKey] = true;
          // التوكن الجديد صراحةً — قد يظل رأس الطلب القديم محتفظًا
          // بالتوكن المنتهي لأن onRequest لا يلامس رأسًا موجودًا.
          options.headers['Authorization'] = 'Bearer $newAccessToken';
          try {
            // إعادة الطلب الأصلي مرة واحدة فقط — يمر عبر الـ interceptors
            // كطلب جديد (رأس Idempotency-Key نفسه يُعاد استخدامه فتُعد
            // إعادة إرسال آمنة الخصائص).
            final response = await _dio.fetch(options);
            handler.resolve(response);
            return;
          } on DioException catch (retryError) {
            handler.next(retryError);
            return;
          }
        }
        await _handleSessionExpired();
        handler.next(err);
        return;
      case RefreshSessionResult.sessionExpired:
        // التجديد مات (401 من /auth/refresh أو لا رمز محفوظ) — نمسح
        // الجلسة ونوجّه لتسجيل الدخول كما كان سلوك D4.
        await _handleSessionExpired();
        handler.next(err);
        return;
      case RefreshSessionResult.unavailable:
        // تعذر الوصول للخادم — الجلسة المحلية تبقى؛ الخطأ الأصلي يمر.
        handler.next(err);
        return;
    }
  }

  /// يجرّب تجديد الجلسة مرة واحدة على الأكثر بالتوازي — بقية المتصلين
  /// المتزامنين ينتظرون النتيجة نفسها (mutex + طابور انتظار).
  Future<RefreshSessionResult> _refreshSession() {
    final inFlight = _refreshCompleter;
    if (inFlight != null) {
      return inFlight.future;
    }

    final completer = Completer<RefreshSessionResult>();
    _refreshCompleter = completer;
    unawaited(_performRefresh(completer));
    return completer.future;
  }

  Future<void> _performRefresh(
    Completer<RefreshSessionResult> completer,
  ) async {
    try {
      final refreshToken = await _authStorage.readRefreshToken();
      if (refreshToken == null || refreshToken.isEmpty) {
        // لا رمز تحديث محفوظ (جلسة قديمة قبل MOB-1) → دخول من جديد.
        completer.complete(RefreshSessionResult.sessionExpired);
        return;
      }
      try {
        final response = await _dio.post<Map<String, dynamic>>(
          '/auth/refresh',
          data: <String, dynamic>{'refresh_token': refreshToken},
        );
        final data = response.data;
        final accessToken = data?['access_token'];
        final newRefreshToken = data?['refresh_token'];
        if (accessToken is! String ||
            accessToken.isEmpty ||
            newRefreshToken is! String ||
            newRefreshToken.isEmpty) {
          completer.complete(RefreshSessionResult.sessionExpired);
          return;
        }
        // نجاح: خزّن زوج التوكنات الجديد (نفس نمط حفظ access_token)
        // وحدّث رأس Dio الافتراضي كنمط login في AuthCubit.
        await _authStorage.writeAccessToken(accessToken);
        await _authStorage.writeRefreshToken(newRefreshToken);
        _dio.options.headers['Authorization'] = 'Bearer $accessToken';
        completer.complete(RefreshSessionResult.success);
      } on DioException catch (error) {
        if (error.response?.statusCode == 401) {
          // رمز التحديث مرفوض — الجلسة انتهت فعلًا.
          completer.complete(RefreshSessionResult.sessionExpired);
        } else {
          // شبكة/خادم — لا نطرد مستخدمًا غير متصل.
          completer.complete(RefreshSessionResult.unavailable);
        }
      }
    } catch (_) {
      completer.complete(RefreshSessionResult.unavailable);
    } finally {
      _refreshCompleter = null;
    }
  }

  Future<void> _handleSessionExpired() async {
    if (_handlingSessionExpiry) {
      return; // طلب متزامن آخر يتكفل بالمسح والتوجيه — مرة واحدة تكفي
    }
    _handlingSessionExpiry = true;
    try {
      await _clearSession();
      _onSessionExpired?.call();
    } finally {
      _handlingSessionExpiry = false;
    }
  }
}
