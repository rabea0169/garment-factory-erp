import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/treasury/presentation/cubit/treasury_cubit.dart';

/// TreasuryCubit — عقود الاستجابات الخادمية الحرفية:
///  - GET /treasury-transactions → {items, total, page, limit, pages} مع
///    treasury/toTreasury/journalEntry/createdBy النحيفة.
///  - GET /treasury-transactions/summary → {treasuries:[{id,name,type,
///    currencyId,isActive,balance}], totalActiveBalance, byType:{DEPOSIT:
///    {count,totalAmount}, WITHDRAWAL:{...}, TRANSFER:{...}}}.
///  - POST /treasury-transactions و DELETE /:id (يدوية فقط) — تتبعهما
///    إعادة الجلب (قائمة + ملخص).
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  const deposit = <String, dynamic>{
    'id': 'trt-1',
    'code': 'TRT-0001',
    'treasuryId': 'treasury-1',
    'toTreasuryId': null,
    'type': 'DEPOSIT',
    'amount': 5000,
    'date': '2026-09-07T00:00:00.000Z',
    'description': 'إيداع مبيعات اليوم',
    'category': 'مبيعات',
    'notes': null,
    'journalEntryId': 'entry-1',
    'referenceId': null,
    'createdById': 'user-1',
    'createdAt': '2026-09-07T08:00:00.000Z',
    'treasury': {'id': 'treasury-1', 'name': 'الخزينة الرئيسية', 'type': 'CASH'},
    'toTreasury': null,
    'journalEntry': {'id': 'entry-1', 'code': 'JE-0001'},
    'createdBy': {'id': 'user-1', 'name': 'أمين الصندوق'},
  };

  // خريطة غير const — السماح بتجاوز المفاتيح المكررة عبر spread.
  final withdrawal = <String, dynamic>{
    ...deposit,
    'id': 'trt-2',
    'code': 'TRT-0002',
    'type': 'WITHDRAWAL',
    'amount': 1200,
    'description': 'صرف نثريات',
    'category': 'مصاريف',
    'journalEntryId': 'entry-2',
    'journalEntry': {'id': 'entry-2', 'code': 'JE-0002'},
  };

  const summary = <String, dynamic>{
    'treasuries': [
      {
        'id': 'treasury-1',
        'name': 'الخزينة الرئيسية',
        'type': 'CASH',
        'currencyId': null,
        'isActive': true,
        'balance': 12500,
      },
      {
        'id': 'treasury-2',
        'name': 'خزينة البنك',
        'type': 'BANK',
        'currencyId': null,
        'isActive': true,
        'balance': 7500,
      },
    ],
    'totalActiveBalance': 20000,
    'byType': {
      'DEPOSIT': {'count': 1, 'totalAmount': 5000},
      'WITHDRAWAL': {'count': 1, 'totalAmount': 1200},
      'TRANSFER': {'count': 0, 'totalAmount': 0},
    },
  };

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/treasury-transactions' => <String, dynamic>{
            'items': [deposit, withdrawal],
            'total': 2,
            'page': 1,
            'limit': 100,
            'pages': 1,
          },
        '/treasury-transactions/summary' => summary,
        '/treasury-transactions/trt-1' => const <String, dynamic>{'deleted': true},
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

  group('fetch — الحركات والملخص', () {
    test('النجاح: تحليل الحركات والملخص وقائمة الخزائن', () async {
      final requests = <RequestOptions>[];
      final cubit = TreasuryCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();

      final state = cubit.state;
      expect(state, isA<TreasuryLoaded>());
      final loaded = state as TreasuryLoaded;
      expect(loaded.transactions.length, 2);
      expect(loaded.transactions.first['code'], 'TRT-0001');
      expect(loaded.transactions.first['treasury']['name'], 'الخزينة الرئيسية');
      expect(loaded.stats['totalActiveBalance'], 20000);
      expect((loaded.stats['byType'] as Map)['DEPOSIT']['totalAmount'], 5000);
      // قائمة الخزائن مشتقة من الملخص (للفلتر وحوار الإنشاء).
      expect(loaded.treasuries.length, 2);
      expect(loaded.treasuries.first['name'], 'الخزينة الرئيسية');

      // طلبان: القائمة ثم الملخص.
      expect(requests.length, 2);
      expect(requests.first.queryParameters['limit'], 100);
    });

    test('خطأ الشبكة: Error برسالة الاتصال', () async {
      final cubit = TreasuryCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/treasury-transactions'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.connectionError,
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();

      expect(cubit.state, isA<TreasuryError>());
      expect((cubit.state as TreasuryError).message, contains('الاتصال'));
    });

    test('مرشح type يمرر كاستعلام لطلب القائمة فقط', () async {
      final requests = <RequestOptions>[];
      final cubit = TreasuryCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(type: 'DEPOSIT');

      expect(requests.first.queryParameters['type'], 'DEPOSIT');
      // الملخص بلا مرشح (عدادات البطاقة على النطاق الكامل).
      expect(requests.last.path, '/treasury-transactions/summary');
      expect(requests.last.queryParameters.containsKey('type'), isFalse);
    });

    test('مرشح treasuryId يمرر كاستعلام', () async {
      final requests = <RequestOptions>[];
      final cubit = TreasuryCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(treasuryId: 'treasury-2');

      expect(requests.first.queryParameters['treasuryId'], 'treasury-2');
    });

    test('فشل الملخص (403 كاشير): صامت — الحركات تبقى بلا إحصائيات',
        () async {
      final cubit = TreasuryCubit(
        dio: stubDio(
          rejectWith: (options) =>
              options.path == '/treasury-transactions/summary'
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

      await cubit.fetch();

      final loaded = cubit.state;
      expect(loaded, isA<TreasuryLoaded>());
      expect((loaded as TreasuryLoaded).transactions.length, 2);
      expect(loaded.stats, isEmpty);
      expect(loaded.treasuries, isEmpty);
    });
  });

  group('create — إنشاء حركة', () {
    test('POST بالحمولة الكاملة ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = TreasuryCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final created = await cubit.create({
        'treasuryId': 'treasury-1',
        'toTreasuryId': 'treasury-2',
        'type': 'TRANSFER',
        'amount': 1000,
        'description': 'تحويل للبنك',
      });

      expect(created, isNotNull);
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/treasury-transactions');
      expect(post.data['type'], 'TRANSFER');
      expect(post.data['toTreasuryId'], 'treasury-2');
      // إعادة الجلب بعد الحفظ: القائمة ثم الملخص.
      expect(
        requests.map((request) => request.path),
        containsAll(['/treasury-transactions', '/treasury-transactions/summary']),
      );
      expect(cubit.state, isA<TreasuryLoaded>());
    });

    test('رصيد غير كافٍ (400): الخطأ يُعاد رفعه والحالة تبقى', () async {
      final cubit = TreasuryCubit(
        dio: stubDio(
          rejectWith: (options) => options.method == 'POST'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'رصيد الخزينة غير كاف'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      expect(cubit.state, isA<TreasuryLoaded>());

      await expectLater(
        cubit.create({
          'treasuryId': 'treasury-1',
          'type': 'WITHDRAWAL',
          'amount': 999999,
          'description': 'سحب كبير',
        }),
        throwsA(isA<DioException>()),
      );
      // القوائم لم تُمسح بفشل الحفظ.
      expect(cubit.state, isA<TreasuryLoaded>());
      expect((cubit.state as TreasuryLoaded).transactions.length, 2);
    });
  });

  group('delete — حذف حركة يدوية', () {
    test('النجاح: true مع إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = TreasuryCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.delete('trt-1');

      expect(ok, isTrue);
      expect(
        requests.map((request) => '${request.method} ${request.path}'),
        contains('DELETE /treasury-transactions/trt-1'),
      );
      // إعادة الجلب بعد الحذف تشمل القائمة والملخص.
      expect(
        requests.where((request) => request.method == 'GET').length,
        4,
      );
      expect(cubit.state, isA<TreasuryLoaded>());
    });

    test('حركة مرتبطة بمستند (400): false والحالة تبقى', () async {
      final cubit = TreasuryCubit(
        dio: stubDio(
          rejectWith: (options) => options.method == 'DELETE'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {
                      'message': 'لا يمكن حذف حركة مرتبطة بمستند آخر — '
                          'احذف المستند الأصل بدلًا منها',
                    },
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.delete('trt-2');

      expect(ok, isFalse);
      expect(cubit.state, isA<TreasuryLoaded>());
      expect((cubit.state as TreasuryLoaded).transactions.length, 2);
    });
  });
}
