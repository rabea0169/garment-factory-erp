import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:garment_factory_erp/features/production/data/datasources/production_remote_data_source.dart';

class _RecordingAdapter implements HttpClientAdapter {
  RequestOptions? requestOptions;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requestOptions = options;
    return ResponseBody.fromString(
      jsonEncode({
        'workOrderId': '123e4567-e89b-12d3-a456-426614174000',
        'stage': 'CUTTING',
        'status': 'COMPLETED',
      }),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  test('يرسل Idempotency-Key عند تسجيل مخرجات المرحلة', () async {
    final adapter = _RecordingAdapter();
    final dio = Dio()..httpClientAdapter = adapter;
    final dataSource = ProductionRemoteDataSource(dio);

    await dataSource.recordStageOutput(
      workOrderId: '123e4567-e89b-12d3-a456-426614174000',
      stage: 'CUTTING',
      inputQty: 10,
      acceptedQty: 8,
      rejectedQty: 1,
      wasteQty: 1,
      idempotencyKey: 'idem-production-1',
    );

    expect(
      adapter.requestOptions?.headers['Idempotency-Key'],
      'idem-production-1',
    );
  });
}
