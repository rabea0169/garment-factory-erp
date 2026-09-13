import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/expenses/presentation/cubit/expenses_cubit.dart';

/// ExpensesCubit — عقود الاستجابات الخادمية الحرفية:
///  - GET /expenses → {items, total, page, limit, pages, totals:{count,
///    amount}} مع category/treasury النحيفة.
///  - GET /expenses/summary → {totalCount, totalAmount, byCategory:[...]}.
///  - GET /expenses/categories → قائمة خامًا (بلا ترقيم) مع _count.expenses.
///  - POST /expenses/categories {name, notes?} و DELETE /expenses/:id —
///    كلها تتبعها إعادة الجلب (قائمة + ملخص + بنود).
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  // مصروف اليوم (لمؤشر «اليوم» في البطاقة).
  final todayIso = DateTime.now().toIso8601String();

  const expense = <String, dynamic>{
    'id': 'exp-1',
    'categoryId': 'cat-1',
    'categoryName': 'إيجار',
    'amount': 1500,
    'date': '2026-09-07',
    'notes': 'إيجار سبتمبر',
    'treasuryId': 'treasury-1',
    'journalEntryId': 'entry-1',
    'createdAt': '2026-09-07T08:00:00.000Z',
    'category': {'id': 'cat-1', 'name': 'إيجار'},
    'treasury': {'id': 'treasury-1', 'name': 'الخزينة الرئيسية'},
    'journalEntry': {'id': 'entry-1', 'code': 'JE-0001'},
  };

  final expenseToday = <String, dynamic>{
    ...expense,
    'id': 'exp-2',
    'date': todayIso,
    'amount': 250,
  };

  const summary = <String, dynamic>{
    'totalCount': 2,
    'totalAmount': 1750,
    'byCategory': [
      {
        'categoryId': 'cat-1',
        'categoryName': 'إيجار',
        'count': 1,
        'totalAmount': 1500,
      },
    ],
  };

  const categories = <Map<String, dynamic>>[
    {'id': 'cat-1', 'name': 'إيجار', 'notes': 'بند افتراضي', 'isActive': true,
     '_count': {'expenses': 1}},
    {'id': 'cat-2', 'name': 'رواتب', 'isActive': true, '_count': {'expenses': 0}},
  ];

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/expenses' => <String, dynamic>{
            'items': [expense, expenseToday],
            'total': 2,
            'page': 1,
            'limit': 100,
            'pages': 1,
            'totals': {'count': 2, 'amount': 1750},
          },
        '/expenses/summary' => summary,
        '/expenses/categories' => categories,
        '/expenses/exp-1' => const <String, dynamic>{'deleted': true},
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

  group('fetch — القائمة والبنود والملخص', () {
    test('النجاح: المصاريف + البنود + الملخص غير المفلتر', () async {
      final requests = <RequestOptions>[];
      final cubit = ExpensesCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();

      final state = cubit.state;
      expect(state, isA<ExpensesLoaded>());
      final loaded = state as ExpensesLoaded;
      expect(loaded.expenses.length, 2);
      expect(loaded.expenses.first['categoryName'], 'إيجار');
      expect(loaded.expenses.first['treasury']['name'], 'الخزينة الرئيسية');
      expect(loaded.categories.length, 2);
      expect(loaded.categories.first['name'], 'إيجار');
      expect(loaded.stats['totalCount'], 2);
      expect(loaded.stats['totalAmount'], 1750);

      // ثلاثة طلبات: القائمة ثم الملخص ثم البنود.
      expect(requests.length, 3);
      expect(requests.first.queryParameters['limit'], 100);
    });

    test('خطأ الشبكة: Error برسالة الاتصال', () async {
      final cubit = ExpensesCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/expenses'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.connectionError,
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();

      expect(cubit.state, isA<ExpensesError>());
      expect((cubit.state as ExpensesError).message, contains('الاتصال'));
    });

    test('مرشح categoryId يمرر لقائمة المصاريف فقط', () async {
      final requests = <RequestOptions>[];
      final cubit = ExpensesCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(categoryId: 'cat-1');

      // طلب القائمة (الأول) يحمل المرشح؛ الملخص والبنود بلا مرشح (عدادات
      // البطاقة والشرائح تبقى على النطاق الكامل).
      expect(requests.first.queryParameters['categoryId'], 'cat-1');
      expect(requests
          .skip(1)
          .every((request) =>
              !request.queryParameters.containsKey('categoryId')), isTrue);
    });

    test('بحث search يمرر كمرشح استعلام', () async {
      final requests = <RequestOptions>[];
      final cubit = ExpensesCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch(search: 'إيجار');

      expect(requests.first.queryParameters['search'], 'إيجار');
    });

    test('فشل الملخص والبنود صامت: القائمة تبقى محمّلة', () async {
      final cubit = ExpensesCubit(
        dio: stubDio(
          respondWith: (options) =>
              options.path == '/expenses' ? respondFor(options) : null,
          rejectWith: (options) => options.path != '/expenses'
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
      expect(loaded, isA<ExpensesLoaded>());
      expect((loaded as ExpensesLoaded).expenses.length, 2);
      expect(loaded.stats, isEmpty);
      expect(loaded.categories, isEmpty);
    });
  });

  group('createCategory — إنشاء بند', () {
    test('النجاح: POST بالحمولة + true + إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = ExpensesCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.createCategory('نقل', notes: 'نقل خامات');

      expect(ok, isTrue);
      final post = requests.firstWhere(
        (request) => request.method == 'POST' && request.path == '/expenses/categories',
      );
      expect(post.data['name'], 'نقل');
      expect(post.data['notes'], 'نقل خامات');
      // إعادة الجلب بعد الإنشاء تشمل القائمة والملخص والبنود.
      expect(
        requests.map((request) => request.path),
        containsAll(['/expenses', '/expenses/summary', '/expenses/categories']),
      );
      expect(cubit.state, isA<ExpensesLoaded>());
    });

    test('ازدواج الاسم (400): false دون إسقاط الحالة', () async {
      final cubit = ExpensesCubit(
        dio: stubDio(
          rejectWith: (options) =>
              options.method == 'POST' && options.path == '/expenses/categories'
                  ? DioException(
                      requestOptions: options,
                      type: DioExceptionType.badResponse,
                      response: Response<Object>(
                        requestOptions: options,
                        statusCode: 400,
                        data: {'message': 'اسم بند المصروف موجود بالفعل'},
                      ),
                    )
                  : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.createCategory('إيجار');

      expect(ok, isFalse);
      expect(cubit.state, isA<ExpensesLoaded>());
      expect((cubit.state as ExpensesLoaded).categories.length, 2);
    });
  });

  group('deleteExpense — حذف مصروف', () {
    test('النجاح: true مع إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = ExpensesCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.deleteExpense('exp-1');

      expect(ok, isTrue);
      expect(
        requests.map((request) => '${request.method} ${request.path}'),
        contains('DELETE /expenses/exp-1'),
      );
      expect(cubit.state, isA<ExpensesLoaded>());
    });

    test('رفض الخادم: false والحالة المحمّلة تبقى', () async {
      final cubit = ExpensesCubit(
        dio: stubDio(
          rejectWith: (options) => options.method == 'DELETE'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'المصروف غير موجود'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetch();
      final ok = await cubit.deleteExpense('exp-x');

      expect(ok, isFalse);
      expect(cubit.state, isA<ExpensesLoaded>());
      expect((cubit.state as ExpensesLoaded).expenses.length, 2);
    });
  });
}
