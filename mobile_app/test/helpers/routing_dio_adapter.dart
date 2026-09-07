import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// مُوجّه طلبات Dio لاختبارات الـ widget — يخدم استجابات مبرمجة مسبقًا
/// حسب 'METHOD path' ويسجل كل طلب (المسار/الاستعلام/الحمولة) للتحقق
/// اللاحق بعدها، بدل ضرب شبكة حقيقية أو ApiClient المشترك.
class RoutingDioAdapter implements HttpClientAdapter {
  RoutingDioAdapter(this.routes);

  /// مفتاح 'GET /products' مثلًا → معالج يعيد الحمولة (JSON-encodable)
  /// أو يرمي DioException لمحاكاة أخطاء الخادم.
  final Map<String, RouteHandler> routes;

  /// كل الطلبات التي مرّت عبر المهايئ — بترتيب الوصول.
  final List<RecordedRequest> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final handler = routes['${options.method} ${options.path}'];
    final payload = handler == null
        ? throw StateError(
            'لا يوجد مسار مبرمج لـ ${options.method} ${options.path}',
          )
        : await handler(options);
    requests.add(
      RecordedRequest(
        method: options.method,
        path: options.path,
        queryParameters: Map<String, dynamic>.from(options.queryParameters),
        // data هنا قبل ترميز JSON — خريطة/قائمة كما بناها الاستدعاء.
        data: options.data,
      ),
    );
    return ResponseBody.fromString(
      jsonEncode(payload ?? const <String, Object?>{}),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  /// آخر طلب بالطريقة والمسار المحددين أو null.
  RecordedRequest? lastRequest(String method, String path) {
    for (final request in requests.reversed) {
      if (request.method == method && request.path == path) return request;
    }
    return null;
  }

  @override
  void close({bool force = false}) {}
}

typedef RouteHandler = Future<Object?> Function(RequestOptions options);

/// طلب مُسجّل — الاستعلامات والحمولة كما أرسلها التطبيق.
class RecordedRequest {
  const RecordedRequest({
    required this.method,
    required this.path,
    required this.queryParameters,
    required this.data,
  });

  final String method;
  final String path;
  final Map<String, dynamic> queryParameters;
  final Object? data;

  Map<String, dynamic> get dataAsMap =>
      data is Map ? Map<String, dynamic>.from(data as Map) : const {};
}

/// استجابة خادم خاطئة من مُوجّه الاختبار — يرميها المعالج كـ DioException
/// خادمة (خريطة الرسائل كما يرسلها NestJS) لتمر عبر mapProductionFailure.
DioException fakeServerError(
  RequestOptions options,
  int status,
  String message,
) {
  return DioException.badResponse(
    statusCode: status,
    requestOptions: options,
    response: Response<dynamic>(
      requestOptions: options,
      statusCode: status,
      data: {'message': message},
    ),
  );
}

/// Dio تجريبي فوق [RoutingDioAdapter].
Dio buildTestDio(RoutingDioAdapter adapter) {
  return Dio(BaseOptions(baseUrl: 'https://erp.test'))
    ..httpClientAdapter = adapter;
}
