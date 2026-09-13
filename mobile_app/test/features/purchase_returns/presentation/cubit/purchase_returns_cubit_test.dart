import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/purchase_returns/presentation/cubit/purchase_returns_cubit.dart';

/// PurchaseReturnsCubit — عقود الاستجابات الخادمية الحرفية:
///  - GET /purchase-returns → {items, total, page, limit, pages} (عقد CC-6
///    للوحدات المالية — بلا مفتاح data) مع _count.items وبنود supplier/
///    purchaseOrder النحيفة.
///  - search يمرر كمرشح استعلام؛ refundMethod بلا مرشح خادمي (فلترة
///    client-side من نفس الحمولة) — موثق في كود الـ Cubit.
///  - DELETE /purchase-returns/:id → {deleted:true} مع إعادة الجلب بعده.
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  // مرتجع دائن بتاريخ اليوم (لمؤشر مرتجعات اليوم في البطاقة).
  final todayIso = DateTime.now().toIso8601String();

  Map<String, dynamic> returnDoc({
    required String id,
    required String number,
    required String method,
    required String total,
    String? date,
  }) =>
      <String, dynamic>{
        'id': id,
        'returnNumber': number,
        'purchaseOrderId': 'po-1',
        'supplierId': 'supplier-1',
        'supplierName': 'مورد النسيج',
        'date': date ?? '2026-09-05T00:00:00.000Z',
        'subtotal': '1300.00',
        'discountAmount': '50',
        'taxAmount': '0.5',
        'total': total,
        'reason': 'عيب في الجودة',
        'restockItems': true,
        'refundMethod': method,
        'status': 'POSTED',
        'createdAt': '2026-09-05T08:00:00.000Z',
        'supplier': {
          'id': 'supplier-1',
          'name': 'مورد النسيج',
          'phone': '01000000000',
        },
        'purchaseOrder': {'id': 'po-1', 'code': 'PO-0001', 'status': 'RECEIVED'},
        '_count': {'items': 2},
      };

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/purchase-returns' => <String, dynamic>{
            'items': [
              returnDoc(
                  id: 'pr-1', number: 'PRR-0001', method: 'credit', total: '1250.50'),
              returnDoc(
                  id: 'pr-2',
                  number: 'PRR-0002',
                  method: 'cash',
                  total: '500',
                  date: todayIso),
            ],
            'total': 2,
            'page': 1,
            'limit': 100,
            'pages': 1,
          },
        '/purchase-returns/pr-1' => const <String, dynamic>{'deleted': true},
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

  group('fetch — القائمة والإحصائيات', () {
    test('النجاح: تحليل {items} والعدادات والمجاميع', () async {
      final requests = <RequestOptions>[];
      final cubit = PurchaseReturnsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();

      final state = cubit.state;
      expect(state, isA<PurchaseReturnsLoaded>());
      final loaded = state as PurchaseReturnsLoaded;
      expect(loaded.returns.length, 2);
      expect(loaded.returns.first['returnNumber'], 'PRR-0001');
      expect(loaded.returns.first['supplierName'], 'مورد النسيج');
      // المجاميع من الحمولة الكاملة: 1250.50 + 500 = 1750.5.
      expect(loaded.stats['total'], 2);
      expect(loaded.stats['totalValue'], 1750.5);
      expect(loaded.stats['creditCount'], 1);
      expect(loaded.stats['cashCount'], 1);
      // بند اليوم واحد (PRR-0002 بتاريخ الآن).
      expect(loaded.stats['todayCount'], 1);

      expect(requests.single.path, '/purchase-returns');
      expect(requests.single.queryParameters['limit'], 100);
    });

    test('خطأ الشبكة: Error برسالة الاتصال', () async {
      final cubit = PurchaseReturnsCubit(
        dio: stubDio(
          rejectWith: (options) => DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ),
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();

      expect(cubit.state, isA<PurchaseReturnsError>());
      expect((cubit.state as PurchaseReturnsError).message, contains('الاتصال'));
    });

    test('بحث search يمرر كمرشح استعلام', () async {
      final requests = <RequestOptions>[];
      final cubit = PurchaseReturnsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(search: 'PRR-0001');

      expect(requests.single.queryParameters['search'], 'PRR-0001');
    });

    test('فلترة refundMethod تجري على العميل والعدادات تبقى كاملة',
        () async {
      final cubit = PurchaseReturnsCubit(dio: stubDio());
      addTearDown(cubit.close);

      await cubit.fetch(refundMethod: 'cash');

      final loaded = cubit.state as PurchaseReturnsLoaded;
      // الشاشة تعرض النقدي فقط...
      expect(loaded.returns.length, 1);
      expect(loaded.returns.single['refundMethod'], 'cash');
      // ...بينما تبقى إحصائيات البطاقة/الشرائح من الحمولة الكاملة.
      expect(loaded.stats['total'], 2);
      expect(loaded.stats['cashCount'], 1);
      expect(loaded.stats['creditCount'], 1);
    });

    test('search الفارغ لا يمرر المرشح إطلاقًا', () async {
      final requests = <RequestOptions>[];
      final cubit = PurchaseReturnsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(search: '   ');

      expect(requests.single.queryParameters.containsKey('search'), isFalse);
    });
  });

  group('delete — حذف مرتجع', () {
    test('النجاح: true مع إعادة الجلب بعده', () async {
      final requests = <RequestOptions>[];
      final cubit = PurchaseReturnsCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.delete('pr-1');

      expect(ok, isTrue);
      // DELETE ثم إعادة جلب القائمة.
      expect(
        requests.map((request) => '${request.method} ${request.path}'),
        contains('DELETE /purchase-returns/pr-1'),
      );
      expect(
        requests.where((request) => request.method == 'GET').length,
        2,
      );
      expect(cubit.state, isA<PurchaseReturnsLoaded>());
    });

    test('الرفض (400): false دون مسح الحالة المحمّلة', () async {
      final cubit = PurchaseReturnsCubit(
        dio: stubDio(
          rejectWith: (options) => options.method == 'DELETE'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'لا يمكن حذف مرتجع'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      expect(cubit.state, isA<PurchaseReturnsLoaded>());

      final ok = await cubit.delete('pr-1');
      expect(ok, isFalse);
      // فشل الحذف لا يُسقط الشاشة — القائمة تبقى.
      expect(cubit.state, isA<PurchaseReturnsLoaded>());
      expect((cubit.state as PurchaseReturnsLoaded).returns.length, 2);
    });
  });
}
