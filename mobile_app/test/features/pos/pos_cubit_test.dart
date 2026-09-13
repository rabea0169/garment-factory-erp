import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uuid/uuid.dart';

import 'package:garment_factory_erp/features/pos/presentation/cubit/pos_cubit.dart';

import 'outbox_fake.dart';
import '../../helpers/fake_cache_service.dart';

/// SELIM-ERP W2 — اختبارات Cubit نقطة البيع:
/// - الكتالوج من الشبكة (write-through) ثم من الكاش عند قطع الاتصال.
/// - السلة: إضافة/كمية/حذف/تفريغ + تبديل مستوى السعر من الكتالوج.
/// - الإجماليات المحلية (VAT 14%) للعرض فقط.
/// - البيع: POST /pos/quick-sale بترويسة idempotency — البيع بلا اتصال
///   يُدرج في الطابور بنفس المفتاح ويرجع إيصارًا معلقًا.
void main() {
  late List<RequestOptions> requests;
  late FakeOutbox outbox;
  late FakeCacheService cache;

  Map<String, dynamic> catalogResponse() => {
        'items': [
          {
            'variantId': 'var-1',
            'code': 'P-1',
            'name': 'تيشيرت',
            'size': 'L',
            'color': 'أحمر',
            'retailPrice': 250,
            'wholesalePrice': 200,
            'availableQty': 7,
          },
          {
            'variantId': 'var-2',
            'code': 'P-2',
            'name': 'بنطلون',
            'size': 'M',
            'color': 'أزرق',
            'retailPrice': 300,
            'wholesalePrice': 260,
            'availableQty': 3,
          },
        ],
      };


  Dio Function(Object? Function(RequestOptions)) dioFactory() {
    requests = <RequestOptions>[];
    return (Object? Function(RequestOptions) respond) => Dio(
          BaseOptions(baseUrl: 'https://erp.test'),
        )..interceptors.add(
            InterceptorsWrapper(
              onRequest: (options, handler) {
                requests.add(options);
                handler.resolve(
                  Response<Object>(
                    requestOptions: options,
                    statusCode: 200,
                    data: respond(options),
                  ),
                );
              },
            ),
          );
  }

  /// dio يرفض البيع بفقد اتصال ويجيب الباقي (كاكتالوج) بنجاح.
  Dio offlineSaleDio() {
    requests = <RequestOptions>[];
    final dio = Dio(BaseOptions(baseUrl: 'https://erp.test'));
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.path == '/pos/quick-sale') {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.connectionError,
              ),
              true,
            );
            return;
          }
          requests.add(options);
          handler.resolve(
            Response<Object>(
              requestOptions: options,
              statusCode: 200,
              data: catalogResponse(),
            ),
          );
        },
      ),
    );
    return dio;
  }

  PosCubit cubit({required Dio dio}) => PosCubit(
        dio: dio,
        cache: cache,
        outbox: outbox,
        uuid: const Uuid(),
      );


  setUp(() {
    outbox = FakeOutbox();
    cache = FakeCacheService();
  });

  group('loadCatalog — الكتالوج', () {
    test('الشبكة أولًا: يخزن الكتالوج write-through ويصبح جاهزًا', () async {
      final cubitRef = cubit(dio: dioFactory()((_) => catalogResponse()));
      await cubitRef.loadCatalog();
      final state = cubitRef.state;
      expect(state, isA<PosReady>());
      expect((state as PosReady).catalog, hasLength(2));
      expect(state.fromCache, isFalse);
      // الكاش كُتب للمرة القادمة.
      final snapshot = await cache.read(PosCubit.catalogCacheKey);
      expect(snapshot, isNotNull);
      await cubitRef.close();
    });

    test('قطع الاتصال: يقرأ آخر كتالوج ناجح من الكاش برسالة مخزنة',
        () async {
      // أولًا نكتب الكتالوج عبر نجاح شبكة على نفس الكاش.
      final first = cubit(dio: dioFactory()((_) => catalogResponse()));
      await first.loadCatalog();
      await first.close();

      // ثم قطع الاتصال الكامل (كتالوج أيضًا) على cubit ثانٍ بنفس الكاش.
      final offline = Dio(BaseOptions(baseUrl: 'https://erp.test'));
      offline.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) => handler.reject(
            DioException(
              requestOptions: options,
              type: DioExceptionType.connectionError,
            ),
            true,
          ),
        ),
      );
      final second = cubit(dio: offline);
      await second.loadCatalog();
      final state = second.state;
      expect(state, isA<PosReady>());
      expect((state as PosReady).fromCache, isTrue);
      expect(state.catalog, hasLength(2));
      expect(state.message, contains('مخزنة'));
      await second.close();
    });
  });

  group('السلة — عمليات البنود', () {
    test('إضافة تتراكم الكمية، وتعديل الكمية، والحذف، والتفريغ', () async {
      final cubitRef = cubit(dio: dioFactory()((_) => catalogResponse()));
      await cubitRef.loadCatalog();
      final ready = cubitRef.state as PosReady;
      final tshirt = ready.catalog.first;

      cubitRef.addToCart(tshirt);
      cubitRef.addToCart(tshirt);
      expect((cubitRef.state as PosReady).itemCount, 2);

      cubitRef.setQuantity(tshirt.variantId, 5);
      expect((cubitRef.state as PosReady).itemCount, 5);

      cubitRef.removeLine(tshirt.variantId);
      expect((cubitRef.state as PosReady).cart, isEmpty);

      cubitRef.addToCart(tshirt, quantity: 3);
      cubitRef.clearCart();
      expect((cubitRef.state as PosReady).cart, isEmpty);
      expect((cubitRef.state as PosReady).discount, 0);
      await cubitRef.close();
    });

    test('تبديل مستوى السعر يعيد التسعير من الكتالوج (جملة 200)', () async {
      final cubitRef = cubit(dio: dioFactory()((_) => catalogResponse()));
      await cubitRef.loadCatalog();
      final ready = cubitRef.state as PosReady;
      cubitRef.addToCart(ready.catalog.first, quantity: 2);

      cubitRef.togglePriceLevel();
      var updated = cubitRef.state as PosReady;
      expect(updated.priceLevel, PosPriceLevel.wholesale);
      // 2 × 200 = 400.
      expect(updated.subtotal, 400);

      cubitRef.togglePriceLevel();
      updated = cubitRef.state as PosReady;
      expect(updated.subtotal, 500);
      await cubitRef.close();
    });

    test('الإجماليات: 2 × 250 = 500 - خصم 100 + VAT 14% = 456', () async {
      final cubitRef = cubit(dio: dioFactory()((_) => catalogResponse()));
      await cubitRef.loadCatalog();
      final ready = cubitRef.state as PosReady;
      cubitRef.addToCart(ready.catalog.first, quantity: 2);
      cubitRef.setDiscount(100);
      final state = cubitRef.state as PosReady;
      expect(state.subtotal, 500);
      // VAT على الصافي: (500-100)×0.14 = 56.
      expect(state.vat, 56);
      expect(state.total, 456);
      await cubitRef.close();
    });
  });

  group('checkout — البيع', () {
    test('نجاح الشبكة: POST /pos/quick-sale + Idempotency-Key + إيصار',
        () async {
      final dio = dioFactory()((options) {
        if (options.path == '/pos/quick-sale') {
          return {
            'code': 'SO-2026-ABC',
            'customerName': 'عميل نقدي',
            'items': [
              {
                'name': 'تيشيرت',
                'size': 'L',
                'color': 'أحمر',
                'quantity': 2,
                'unitPrice': 250,
                'total': 500,
              }
            ],
            'subtotal': 500,
            'discount': 0,
            'vatAmount': 70,
            'total': 570,
            'qrPayload': 'QR-TEST',
          };
        }
        return catalogResponse();
      });
      final cubitRef = cubit(dio: dio);
      await cubitRef.loadCatalog();
      cubitRef
          .addToCart((cubitRef.state as PosReady).catalog.first, quantity: 2);

      final receipt = await cubitRef.checkout();
      expect(receipt, isNotNull);
      expect(receipt!.code, 'SO-2026-ABC');
      expect(receipt.total, 570);
      expect(receipt.qrPayload, 'QR-TEST');
      expect(receipt.pendingOffline, isFalse);

      final saleRequest =
          requests.firstWhere((r) => r.path == '/pos/quick-sale');
      expect(saleRequest.method, 'POST');
      expect(saleRequest.headers['Idempotency-Key'], isA<String>());
      // السلة تُفرغ بعد البيع.
      expect((cubitRef.state as PosReady).cart, isEmpty);
      await cubitRef.close();
    });

    test('قطع الاتصال: يُدرج في الطابور بمفتاح idempotency + إيصار معلق',
        () async {
      final cubitRef = cubit(dio: offlineSaleDio());
      await cubitRef.loadCatalog();
      cubitRef
          .addToCart((cubitRef.state as PosReady).catalog.first, quantity: 1);

      final receipt = await cubitRef.checkout();
      expect(receipt, isNotNull);
      expect(receipt!.pendingOffline, isTrue);
      expect(receipt.code, startsWith('POS-PENDING-'));
      // الطابور استقبل POST /pos/quick-sale بجسم كامل ومفتاح.
      expect(outbox.entries, hasLength(1));
      final entry = outbox.entries.single;
      expect(entry.method, 'POST');
      expect(entry.path, '/pos/quick-sale');
      expect(entry.body['items'], isA<List<dynamic>>());
      expect(entry.idempotencyKey, isNotEmpty);
      // السلة تُفرغ أيضًا (البيع مؤجل لا مفقود).
      expect((cubitRef.state as PosReady).cart, isEmpty);
      await cubitRef.close();
    });

    test('سلة فارغة: لا طلب ولا إيصار', () async {
      final cubitRef = cubit(dio: dioFactory()((_) => catalogResponse()));
      await cubitRef.loadCatalog();
      final receipt = await cubitRef.checkout();
      expect(receipt, isNull);
      expect(
        requests.where((r) => r.path == '/pos/quick-sale'),
        isEmpty,
      );
      await cubitRef.close();
    });
  });

  group('resolveBarcode — حل الباركود', () {
    test('نجاح الشبكة يرجع البند بأسعاره', () async {
      final dio = dioFactory()((options) {
        if (options.path == '/pos/barcode/111') {
          return {
            'variantId': 'var-1',
            'code': 'P-1',
            'name': 'تيشيرت',
            'size': 'L',
            'color': 'أحمر',
            'retailPrice': 250,
            'wholesalePrice': 200,
          };
        }
        return catalogResponse();
      });
      final cubitRef = cubit(dio: dio);
      await cubitRef.loadCatalog();
      final item = await cubitRef.resolveBarcode('111');
      expect(item, isNotNull);
      expect(item!.name, 'تيشيرت');
      await cubitRef.close();
    });

    test('فشل الشبكة يسقط للكتالوج المحمّل (الكود المحلي)', () async {
      final dio = dioFactory()((options) {
        throw DioException(
          requestOptions: options,
          type: DioExceptionType.connectionError,
        );
      });
      final cubitRef = cubit(dio: dio);
      // الكتالوج من كاش مكتوب مسبقًا بنفس الـ setUp؟ — نكتبه يدويًا.
      await cache.writeThrough(PosCubit.catalogCacheKey, catalogResponse());
      await cubitRef.loadCatalog();
      // الكود المحلي P-2 يُحل من الكتالوج.
      final item = await cubitRef.resolveBarcode('P-2');
      expect(item, isNotNull);
      expect(item!.code, 'P-2');
      await cubitRef.close();
    });
  });
}
