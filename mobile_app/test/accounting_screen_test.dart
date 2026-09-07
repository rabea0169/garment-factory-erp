import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/accounting/presentation/cubit/accounting_cubit.dart';
import 'package:garment_factory_erp/features/accounting/presentation/screens/accounting_screen.dart';

/// Cubit وهمي للشاشة: يبدأ محمّلًا ويُحاكي جلب الأطراف والقيد المرتبط
/// بلا شبكة — نمط اختبارات الشاشات المعتمد في المشروع.
class _FakeAccountingCubit extends AccountingCubit {
  _FakeAccountingCubit({
    List<Map<String, dynamic>> vouchers = const [],
    List<Map<String, dynamic>> accounts = const [],
    List<Map<String, dynamic>> journalEntries = const [],
    List<Map<String, dynamic>> trialBalanceRows = const [],
    double totalDebit = 0,
    double totalCredit = 0,
    bool? balanced,
  }) {
    emit(
      AccountingLoaded(
        vouchers,
        accounts,
        const [
          {'id': 'treasury-1', 'name': 'الخزينة الرئيسية', 'type': 'CASH'},
        ],
        journalEntries: journalEntries,
        trialBalanceRows: trialBalanceRows,
        totalDebit: totalDebit,
        totalCredit: totalCredit,
        balanced: balanced,
      ),
    );
  }

  int createCalls = 0;
  String? lastType;
  double? lastAmount;
  String? lastDescription;
  String? lastTreasuryId;
  String? lastCounterpartyType;
  String? lastCounterpartyId;

  /// استجابة fetchCounterparties — أو خطأ إن ضُبط counterpartyError.
  List<Map<String, dynamic>> counterparties = const [];
  Object? counterpartyError;
  final Map<String, int> counterpartyFetchCount = {};

  /// استجابة findJournalEntryForVoucher.
  Map<String, dynamic>? journalEntry;

  @override
  Future<void> createVoucher({
    required String type,
    required double amount,
    required String description,
    required String treasuryId,
    String? reference,
    String? counterpartyType,
    String? counterpartyId,
  }) async {
    createCalls++;
    lastType = type;
    lastAmount = amount;
    lastDescription = description;
    lastTreasuryId = treasuryId;
    lastCounterpartyType = counterpartyType;
    lastCounterpartyId = counterpartyId;
  }

  @override
  Future<List<Map<String, dynamic>>> fetchCounterparties(
    String counterpartyType,
  ) async {
    counterpartyFetchCount[counterpartyType] =
        (counterpartyFetchCount[counterpartyType] ?? 0) + 1;
    if (counterpartyError != null) throw counterpartyError!;
    return counterparties;
  }

  @override
  Future<Map<String, dynamic>?> findJournalEntryForVoucher(
    Map<String, dynamic> voucher,
  ) async {
    return journalEntry;
  }
}

const Map<String, dynamic> _customer = {
  'id': 'customer-1',
  'name': 'مصنع النور',
  'code': 'CUST-01',
};

const List<Map<String, dynamic>> _accounts = [
  {'id': 'account-cash', 'code': '1000', 'name': 'الخزينة'},
  {'id': 'account-ar', 'code': '1100', 'name': 'ذمم العملاء'},
];

const Map<String, dynamic> _journalEntry = {
  'id': 'entry-1',
  'code': 'JE-20260907-01',
  'description': 'سند قبض: تحصيل دفعة من عميل',
  'date': '2026-09-07T10:30:00Z',
  'isAuto': true,
  'isReversed': false,
  'createdBy': {'name': 'أمين الصندوق'},
  'lines': [
    {
      'debitAccountId': 'account-cash',
      'creditAccountId': 'account-ar',
      'amount': 500,
      'description': 'تحصيل نقدي',
    },
  ],
};

const Map<String, dynamic> _voucher = {
  'id': 'voucher-1',
  'code': 'VCH-20260907-01',
  'type': 'RECEIPT',
  'amount': 500,
  'description': 'تحصيل دفعة من عميل',
  'reference': 'REF-9',
  'date': '2026-09-07T10:30:00Z',
  'treasury': {'id': 'treasury-1', 'name': 'الخزينة الرئيسية'},
  'createdBy': {'name': 'أمين الصندوق'},
  'journalEntry': {'id': 'entry-1', 'code': 'JE-20260907-01'},
  'counterpartyType': 'CUSTOMER',
  'counterpartyId': 'customer-1',
};

