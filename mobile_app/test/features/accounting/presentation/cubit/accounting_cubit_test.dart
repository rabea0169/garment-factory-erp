import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/accounting/presentation/cubit/accounting_cubit.dart';

/// AccountingCubit — عقود الاستجابات الخادمية الحرفية:
///  - fetchData: القوائم الثلاث الأساسية (PaginatedResult {data, meta}) ثم
///    القيود والميزان بالتوازي مع عزل أخطائهما (لا يُسقطان الشاشة).
///  - fetchCounterparties: توجيه endpoint حسب نوع الطرف.
///  - findJournalEntryForVoucher: مطابقة القيد بالمعرف ثم بالكود مع جلب
///    عند الحاجة.
///  - createVoucher: POST مع Idempotency-Key وإعادة الجلب بعده.
/// Dio وهمي عبر اعتراض (نمط payrolls_cubit_test) — بلا شبكة.
void main() {
  Map<String, dynamic> paginated(List<Map<String, dynamic>> data) =>
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

  const Map<String, dynamic> voucher = {
    'id': 'voucher-1',
    'code': 'VCH-20260907-01',
    'type': 'RECEIPT',
    'amount': 500,
    'description': 'تحصيل دفعة',
    'date': '2026-09-07T10:30:00Z',
    'treasury': {'id': 'treasury-1', 'name': 'الخزينة الرئيسية'},
    'createdBy': {'name': 'أمين الصندوق'},
    'journalEntry': {'id': 'entry-1', 'code': 'JE-20260907-01'},
  };

  const Map<String, dynamic> journalEntry = {
    'id': 'entry-1',
    'code': 'JE-20260907-01',
    'description': 'سند قبض: تحصيل دفعة',
    'date': '2026-09-07T10:30:00Z',
    'isAuto': true,
    'isReversed': false,
    'createdBy': {'name': 'أمين الصندوق'},
    'lines': [
      {
        'debitAccountId': 'account-cash',
        'creditAccountId': 'account-ar',
        'amount': 500,
      },
    ],
  };

  const trialBalancePayload = {
    'data': [
      {
        'code': '1000',
        'name': 'الخزينة',
        'totalDebit': 500,
        'totalCredit': 0,
        'balance': 500,
      },
      {
        'code': '1100',
        'name': 'ذمم العملاء',
        'totalDebit': 0,
        'totalCredit': 500,
        'balance': -500,
      },
    ],
    'totalDebit': 500,
    'totalCredit': 500,
    'balanced': true,
  };

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/accounting/vouchers' => paginated([voucher]),
        '/accounting/accounts' => paginated(const [
            {'id': 'account-cash', 'code': '1000', 'name': 'الخزينة'},
          ]),
        '/accounting/treasuries' => paginated(const [
            {'id': 'treasury-1', 'name': 'الخزينة الرئيسية', 'type': 'CASH'},
          ]),
        '/accounting/journal-entries' => paginated([journalEntry]),
        '/accounting/trial-balance' => trialBalancePayload,
        '/sales/customers' => paginated(const [
            {'id': 'customer-1', 'name': 'مصنع النور', 'code': 'CUST-01'},
          ]),
        '/suppliers' => paginated(const [
            {'id': 'supplier-1', 'name': 'مورد النسيج', 'code': 'SUP-01'},
          ]),
        '/hr/workers' => paginated(const [
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

  group('fetchData — القوائم الأساسية + القسمان الكسولان', () {
    test('النجاح: 5 طلبات، limit=100 للقوائم، والميزان كاملًا', () async {
      final requests = <RequestOptions>[];
      final cubit = AccountingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchData();

      final state = cubit.state;
      expect(state, isA<AccountingLoaded>());
      final loaded = state as AccountingLoaded;
      expect(loaded.vouchers.length, 1);
      expect(loaded.vouchers.first['code'], 'VCH-20260907-01');
      expect(loaded.treasuries.first['name'], 'الخزينة الرئيسية');
      expect(loaded.journalEntries.length, 1);
      expect(loaded.journalEntries.first['lines'], isA<List>());
      expect(loaded.trialBalanceRows.length, 2);
      expect(loaded.totalDebit, 500);
      expect(loaded.totalCredit, 500);
      expect(loaded.balanced, isTrue);
      expect(loaded.journalEntriesError, isNull);
      expect(loaded.trialBalanceError, isNull);

      expect(requests.length, 5);
      for (final request in requests) {
        if (request.path == '/accounting/trial-balance') {
          expect(request.queryParameters['limit'], isNull);
        } else {
          expect(request.queryParameters['limit'], 100);
        }
      }
    });

    test('خطأ 403 على القيود: القسم يسجل الخطأ والشاشة تبقى محمّلة',
        () async {
      final cubit = AccountingCubit(
        dio: stubDio(
          rejectWith: (options) =>
              options.path == '/accounting/journal-entries'
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

      await cubit.fetchData();

      final loaded = cubit.state;
      expect(loaded, isA<AccountingLoaded>());
      final state = loaded as AccountingLoaded;
      expect(state.journalEntriesError, contains('صلاحية'));
      expect(state.journalEntries, isEmpty);
      // القسمان الآخران لم يتأثرا بعزل الخطأ.
      expect(state.vouchers.length, 1);
      expect(state.trialBalanceRows.length, 2);
      expect(state.trialBalanceError, isNull);
    });

    test('انقطاع شبكة على الميزان: خطأ القسم فقط', () async {
      final cubit = AccountingCubit(
        dio: stubDio(
          rejectWith: (options) =>
              options.path == '/accounting/trial-balance'
                  ? DioException(
                      requestOptions: options,
                      type: DioExceptionType.connectionError,
                    )
                  : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetchData();

      final state = cubit.state as AccountingLoaded;
      expect(state.trialBalanceError, contains('الاتصال'));
      expect(state.trialBalanceRows, isEmpty);
      expect(state.journalEntries.length, 1);
      expect(state.vouchers.length, 1);
    });

    test('فشل القوائم الأساسية: AccountingError ولا يُجلب الأقسام', () async {
      final requests = <RequestOptions>[];
      final cubit = AccountingCubit(
        dio: stubDio(
          requests: requests,
          rejectWith: (options) => DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ),
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetchData();

      expect(cubit.state, isA<AccountingError>());
      expect(requests.length, 3);
    });
  });

  group('fetchCounterparties — توجيه الأنواع', () {
    test('CUSTOMER/SUPPLIER/WORKER → مساراتها، ونوع مجهول يُرفض', () async {
      final requests = <RequestOptions>[];
      final cubit = AccountingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final customers = await cubit.fetchCounterparties('CUSTOMER');
      expect(requests.last.path, '/sales/customers');
      expect(requests.last.queryParameters['limit'], 100);
      expect(customers.first['name'], 'مصنع النور');

      final suppliers = await cubit.fetchCounterparties('SUPPLIER');
      expect(requests.last.path, '/suppliers');
      expect(suppliers.first['code'], 'SUP-01');

      final workers = await cubit.fetchCounterparties('WORKER');
      expect(requests.last.path, '/hr/workers');
      expect(workers.first['id'], 'worker-1');

      expect(
        () => cubit.fetchCounterparties('UNKNOWN'),
        throwsArgumentError,
      );
    });
  });

  group('findJournalEntryForVoucher — القيد المرتبط', () {
    test('محمّل مسبقًا: يُطابق بالمعرف دون طلب إضافي', () async {
      final requests = <RequestOptions>[];
      final cubit = AccountingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);
      cubit.emit(AccountingLoaded(
        const [],
        const [],
        const [],
        journalEntries: const [journalEntry],
      ));

      final found = await cubit.findJournalEntryForVoucher(const {
        'journalEntry': {'id': 'entry-1', 'code': 'JE-20260907-01'},
      });

      expect(found?['id'], 'entry-1');
      expect(found?['lines'], isA<List>());
      expect(requests, isEmpty);
    });

    test('غير محمّل: يجلب القيود ثم يطابق بالمعرف', () async {
      final requests = <RequestOptions>[];
      final cubit = AccountingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);
      cubit.emit(AccountingLoaded(const [], const [], const []));

      final found = await cubit.findJournalEntryForVoucher(const {
        'journalEntry': {'id': 'entry-1', 'code': 'JE-20260907-01'},
      });

      expect(found?['code'], 'JE-20260907-01');
      expect(requests.single.path, '/accounting/journal-entries');
      expect((cubit.state as AccountingLoaded).journalEntries.length, 1);
    });

    test('بلا معرف: يطابق بالكود فقط', () async {
      final cubit = AccountingCubit(dio: stubDio());
      addTearDown(cubit.close);
      cubit.emit(AccountingLoaded(
        const [],
        const [],
        const [],
        journalEntries: const [journalEntry],
      ));

      final found = await cubit.findJournalEntryForVoucher(const {
        'journalEntry': {'code': 'JE-20260907-01'},
      });

      expect(found?['id'], 'entry-1');
    });

    test('سند بلا قيد مرتبط: null دون طلبات', () async {
      final requests = <RequestOptions>[];
      final cubit = AccountingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);
      cubit.emit(AccountingLoaded(const [], const [], const []));

      final found = await cubit
          .findJournalEntryForVoucher(const {'id': 'voucher-x'});

      expect(found, isNull);
      // لا journalEntry ولا journalEntryId → لا جلب إطلاقًا.
      expect(requests, isEmpty);
    });
  });

  group('createVoucher — الحفظ', () {
    test('POST بالحمولة الكاملة + Idempotency-Key ثم إعادة الجلب',
        () async {
      final requests = <RequestOptions>[];
      final cubit = AccountingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.createVoucher(
        type: 'PAYMENT',
        amount: 250,
        description: 'صرف نثريات',
        treasuryId: 'treasury-1',
        reference: 'REF-1',
        counterpartyType: 'WORKER',
        counterpartyId: 'worker-1',
      );

      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/accounting/vouchers');
      expect(post.data['type'], 'PAYMENT');
      expect(post.data['counterpartyType'], 'WORKER');
      expect(post.data['counterpartyId'], 'worker-1');
      expect(post.data['treasuryId'], 'treasury-1');
      expect(post.headers['Idempotency-Key'], isNotNull);
      // إعادة الجلب بعد الحفظ تشمل الأقسام الثانوية أيضًا.
      expect(
        requests.map((request) => request.path),
        containsAll([
          '/accounting/journal-entries',
          '/accounting/trial-balance',
        ]),
      );
      expect(cubit.state, isA<AccountingLoaded>());
    });

    test('الخطأ يُعاد رفعه والحالة المحمّلة تبقى كما هي', () async {
      final cubit = AccountingCubit(
        dio: stubDio(
          rejectWith: (options) => options.method == 'POST'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'المبلغ يجب أن يكون رقمًا موجبًا'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetchData();
      expect(cubit.state, isA<AccountingLoaded>());

      await expectLater(
        cubit.createVoucher(
          type: 'PAYMENT',
          amount: 250,
          description: 'صرف نثريات',
          treasuryId: 'treasury-1',
        ),
        throwsA(isA<DioException>()),
      );
      // القوائم لم تُمسح بفشل الحفظ (UAT-FIX).
      expect(cubit.state, isA<AccountingLoaded>());
      expect((cubit.state as AccountingLoaded).vouchers.length, 1);
    });
  });

  group('AccountingLoaded.copyWith — الحارس null', () {
    test('null يمسح الخطأ ولا يبقيه، وعدم التمرير يحافظ عليه', () {
      final base = AccountingLoaded(const [], const [], const [],
          journalEntriesError: 'خطأ');

      final cleared = base.copyWith(journalEntriesError: null);
      expect(cleared.journalEntriesError, isNull);

      final kept = base.copyWith();
      expect(kept.journalEntriesError, 'خطأ');
    });
  });
}
