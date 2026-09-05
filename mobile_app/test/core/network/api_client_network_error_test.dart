import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/network/api_client.dart';

/// GF-REMAINING-008: تصنيف أخطاء الشبكة المشترك — أساس حالة offline
/// في كل الشاشات. يجب أن يميّز انقطاع الاتصال عن أخطاء الخادم والعميل.
void main() {
  group('ApiClient.isNetworkError', () {
    test('connection-level Dio errors are network errors', () {
      const types = [
        DioExceptionType.connectionError,
        DioExceptionType.connectionTimeout,
        DioExceptionType.sendTimeout,
        DioExceptionType.receiveTimeout,
      ];
      for (final type in types) {
        final error = DioException(
          requestOptions: RequestOptions(path: '/inventory/raw-materials'),
          type: type,
        );
        expect(ApiClient.isNetworkError(error), isTrue,
            reason: '$type must be classified as offline');
      }
    });

    test('server and client HTTP errors are NOT network errors', () {
      for (final status in [400, 401, 403, 404, 500, 503]) {
        final error = DioException(
          requestOptions: RequestOptions(path: '/x'),
          response: Response(
            requestOptions: RequestOptions(path: '/x'),
            statusCode: status,
          ),
        );
        expect(ApiClient.isNetworkError(error), isFalse,
            reason: 'HTTP $status is a server/client error, not offline');
      }
    });

    test('cancelled requests are NOT network errors', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/x'),
        type: DioExceptionType.cancel,
      );
      expect(ApiClient.isNetworkError(error), isFalse);
    });

    test('non-Dio exceptions are NOT network errors', () {
      expect(ApiClient.isNetworkError(const FormatException('x')), isFalse);
      expect(ApiClient.isNetworkError(StateError('x')), isFalse);
    });
  });

  group('ApiClient.messageFor offline and 401 messaging', () {
    test('connection error maps to a network-aware message', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/x'),
        type: DioExceptionType.connectionError,
      );
      final message = ApiClient.instance.messageFor(error);
      expect(message, contains('تعذر الاتصال'));
    });

    test('401 maps to the session-expired message', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/x'),
        response: Response(
          requestOptions: RequestOptions(path: '/x'),
          statusCode: 401,
        ),
      );
      final message = ApiClient.instance.messageFor(error);
      expect(message, contains('انتهت الجلسة'));
    });
  });
}