Future<void> _pumpScreen(WidgetTester tester, AccountingCubit cubit) async {
  await tester.pumpWidget(MaterialApp(home: AccountingScreen(cubit: cubit)));
  await tester.pump();
}

Future<void> _openVoucherDialog(WidgetTester tester) async {
  await tester.tap(find.text('سند جديد'));
  await tester.pumpAndSettle();
}

/// يفتح القائمة المنسدلة رقم [index] في حوار السند ويختار عنصرها [itemText].
Future<void> _selectDropdownItem(
  WidgetTester tester, {
  required int index,
  required String itemText,
}) async {
  final field = find.byType(DropdownButtonFormField<String>).at(index);
  await tester.ensureVisible(field);
  await tester.pumpAndSettle();
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.text(itemText).last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('validates required voucher fields before submitting',
      (tester) async {
    final cubit = _FakeAccountingCubit();
    await _pumpScreen(tester, cubit);
    await _openVoucherDialog(tester);

    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('أدخل مبلغًا موجبًا'), findsOneWidget);
    expect(find.text('الوصف مطلوب'), findsOneWidget);
    expect(find.text('اختر الخزينة'), findsOneWidget);
    expect(cubit.createCalls, 0);
  });

  testWidgets('counterparty picker: lazy load on type + pass selected id',
      (tester) async {
    final cubit = _FakeAccountingCubit()
      ..counterparties = const [_customer];
    await _pumpScreen(tester, cubit);
    await _openVoucherDialog(tester);

    // لا قائمة أطراف قبل اختيار النوع (تحميل كسول).
    expect(cubit.counterpartyFetchCount, isEmpty);

    await _selectDropdownItem(tester, index: 2, itemText: 'عميل');
    expect(cubit.counterpartyFetchCount['CUSTOMER'], 1);

    await _selectDropdownItem(
      tester,
      index: 3,
      itemText: 'مصنع النور — CUST-01',
    );

    await tester.enterText(find.byType(TextFormField).at(0), '500');
    await tester.enterText(
        find.byType(TextFormField).at(1), 'تحصيل دفعة عميل');
    await _selectDropdownItem(tester, index: 1, itemText: 'الخزينة الرئيسية');

    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();

    expect(cubit.createCalls, 1);
    expect(cubit.lastType, 'RECEIPT');
    expect(cubit.lastAmount, 500);
    expect(cubit.lastCounterpartyType, 'CUSTOMER');
    expect(cubit.lastCounterpartyId, 'customer-1');
    expect(cubit.lastTreasuryId, 'treasury-1');
    // التحميل الكسول: جلب واحد فقط رغم تغييرات الواجهة.
    expect(cubit.counterpartyFetchCount['CUSTOMER'], 1);
    expect(find.text('تم تسجيل السند بنجاح'), findsOneWidget);
  });

  testWidgets('counterparty required when a type is selected', (tester) async {
    final cubit = _FakeAccountingCubit()
      ..counterparties = const [_customer];
    await _pumpScreen(tester, cubit);
    await _openVoucherDialog(tester);

    await _selectDropdownItem(tester, index: 2, itemText: 'عميل');
    await tester.enterText(find.byType(TextFormField).at(0), '500');
    await tester.enterText(
        find.byType(TextFormField).at(1), 'تحصيل دفعة عميل');
    await _selectDropdownItem(tester, index: 1, itemText: 'الخزينة الرئيسية');

    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('اختر الطرف المقابل'), findsOneWidget);
    expect(cubit.createCalls, 0);
  });

  testWidgets('counterparty load failure shows retry and recovers',
      (tester) async {
    final cubit = _FakeAccountingCubit()
      ..counterparties = const [_customer]
      ..counterpartyError = StateError('network down');
    await _pumpScreen(tester, cubit);
    await _openVoucherDialog(tester);

    await _selectDropdownItem(tester, index: 2, itemText: 'مورد');
    expect(cubit.counterpartyFetchCount['SUPPLIER'], 1);
    expect(
      find.textContaining('تعذر تحميل الأطراف المقابلة'),
      findsOneWidget,
    );
    expect(find.text('إعادة المحاولة'), findsOneWidget);

    // زوال الخطأ → إعادة المحاولة تعرض المنتقي.
    cubit.counterpartyError = null;
    final retryButton = find.text('إعادة المحاولة');
    await tester.ensureVisible(retryButton);
    await tester.pumpAndSettle();
    await tester.tap(retryButton);
    await tester.pumpAndSettle();
    expect(cubit.counterpartyFetchCount['SUPPLIER'], 2);
    expect(find.textContaining('تعذر تحميل الأطراف المقابلة'), findsNothing);
  });

  testWidgets('voucher details sheet shows data + linked journal entry lines',
      (tester) async {
    final cubit = _FakeAccountingCubit(
      vouchers: const [_voucher],
      accounts: _accounts,
    )
      ..counterparties = const [_customer]
      ..journalEntry = _journalEntry;
    await _pumpScreen(tester, cubit);

    await tester.tap(find.text('تحصيل دفعة من عميل'));
    await tester.pumpAndSettle();

    // بيانات السند.
    expect(find.text('سند قبض'), findsOneWidget);
    expect(find.textContaining('الكود: VCH-20260907-01'), findsOneWidget);
    expect(find.text('500.00'), findsOneWidget);
    expect(find.text('2026-09-07'), findsOneWidget);
    expect(find.textContaining('REF-9'), findsOneWidget);
    // الطرف المقابل محلول بالاسم (لا UUID خام).
    expect(find.textContaining('مصنع النور'), findsOneWidget);
    expect(find.textContaining('customer-1'), findsNothing);

    // القيد المرتبط وبنوده بأسماء الحسابات.
    expect(find.text('القيد المحاسبي المرتبط'), findsOneWidget);
    expect(find.text('JE-20260907-01'), findsOneWidget);
    expect(find.text('قيد آلي'), findsOneWidget);
    expect(find.text('بنود القيد'), findsOneWidget);
    expect(find.textContaining('الخزينة (1000)'), findsOneWidget);
    expect(find.textContaining('ذمم العملاء (1100)'), findsOneWidget);
    expect(find.text('تحصيل نقدي'), findsOneWidget);
    expect(find.text('مدين'), findsOneWidget);
    expect(find.text('دائن'), findsOneWidget);
  });

  testWidgets('voucher details sheet explains missing linked entry',
      (tester) async {
    final cubit = _FakeAccountingCubit(
      vouchers: const [_voucher],
      accounts: _accounts,
    )..journalEntry = null;
    await _pumpScreen(tester, cubit);

    await tester.tap(find.text('تحصيل دفعة من عميل'));
    await tester.pumpAndSettle();

    expect(find.text('سند قبض'), findsOneWidget);
    expect(
      find.textContaining('لم يُعثر على القيد المحاسبي المرتبط'),
      findsOneWidget,
    );
  });

  testWidgets('trial balance tab: totals card + balanced indicator + rows',
      (tester) async {
    final cubit = _FakeAccountingCubit(
      trialBalanceRows: const [
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
        {
          'code': '2100',
          'name': 'حساب صفر',
          'totalDebit': 0,
          'totalCredit': 0,
          'balance': 0,
        },
      ],
      totalDebit: 500,
      totalCredit: 500,
      balanced: true,
    );
    await _pumpScreen(tester, cubit);

    await tester.tap(find.text('ميزان المراجعة'));
    await tester.pumpAndSettle();

    expect(find.text('الميزان متوازن'), findsOneWidget);
    expect(find.text('الميزان غير متوازن'), findsNothing);
    expect(find.text('إجمالي المدين'), findsOneWidget);
    expect(find.text('إجمالي الدائن'), findsOneWidget);
    expect(find.textContaining('500.00'), findsWidgets);
    // جدول الحسابات: صفوف الحركة فقط بلا الحسابات الصفرية.
    expect(find.text('الحساب'), findsOneWidget);
    expect(find.text('مدين'), findsWidgets);
    expect(find.text('دائن'), findsWidgets);
    expect(find.text('الرصيد'), findsOneWidget);
    expect(find.text('الخزينة'), findsOneWidget);
    expect(find.text('ذمم العملاء'), findsOneWidget);
    expect(find.text('حساب صفر'), findsNothing);
  });

  testWidgets('trial balance tab: unbalanced indicator turns red state',
      (tester) async {
    final cubit = _FakeAccountingCubit(
      trialBalanceRows: const [
        {
          'code': '1000',
          'name': 'الخزينة',
          'totalDebit': 600,
          'totalCredit': 0,
          'balance': 600,
        },
      ],
      totalDebit: 600,
      totalCredit: 500,
      balanced: false,
    );
    await _pumpScreen(tester, cubit);

    await tester.tap(find.text('ميزان المراجعة'));
    await tester.pumpAndSettle();

    expect(find.text('الميزان غير متوازن'), findsOneWidget);
    expect(find.text('الميزان متوازن'), findsNothing);
  });

  testWidgets('journal entries tab: list with compact lines + status chips',
      (tester) async {
    final cubit = _FakeAccountingCubit(
      accounts: _accounts,
      journalEntries: const [
        _journalEntry,
        {
          'id': 'entry-2',
          'code': 'JE-20260907-02',
          'description': 'قيد عكسي تجريبي',
          'date': '2026-09-08T10:30:00Z',
          'isAuto': false,
          'isReversed': true,
          'lines': [
            {
              'debitAccountId': 'account-ar',
              'creditAccountId': 'account-cash',
              'amount': 200,
            },
          ],
        },
      ],
    );
    await _pumpScreen(tester, cubit);

    await tester.tap(find.text('القيود'));
    await tester.pumpAndSettle();

    expect(find.text('JE-20260907-01'), findsOneWidget);
    expect(find.text('JE-20260907-02'), findsOneWidget);
    expect(find.text('سند قبض: تحصيل دفعة من عميل'), findsOneWidget);
    expect(find.text('قيد عكسي تجريبي'), findsOneWidget);
    // شرائح الحالة: آلي/يدوي + معكوس.
    expect(find.text('آلي'), findsOneWidget);
    expect(find.text('يدوي'), findsOneWidget);
    expect(find.text('معكوس'), findsOneWidget);
    // بنود مختصرة بأسماء الحسابات والمبالغ المنسقة.
    expect(find.textContaining('مدين: الخزينة (1000)'), findsOneWidget);
    expect(find.textContaining('دائن: ذمم العملاء (1100)'), findsOneWidget);
    expect(find.textContaining('500.00 جنيه'), findsOneWidget);
    expect(find.textContaining('بواسطة: أمين الصندوق'), findsOneWidget);
  });

  testWidgets('journal entries tab: fetch error shows retry view',
      (tester) async {
    final cubit = _FakeAccountingCubit();
    cubit.emit(
      (cubit.state as AccountingLoaded)
          .copyWith(journalEntriesError: 'ليس لديك صلاحية لتنفيذ هذا الإجراء'),
    );
    await _pumpScreen(tester, cubit);

    await tester.tap(find.text('القيود'));
    await tester.pumpAndSettle();

    expect(find.text('ليس لديك صلاحية لتنفيذ هذا الإجراء'), findsOneWidget);
    expect(find.text('إعادة المحاولة'), findsOneWidget);
  });

  testWidgets('trial balance tab: fetch error shows retry view',
      (tester) async {
    final cubit = _FakeAccountingCubit();
    cubit.emit(
      (cubit.state as AccountingLoaded)
          .copyWith(trialBalanceError: 'تعذر الاتصال بالخادم'),
    );
    await _pumpScreen(tester, cubit);

    await tester.tap(find.text('ميزان المراجعة'));
    await tester.pumpAndSettle();

    expect(find.text('تعذر الاتصال بالخادم'), findsOneWidget);
    expect(find.text('إعادة المحاولة'), findsOneWidget);
  });

  testWidgets('voucher list card formats amount and date', (tester) async {
    final cubit = _FakeAccountingCubit(vouchers: const [_voucher]);
    await _pumpScreen(tester, cubit);

    expect(find.textContaining('المبلغ: 500.00 جنيه'), findsOneWidget);
    expect(find.textContaining('2026-09-07'), findsOneWidget);
    expect(find.text('قبض'), findsOneWidget);
  });
}
