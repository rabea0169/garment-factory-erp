import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/cutting/presentation/cubit/cutting_cubit.dart';

/// CuttingCubit — عقود استجابات وحدة القص:
///  - fetchOrders: GET /cutting/orders {items, total} — كل أمر يحمل بنوده
///    ولقطات المنتج/العامل/المخزن (عقد findAll الخادمي).
///  - activate: POST /orders/:id/activate — الخادم يختار التوليفة المصدر
///    صاحبة أكبر رصيد تلقائيًا، والفشل يعاد برسالة المتاح الدقيقة.
///  - reverse: POST /orders/:id/reverse يرد كل الحركات.
///  - fetchSettings: الألوان + مجموعات المقاسات (قائمتان عاديتان).
///  - createOrder: POST /cutting/orders — الكميات تُحسب خادميًا.
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  /// شكل قائمة وحدة القص (Selim): {items, total, page, limit, pages}.
  Map<String, dynamic> paginated(List<Map<String, dynamic>> items) =>
      <String, dynamic>{
        'items': items,
        'total': items.length,
        'page': 1,
        'limit': items.length,
        'pages': 1,
      };

  /// شكل PaginatedResult للوحدات الأقدم (products/warehouses/workers):
  /// {data, meta} — نفس عقد الخادم الحقيقي لقوائم الحوار.
  Map<String, dynamic> legacyPaginated(List<Map<String, dynamic>> data) =>
      <String, dynamic>{
        'data': data,
        'meta': {
          'total': data.length,
          'page': 1,
          'pageSize': data.length,
          'totalPages': 1,
          'hasNextPage': false,
          'hasPreviousPage': false,
        },
      };

  const Map<String, dynamic> draftOrder = {
    'id': 'order-1',
    'docNumber': 'CUT-0001',
    'date': '2026-09-15T00:00:00.000Z',
    'productId': 'product-1',
    'warehouseId': 'warehouse-1',
    'workerId': 'worker-1',
    'wagePerPiece': '2.50',
    'wageTotal': '375.00',
    'remnantQty': '0',
    'remnantNotes': null,
    'totalPieces': '150',
    'totalLays': '6',
    'status': 'DRAFT',
    'reversedAt': null,
    'reversedById': null,
    'notes': 'قص طلب عميل النور',
    'product': {'id': 'product-1', 'code': 'PRD-01', 'name': 'تيشيرت قطن'},
    'worker': {'id': 'worker-1', 'name': 'أحمد', 'code': 'W-001'},
    'warehouse': {'id': 'warehouse-1', 'code': 'INV-6', 'name': 'مخزن التام'},
    'lines': [
      {
        'id': 'line-1',
        'colorId': 'color-1',
        'color': 'كحلي',
        'sizeGroupId': null,
        'size': 'L',
        'layCount': '3',
        'piecesPerLay': '25',
        'quantity': '75',
        'productVariantId': null,
        'notes': null,
      },
      {
        'id': 'line-2',
        'colorId': 'color-2',
        'color': 'أحمر',
        'sizeGroupId': null,
        'size': 'M',
        'layCount': '3',
        'piecesPerLay': '25',
        'quantity': '75',
        'productVariantId': null,
        'notes': null,
      },
    ],
  };

  final Map<String, dynamic> activeOrder = {
    ...draftOrder,
    'status': 'ACTIVE',
  };

  final Map<String, dynamic> reversedOrder = {
    ...draftOrder,
    'status': 'REVERSED',
    'reversedAt': '2026-09-16T10:00:00.000Z',
  };

  const Map<String, dynamic> color = {
    'id': 'color-1',
    'name': 'كحلي',
    'hex': '#1F3A93',
    'isActive': true,
  };

  const Map<String, dynamic> sizeGroup = {
    'id': 'group-1',
    'name': 'شبابي',
    'sizes': ['S', 'M', 'L', 'XL'],
    'isActive': true,
  };

  /// آخر حالة للأوامر — تُبدَّل بين الاختبارات لاختبار المرشحات.
  List<Map<String, dynamic>> ordersPayload = const [draftOrder];

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/cutting/orders' => paginated(ordersPayload),
        '/cutting/orders/order-1/activate' => activeOrder,
        '/cutting/orders/order-1/reverse' => reversedOrder,
        '/cutting/colors' => [color],
        '/cutting/size-groups' => [sizeGroup],
        '/products' => legacyPaginated(const [
            {
              'id': 'product-1',
              'code': 'PRD-01',
              'name': 'تيشيرت قطن',
              'variants': [],
            },
          ]),
        '/inventory/warehouses' => legacyPaginated(const [
            {'id': 'warehouse-1', 'code': 'INV-6', 'name': 'مخزن التام'},
          ]),
        '/hr/workers' => legacyPaginated(const [
            {'id': 'worker-1', 'name': 'أحمد', 'code': 'W-001'},
          ]),
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

  group('fetchOrders — أوامر القص', () {
    test('النجاح: القائمة ببنودها ومجاميعها المحسوبة', () async {
      final requests = <RequestOptions>[];
      final cubit = CuttingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchOrders();

      final state = cubit.state;
      expect(state, isA<CuttingLoaded>());
      final loaded = state as CuttingLoaded;
      expect(loaded.orders.length, 1);
      expect(loaded.ordersTotal, 1);
      expect(loaded.countOf('DRAFT'), 1);
      expect(loaded.countOf('ACTIVE'), 0);
      // إجمالي القطع والأجر من القائمة المحمّلة (بطاقة العنوان).
      expect(loaded.totalPieces, 150);
      expect(loaded.totalWages, 375);
      // البنود بلقطات اللون والمقاس والكميات.
      final lines = loaded.orders.first['lines'] as List;
      expect(lines.length, 2);
      expect(lines.first['quantity'], '75');

      expect(requests.single.path, '/cutting/orders');
      expect(requests.single.queryParameters['limit'], 100);
      expect(requests.single.queryParameters['status'], isNull);
    });

    test('مرشح الحالة: status=ACTIVE يُرسل للخادم', () async {
      final requests = <RequestOptions>[];
      final cubit = CuttingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchOrders(status: 'ACTIVE');

      expect(requests.last.queryParameters['status'], 'ACTIVE');

      await cubit.fetchOrders(status: 'ALL');
      expect(requests.last.queryParameters['status'], isNull);
    });

    test('فشل القائمة: CuttingError', () async {
      final cubit = CuttingCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/cutting/orders'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 403,
                    data: {'message': 'ليس لديك صلاحية'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetchOrders();

      expect(cubit.state, isA<CuttingError>());
      expect((cubit.state as CuttingError).message, contains('صلاحية'));
    });
  });

  group('activate — تفعيل أمر مسودة', () {
    test('النجاح: POST بلا sourceVariantId (الخادم يختار الأكبر) ثم الجلب',
        () async {
      final requests = <RequestOptions>[];
      final cubit = CuttingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.activate('order-1');

      expect(ok, isTrue);
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/cutting/orders/order-1/activate');
      // لا نرسل sourceVariantId — الخادم يلتقط أكبر رصيد تلقائيًا.
      expect(post.data, isEmpty);
      // إعادة الجلب بعد التفعيل.
      expect(
        requests.map((r) => r.path),
        contains('/cutting/orders'),
      );
      expect(cubit.state, isA<CuttingLoaded>());
    });

    test('نقص رصيد المصدر: false مع رسالة المتاح الدقيقة', () async {
      final cubit = CuttingCubit(
        dio: stubDio(
          rejectWith: (options) =>
              options.method == 'POST' && options.path.endsWith('/activate')
                  ? DioException(
                      requestOptions: options,
                      type: DioExceptionType.badResponse,
                      response: Response<Object>(
                        requestOptions: options,
                        statusCode: 400,
                        data: {
                          'message':
                              'رصيد التوليفة المصدر لا يكفي — المتاح: 100 والمطلوب: 150',
                        },
                      ),
                    )
                  : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetchOrders();
      expect(cubit.state, isA<CuttingLoaded>());

      final ok = await cubit.activate('order-1');

      expect(ok, isFalse);
      expect(cubit.lastActionError, contains('المتاح'));
      expect(cubit.state, isA<CuttingLoaded>());
    });
  });

  group('reverse — عكس أمر مفعّل', () {
    test('النجاح: POST /reverse ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = CuttingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.reverse('order-1');

      expect(ok, isTrue);
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/cutting/orders/order-1/reverse');
      expect(cubit.state, isA<CuttingLoaded>());
    });
  });

  group('fetchSettings — الألوان ومجموعات المقاسات', () {
    test('النجاح: القائمتان في الحالة والأوامر محفوظة', () async {
      final requests = <RequestOptions>[];
      final cubit = CuttingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchOrders();
      await cubit.fetchSettings();

      final state = cubit.state as CuttingLoaded;
      expect(state.colors.length, 1);
      expect(state.colors.first['hex'], '#1F3A93');
      expect(state.sizeGroups.length, 1);
      expect(state.sizeGroups.first['sizes'], isA<List>());
      // تحديث الإعدادات لا يمس تبويب الأوامر.
      expect(state.orders.length, 1);
      expect(
        requests.map((r) => r.path),
        containsAll(['/cutting/colors', '/cutting/size-groups']),
      );
    });
  });

  group('createOrder / createColor — الإنشاء', () {
    test('أمر قص: POST بالبنود بلا كميات (الخادم يحسبها)', () async {
      final requests = <RequestOptions>[];
      final cubit = CuttingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.createOrder({
        'productId': 'product-1',
        'warehouseId': 'warehouse-1',
        'workerId': 'worker-1',
        'wagePerPiece': 2.5,
        'lines': [
          {'color': 'كحلي', 'size': 'L', 'layCount': 3, 'piecesPerLay': 25},
        ],
        'notes': 'قص تجريبي',
      });

      expect(ok, isTrue);
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/cutting/orders');
      expect(post.data['productId'], 'product-1');
      expect(post.data['warehouseId'], 'warehouse-1');
      final lines = post.data['lines'] as List;
      expect(lines.first['layCount'], 3);
      expect(lines.first['piecesPerLay'], 25);
      // العميل لا يرسل الكميات — تُحسب خادميًا.
      expect(lines.first.containsKey('quantity'), isFalse);
      expect(cubit.state, isA<CuttingLoaded>());
    });

    test('لون جديد: POST {name, hex} ثم إعادة جلب الإعدادات', () async {
      final requests = <RequestOptions>[];
      final cubit = CuttingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.createColor(name: 'نبيتي', hex: '#5E1A1A');

      expect(ok, isTrue);
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/cutting/colors');
      expect(post.data['name'], 'نبيتي');
      expect(post.data['hex'], '#5E1A1A');
      // إعادة جلب الإعدادات بعد الإنشاء.
      expect(
        requests.map((r) => r.path),
        containsAll(['/cutting/colors', '/cutting/size-groups']),
      );
    });
  });

  group('lookups حوار الإنشاء — المنتجات والمخازن والعمال', () {
    test('المسارات الثلاثة تعيد PaginatedResult', () async {
      final requests = <RequestOptions>[];
      final cubit = CuttingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final products = await cubit.fetchProducts();
      final warehouses = await cubit.fetchWarehouses();
      final workers = await cubit.fetchWorkers();

      expect(products.first['name'], 'تيشيرت قطن');
      expect(warehouses.first['name'], 'مخزن التام');
      expect(workers.first['id'], 'worker-1');
      expect(
        requests.map((r) => r.path),
        containsAll(['/products', '/inventory/warehouses', '/hr/workers']),
      );
      for (final request in requests) {
        expect(request.queryParameters['limit'], 100);
      }
    });
  });
}
