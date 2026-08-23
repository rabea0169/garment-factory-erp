import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

class ApiClient {
  ApiClient._();
  
  static final ApiClient instance = ApiClient._();
  
  late final Dio _dio;
  
  void init() {
    // 10.0.2.2 is the localhost for Android emulator. 
    // Use localhost or your machine IP for iOS or Web.
    final String baseUrl = defaultTargetPlatform == TargetPlatform.android
        ? 'http://10.0.2.2:3000'
        : 'http://localhost:3000';

    _dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          // Add JWT token here later
          return handler.next(options);
        },
        onResponse: (response, handler) {
          return handler.next(response);
        },
        onError: (DioException e, handler) {
          // Handle global errors here
          return handler.next(e);
        },
      ),
    );
  }

  Dio get dio => _dio;
}
