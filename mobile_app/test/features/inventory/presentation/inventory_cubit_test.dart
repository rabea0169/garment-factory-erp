import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/inventory/presentation/cubit/inventory_cubit.dart';
import 'package:garment_factory_erp/features/inventory/presentation/cubit/inventory_state.dart';

/// GF-REMAINING-008: cubit المخزون يجب أن يصنّف انقطاع الشبكة إلى
/// [InventoryOffline] — وليس خطأً عامًا — حتى تعرض الواجهة شاشة
/// "لا يوجد اتصال" المخصصة. يُحقن Dio اعتراضًا يحلّ/يرفض دون شبكة.
void main() {
  group('InventoryCubit.fetchInventoryData', () {
    test('emits loading then loaded for valid paginated responses',
        () async {
      final cubit = InventoryCubit(dio: _stubDio());
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          isA<InventoryLoading>(),
          predicate<InventoryLoaded>((state) {
            return state.rawMaterials.length == 2 &&
                state.rawMaterials.first['code'] == 'RM-001' &&
                state.warehouses.length == 1;
          }),
        ]),
      );

      await cubit.fetchInventoryData();
      await expectation;
    });

    test('emits InventoryOffline when the connection drops', () async {
      final cubit = InventoryCubit(
        dio: _stubDio(
          rejectWith: (options) => DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ),
        ),
      );
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          isA<InventoryLoading>(),
          isA<InventoryOffline>(),
        ]),
      );

      await cubit.fetchInventoryData();
      await expectation;
    });

    test('emits InventoryError (not offline) for a server 500', () async {
      final cubit = InventoryCubit(
        dio: _stubDio(
          rejectWith: (options) => DioException(
            requestOptions: options,
            type: DioExceptionType.badResponse,
            response: Response<Object>(
              requestOptions: options,
              statusCode: 500,
              data: {'message': 'خطأ داخلي في الخادم'},
            ),
          ),
        ),
      );
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          isA<InventoryLoading>(),
          predicate<InventoryError>((state) => state.message.isNotEmpty),
        ]),
      );

      await cubit.fetchInventoryData();
      await expectation;
    });

    test('retry after offline can recover to loaded', () async {
      final dio = _stubDio(
        rejectWith: (options) => DioException(
          requestOptions: options,
          type: DioExceptionType.connectionError,
        ),
      );
      final cubit = InventoryCubit(dio: dio);
      addTearDown(cubit.close);

      await cubit.fetchInventoryData();
      expect(cubit.state, isA<InventoryOffline>());

      // الشبكة "عادت": نعيد تثبيت اعتراض ناجح على العميل نفسه.
      _reinstall(dio, rejectWith: null);
      await cubit.fetchInventoryData();
      expect(cubit.state, isA<InventoryLoaded>());
    });
  });
}

// ---------------------------------------------------------------------------
// Stub transport — اعتراض يحلّ أو يرفض دون أي شبكة
// ---------------------------------------------------------------------------

Dio _stubDio({DioException Function(RequestOptions options)? rejectWith}) {
  final dio = Dio();
  _reinstall(dio, rejectWith: rejectWith);
  return dio;
}

void _reinstall(Dio dio, {DioException Function(RequestOptions)? rejectWith}) {
  dio.interceptors.clear();
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        final reject = rejectWith;
        if (reject != null) {
          handler.reject(reject(options), true);
          return;
        }
        handler.resolve(
          Response<Object>(
            requestOptions: options,
            statusCode: 200,
            data: _payloadFor(options),
          ),
        );
      },
    ),
  );
}

Map<String, Object> _payloadFor(RequestOptions options) {
  // المسارات الأربعة ترجع شكل pagination { data: [...] }.
  final List<Map<String, Object>> items = switch (options.path) {
    '/inventory/raw-materials' => [
        {
          'id': 'rm-1',
          'code': 'RM-001',
          'name': 'قماش قطني',
          'currentStock': 150,
        },
        {
          'id': 'rm-2',
          'code': 'RM-002',
          'name': 'خيط',
          'currentStock': 80,
        },
      ],
    '/inventory/warehouses' => [
        {'id': 'wh-1', 'code': 'WH-RAW', 'name': 'مخزن الخامات'},
      ],
    _ => const <Map<String, Object>>[],
  };
  return {'data': items};
}
