import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/inventory/presentation/cubit/inventory_cubit.dart';
import 'package:garment_factory_erp/features/inventory/presentation/cubit/inventory_state.dart';

RequestOptions _options(String path) => RequestOptions(path: path);

// فشل شبكة — نفس النوع الذي يكشفه ApiClient وmapProductionFailure.
DioException _connectionError(String path) => DioException(
      requestOptions: _options(path),
      type: DioExceptionType.connectionError,
      error: 'network unreachable',
    );

DioException _receiveTimeout(String path) => DioException(
      requestOptions: _options(path),
      type: DioExceptionType.receiveTimeout,
    );

DioException _statusError(int statusCode, Object? data) => DioException(
      requestOptions: _options('/inventory/raw-materials'),
      type: DioExceptionType.badResponse,
      response: Response(
        requestOptions: _options('/inventory/raw-materials'),
        statusCode: statusCode,
        data: data,
      ),
    );

const _material = {
  'id': 'm-1',
  'name': 'قطن مصري',
  'code': 'RM-001',
  'sku': 'SKU-COTTON-001',
  'currentStock': 40,
  'minStockLevel': 10,
  'unit': 'متر',
};

void main() {
  test('emits loading then loaded for a successful fetch', () async {
    final cubit = InventoryCubit(
      listFetcher: (path, context) async => [_material],
    );
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<InventoryLoading>(),
        predicate<InventoryLoaded>(
          (state) => state.rawMaterials.single == _material,
        ),
      ]),
    );

    await cubit.fetchInventoryData();
    await expectation;
    expect(cubit.state, isA<InventoryLoaded>());
  });

  test('maps a connection error to offline without cached data', () async {
    final cubit = InventoryCubit(
      listFetcher: (path, context) async => throw _connectionError(path),
    );
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<InventoryLoading>(),
        predicate<InventoryOffline>((state) => state.snapshot == null),
      ]),
    );

    await cubit.fetchInventoryData();
    await expectation;
    expect(cubit.state, isA<InventoryOffline>());
  });

  test('maps a receive timeout to the offline state as well', () async {
    final cubit = InventoryCubit(
      listFetcher: (path, context) async => throw _receiveTimeout(path),
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

  test('keeps the last successful snapshot when going offline', () async {
    var fail = false;
    final cubit = InventoryCubit(
      listFetcher: (path, context) async {
        if (fail) throw _connectionError(path);
        return [_material];
      },
    );
    addTearDown(cubit.close);

    // تحميل ناجح أولًا يخزّن اللقطة في الذاكرة.
    await cubit.fetchInventoryData();
    expect(cubit.state, isA<InventoryLoaded>());

    fail = true;
    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<InventoryLoading>(),
        predicate<InventoryOffline>(
          (state) => state.snapshot?.rawMaterials.single == _material,
        ),
      ]),
    );

    await cubit.fetchInventoryData();
    await expectation;
  });

  // ملاحظة 401: في التطبيق الحقيقي يعترض ApiClient الـ 401 (onError) فيمسح
  // الجلسة ويطلق onUnauthorized → AppRouter.goToLogin (موصول في main.dart).
  // الـ cubit يصنّف الحالة إلى InventoryUnauthorized فقط لعرض رسالة مناسبة.
  test('maps a 401 response to the unauthorized state', () async {
    final cubit = InventoryCubit(
      listFetcher: (path, context) async =>
          throw _statusError(401, {'message': 'Unauthorized'}),
    );
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<InventoryLoading>(),
        isA<InventoryUnauthorized>(),
      ]),
    );

    await cubit.fetchInventoryData();
    await expectation;
    expect(cubit.state, isA<InventoryUnauthorized>());
  });

  test('maps other HTTP failures to InventoryError with server message',
      () async {
    final cubit = InventoryCubit(
      listFetcher: (path, context) async =>
          throw _statusError(500, {'message': 'خطأ داخلي في الخادم'}),
    );
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<InventoryLoading>(),
        predicate<InventoryError>(
          (state) => state.message == 'خطأ داخلي في الخادم',
        ),
      ]),
    );

    await cubit.fetchInventoryData();
    await expectation;
    expect(cubit.state, isA<InventoryError>());
  });

  test('maps a 403 response to an error message without offline/unauth',
      () async {
    final cubit = InventoryCubit(
      listFetcher: (path, context) async =>
          throw _statusError(403, {'message': 'forbidden'}),
    );
    addTearDown(cubit.close);

    await cubit.fetchInventoryData();

    expect(cubit.state, isA<InventoryError>());
    expect(
      (cubit.state as InventoryError).message,
      'ليس لديك صلاحية لتنفيذ هذا الإجراء',
    );
  });
}
