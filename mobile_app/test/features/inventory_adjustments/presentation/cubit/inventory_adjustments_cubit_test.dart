import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/inventory_adjustments/presentation/cubit/inventory_adjustments_cubit.dart';

/// InventoryAdjustmentsCubit — عقود الاستجابات الخادمية الحرفية:
///  - GET /inventory-adjustments → {items, total, page, limit, pages} مع
///    warehouse/createdBy/approvedBy النحيفة و_count.items.
///  - status يمرر كمرشح استعلام (الطلب المفلتر يعيد حالة واحدة)؛ عدادات
///    الشرائح من طلب ثانٍ بلا مرشح (نمط list+stats).
///  - POST /:id/approve و POST /:id/reject {reason} و DELETE /:id (DRAFT
///    فقط) — كلها تتبعها إعادة جلب.
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  Map<String, dynamic> adjustment({
    required String id,
    required String code,
    required String status,
    String? rejectedReason,
  }) =>
      <String, dynamic>{
        'id': id,
        'code': code,
        'warehouseId': 'wh-1',
        'date': '2026-09-06T00:00:00.000Z',
        'status': status,
        'notes': 'جرد ربع سنوي',
        'rejectedReason': rejectedReason,
        'createdById': 'user-1',
        'approvedById': status == 'APPROVED' ? 'user-2' : null,
        'approvedAt': status == 'APPROVED' ? '2026-09-07T09:00:00.000Z' : null,
        'createdAt': '2026-09-06T08:00:00.000Z',
        'warehouse': {'id': 'wh-1', 'code': 'WH-RAW', 'name': 'مخزن الخامات الرئيسي'},
        'createdBy': {'id': 'user-1', 'name': 'أمين المخزن'},
        'approvedBy': status == 'APPROVED'
            ? {'id': 'user-2', 'name': 'المدير العام'}
            : null,
        '_count': {'items': 3},
      };

  final allAdjustments = [
    adjustment(id: 'adj-1', code: 'ADJ-0001', status: 'DRAFT'),
    adjustment(id: 'adj-2', code: 'ADJ-0002', status: 'APPROVED'),
    adjustment(id: 'adj-3', code: 'ADJ-0003', status: 'REJECTED',
        rejectedReason: 'أعيد الجرد ووُجد تطابق'),
  ];

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/inventory-adjustments' =>
          // الطلب المفلتر يعيد الحالة المطلوبة فقط (سلوك الخادم الحرفي)؛
          // طلب العدادات بلا status يعيدها كلها.
          options.queryParameters['status'] == null
              ? <String, dynamic>{
                  'items': allAdjustments,
                  'total': 3,
                  'page': 1,
                  'limit': 100,
                  'pages': 1,
                }
              : <String, dynamic>{
                  'items': allAdjustments
                      .where((a) => a['status'] == options.queryParameters['status'])
                      .toList(),
                  'total': 1,
                  'page': 1,
                  'limit': 100,
                  'pages': 1,
                },
        '/inventory-adjustments/adj-1/approve' =>
          adjustment(id: 'adj-1', code: 'ADJ-0001', status: 'APPROVED'),
        '/inventory-adjustments/adj-1/reject' => adjustment(
            id: 'adj-1', code: 'ADJ-0001', status: 'REJECTED',
            rejectedReason: 'أعيد الجرد ووُجد تطابق'),
        '/inventory-adjustments/adj-1' =>
          const <String, dynamic>{'deleted': true},
        _ => throw StateError('طلب غير متوقع: ${options.path}'),
      };

  Dio stubDio({
    List<RequestOptions>? requests,
    Object? Function(RequestOptions)? respondWith,
    DioException? Function(RequestOptions)? rejectWith,
  }) {
    final instance = Dio(BaseOptions(baseUrl: 'https://erp.test'));
    instance.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests?.add(options);
          final rejection = rejectWith?.call(options);
          if (rejection != null) {
            handler.reject(rejection, true);
            return;
          }
          handler.resolve(
            Response<Object>(
              requestOptions: options,
              statusCode: 200,
              data: (respondWith ?? respondFor).call(options),
            ),
          );
        },
      ),
    );
    return instance;
  }

  group('fetch — القائمة والعدادات', () {
    test('النجاح: تحليل البنود وعدادات الحالات الثلاث', () async {
      final requests = <RequestOptions>[];
      final cubit = InventoryAdjustmentsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();

      final state = cubit.state;
      expect(state, isA<InventoryAdjustmentsLoaded>());
      final loaded = state as InventoryAdjustmentsLoaded;
      expect(loaded.adjustments.length, 3);
      expect(loaded.adjustments.first['code'], 'ADJ-0001');
      expect(loaded.adjustments.first['warehouse']['name'], 'مخزن الخامات الرئيسي');
      expect(loaded.stats['total'], 3);
      expect(loaded.stats['draft'], 1);
      expect(loaded.stats['approved'], 1);
      expect(loaded.stats['rejected'], 1);

      // طلبان: القائمة (بلا مرشح) + عدادات الشرائح.
      expect(requests.length, 2);
      expect(requests.every((request) => request.queryParameters['limit'] == 100),
          isTrue);
    });

    test('خطأ الشبكة: Error برسالة الاتصال', () async {
      final cubit = InventoryAdjustmentsCubit(
        dio: stubDio(
          rejectWith: (options) => DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ),
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();

      expect(cubit.state, isA<InventoryAdjustmentsError>());
      expect((cubit.state as InventoryAdjustmentsError).message, contains('الاتصال'));
    });

    test('مرشح status يمرر كاستعلام والقائمة تعود مفلترة', () async {
      final requests = <RequestOptions>[];
      final cubit = InventoryAdjustmentsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(status: 'DRAFT');

      // الطلب الأول هو القائمة المفلترة بـ status=DRAFT.
      expect(requests.first.queryParameters['status'], 'DRAFT');
      // طلب العدادات الثاني بلا مرشح.
      expect(requests.last.queryParameters.containsKey('status'), isFalse);

      final loaded = cubit.state as InventoryAdjustmentsLoaded;
      expect(loaded.adjustments.length, 1);
      expect(loaded.adjustments.single['status'], 'DRAFT');
      // العدادات من الحمولة غير المفلترة — تبقى صحيحة.
      expect(loaded.stats['total'], 3);
      expect(loaded.stats['draft'], 1);
      expect(loaded.stats['approved'], 1);
    });

    test('فشل طلب العدادات صامت: الشاشة تعمل بلا عدادات', () async {
      // رفض الطلب الثاني فقط (طلب العدادات الذي يلي طلب القائمة).
      var listRequestSeen = false;
      final cubit = InventoryAdjustmentsCubit(
        dio: stubDio(
          rejectWith: (options) {
            if (listRequestSeen) {
              return DioException(
                requestOptions: options,
                type: DioExceptionType.badResponse,
                response: Response<Object>(
                  requestOptions: options,
                  statusCode: 403,
                  data: {'message': 'ليس لديك صلاحية'},
                ),
              );
            }
            listRequestSeen = true;
            return null;
          },
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch(status: 'ALL');

      final loaded = cubit.state;
      expect(loaded, isA<InventoryAdjustmentsLoaded>());
      // القائمة سليمة والعدادات فارغة (فشل الطلب الثاني).
      expect((loaded as InventoryAdjustmentsLoaded).adjustments.length, 3);
      expect(loaded.stats, isEmpty);
    });
  });

  group('approve — اعتماد المسودة', () {
    test('النجاح: true مع إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = InventoryAdjustmentsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.approve('adj-1');

      expect(ok, isTrue);
      expect(
        requests.map((request) => '${request.method} ${request.path}'),
        contains('POST /inventory-adjustments/adj-1/approve'),
      );
      // إعادة الجلب بعد الاعتماد.
      expect(
        requests.where((request) => request.method == 'GET').length,
        4,
      );
      expect(cubit.state, isA<InventoryAdjustmentsLoaded>());
    });

    test('رفض الخادم (مسودة معالجة بالتوازي): false', () async {
      final cubit = InventoryAdjustmentsCubit(
        dio: stubDio(
          rejectWith: (options) => options.path.contains('/approve')
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 409,
                    data: {'message': 'تمت معالجة التسوية بالتزامن'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.approve('adj-1');

      expect(ok, isFalse);
      expect(cubit.state, isA<InventoryAdjustmentsLoaded>());
    });
  });

  group('reject — رفض بسبب إلزامي', () {
    test('النجاح: reason في الحمولة + true + إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = InventoryAdjustmentsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.reject('adj-1', 'أعيد الجرد ووُجد تطابق');

      expect(ok, isTrue);
      final rejectRequest = requests.firstWhere(
        (request) => request.path == '/inventory-adjustments/adj-1/reject',
      );
      expect(rejectRequest.data['reason'], 'أعيد الجرد ووُجد تطابق');
      expect(cubit.state, isA<InventoryAdjustmentsLoaded>());
    });

    test('رفض الخادم (تسوية معتمدة): false', () async {
      final cubit = InventoryAdjustmentsCubit(
        dio: stubDio(
          rejectWith: (options) => options.path.contains('/reject')
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'لا يمكن رفض إلا تسوية في حالة مسودة'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.reject('adj-2', 'سبب');

      expect(ok, isFalse);
    });
  });

  group('delete — حذف المسودة', () {
    test('النجاح: true مع إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = InventoryAdjustmentsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.delete('adj-1');

      expect(ok, isTrue);
      expect(
        requests.map((request) => '${request.method} ${request.path}'),
        contains('DELETE /inventory-adjustments/adj-1'),
      );
    });

    test('رفض الخادم (تسوية معتمدة): false', () async {
      final cubit = InventoryAdjustmentsCubit(
        dio: stubDio(
          rejectWith: (options) => options.method == 'DELETE'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'لا يمكن حذف تسوية معتمدة أو مرفوضة'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.delete('adj-2');

      expect(ok, isFalse);
      expect(cubit.state, isA<InventoryAdjustmentsLoaded>());
    });
  });
}
