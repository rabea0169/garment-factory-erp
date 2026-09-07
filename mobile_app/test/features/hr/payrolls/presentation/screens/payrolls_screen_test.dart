import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/widgets/app_feedback.dart';
import 'package:garment_factory_erp/features/hr/payrolls/presentation/cubit/payrolls_cubit.dart';
import 'package:garment_factory_erp/features/hr/payrolls/presentation/cubit/payrolls_state.dart';
import 'package:garment_factory_erp/features/hr/payrolls/presentation/screens/payrolls_screen.dart';

/// MOB-8: شاشة كشوف الرواتب — حالات الواجهة (تحميل/قائمة/فراغ بالمرشح/
/// خطأ) وشرائح المرشح + السحب للتحديث، بـ cubit وهمي يصدر حالة واحدة
/// (نمط المستودع — بلا شبكة).
void main() {
  final payrolls = <Map<String, dynamic>>[
    {
      'id': 'p-1',
      'workerId': 'w-1',
      'periodStart': '2026-08-01T00:00:00.000Z',
      'periodEnd': '2026-08-31T00:00:00.000Z',
      'grossAmount': 5000,
      'advanceDeduct': 300,
      'absenceDeduct': 200,
      'netAmount': 4500,
      'status': 'PAID',
      'createdAt': '2026-09-01T10:00:00.000Z',
      'worker': {'id': 'w-1', 'name': 'أحمد محمود', 'code': 'W-001'},
    },
    {
      'id': 'p-2',
      'workerId': 'w-2',
      'periodStart': '2026-08-01T00:00:00.000Z',
      'periodEnd': '2026-08-31T00:00:00.000Z',
      'grossAmount': 3200,
      'advanceDeduct': 0,
      'absenceDeduct': 100,
      'netAmount': 3100,
      'status': 'DRAFT',
      'createdAt': '2026-09-01T10:00:00.000Z',
      'worker': {'id': 'w-2', 'name': 'سعيد علي', 'code': 'W-002'},
    },
  ];

  testWidgets('تحميل → AppLoadingView برسالة الكشوف', (tester) async {
    await _pump(tester, const PayrollsLoading(filter: PayrollStatusFilter.all));
    expect(find.byType(AppLoadingView), findsOneWidget);
    expect(find.text('جاري تحميل الكشوف...'), findsOneWidget);
  });

  testWidgets('محملة → بطاقات العامل والفترة والصافي والحالة وشرائح المرشح',
      (tester) async {
    await _pump(
      tester,
      PayrollsLoaded(payrolls: payrolls, filter: PayrollStatusFilter.all),
    );

    // أسماء العمال من كائن worker المتداخل.
    expect(find.text('أحمد محمود'), findsOneWidget);
    expect(find.text('سعيد علي'), findsOneWidget);
    // الصافي والفترة.
    expect(find.textContaining('4500.00'), findsOneWidget);
    expect(find.textContaining('2026-08-01 → 2026-08-31'), findsNWidgets(2));

    // الحالة في بطاقة العرض (المفتاح "مدفوع" موجود أيضًا كشريحة مرشح —
    // لذا نصادفه مرتين: شريحة + شارة حالة، وكذلك "مسودة").
    expect(find.text('مدفوع'), findsNWidgets(2));
    expect(find.text('مسودة'), findsNWidgets(2));

    // شرائح المرشح الأربع موجودة.
    expect(find.widgetWithText(ChoiceChip, 'الكل'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, 'معتمد'), findsOneWidget);
  });

  testWidgets('فراغ بلا مرشح → AppEmptyView بالرسالة العامة', (tester) async {
    await _pump(tester, const PayrollsEmpty(filter: PayrollStatusFilter.all));
    expect(find.byType(AppEmptyView), findsOneWidget);
    expect(find.text('لا توجد كشوف رواتب'), findsOneWidget);
    expect(find.textContaining('لم تُنشأ أي كشوف بعد'), findsOneWidget);
  });

  testWidgets('فراغ بمرشح → الرسالة تحمل اسم الحالة', (tester) async {
    await _pump(tester, const PayrollsEmpty(filter: PayrollStatusFilter.paid));
    expect(find.byType(AppEmptyView), findsOneWidget);
    expect(find.text('لا توجد كشوف بحالة "مدفوع"'), findsOneWidget);
  });

  testWidgets('خطأ → AppErrorView بالرسالة', (tester) async {
    await _pump(
      tester,
      const PayrollsError(
        message: 'تعذر الاتصال بالخادم',
        filter: PayrollStatusFilter.all,
      ),
    );
    expect(find.byType(AppErrorView), findsOneWidget);
    expect(find.text('تعذر الاتصال بالخادم'), findsOneWidget);
  });

  testWidgets('شريحة مرشح → setFilter بالنسبة الصحيحة', (tester) async {
    final cubit = _TrackingPayrollsCubit(
      PayrollsLoaded(payrolls: payrolls, filter: PayrollStatusFilter.all),
    );
    await _pump(tester, null, cubit: cubit);

    expect(cubit.setFilterCalls, isEmpty);
    // الضغط على شريحة "مدفوع" تحديدًا (لا شارة الحالة بنفس النص).
    await tester.tap(find.widgetWithText(ChoiceChip, 'مدفوع'));
    await tester.pump();

    expect(cubit.setFilterCalls, [PayrollStatusFilter.paid]);
  });

  testWidgets('إعادة المحاولة من حالة الخطأ تعيد الجلب', (tester) async {
    final cubit = _TrackingPayrollsCubit(
      const PayrollsError(
        message: 'خطأ داخلي',
        filter: PayrollStatusFilter.all,
      ),
    );
    await _pump(tester, null, cubit: cubit);

    expect(cubit.fetchCalls, 0);
    await tester.tap(find.text('إعادة المحاولة'));
    await tester.pump();
    expect(cubit.fetchCalls, 1);
  });

  // ===================== GF-IMP-W3: أزرار إجراءات الدورة =====================

  final actionPayrolls = <Map<String, dynamic>>[
    payroll('p-1', 'DRAFT'),
    payroll('p-2', 'APPROVED'),
    payroll('p-3', 'PAID'),
  ];

  testWidgets('أزرار حسب الحالة: DRAFT اعتماد+إبطال، APPROVED دفع، PAID لا شيء',
      (tester) async {
    final cubit = _ActionsTrackingCubit(
      PayrollsLoaded(payrolls: actionPayrolls, filter: PayrollStatusFilter.all),
    );
    await _pump(tester, null, cubit: cubit);
    await tester.pumpAndSettle();

    // بطاقة المسودة: زرا الاعتماد والإبطال.
    expect(find.widgetWithText(FilledButton, 'اعتماد'), findsOneWidget);
    expect(find.widgetWithText(TextButton, 'إبطال'), findsOneWidget);
    // بطاقة المعتمد: زر الدفع.
    expect(find.widgetWithText(FilledButton, 'دفع'), findsOneWidget);
    // المدفوع: لا أزرار — مجموع الأزرار = 3 فقط.
    expect(
      find.descendant(
        of: find.byType(Card),
        matching: find.byType(FilledButton),
      ),
      findsNWidgets(2),
    );
    expect(
      find.descendant(of: find.byType(Card), matching: find.byType(TextButton)),
      findsOneWidget,
    );
    // FAB "كشف جديد".
    expect(find.widgetWithText(FloatingActionButton, 'كشف جديد'), findsOneWidget);
  });

  testWidgets('زر الاعتماد يستدعي approvePayroll بمعرف الكشف', (tester) async {
    final cubit = _ActionsTrackingCubit(
      PayrollsLoaded(payrolls: actionPayrolls, filter: PayrollStatusFilter.all),
    );
    await _pump(tester, null, cubit: cubit);
    await tester.pumpAndSettle();

    await tester.tap(find.text('اعتماد'));
    await tester.pump();

    expect(cubit.approvePayrollCalls, ['p-1']);
  });

  testWidgets('زر الإبطال يطلب تأكيدًا ثم يستدعي cancelPayroll', (tester) async {
    final cubit = _ActionsTrackingCubit(
      PayrollsLoaded(payrolls: actionPayrolls, filter: PayrollStatusFilter.all),
    );
    await _pump(tester, null, cubit: cubit);
    await tester.pumpAndSettle();

    await tester.tap(find.text('إبطال'));
    await tester.pumpAndSettle();

    // حوار التأكيد ظاهر — التأكيد يستدعي الإبطال.
    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.tap(find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text('إبطال'),
    ));
    await tester.pumpAndSettle();

    expect(cubit.cancelPayrollCalls, ['p-1']);
    expect(find.text('تم إبطال كشف الراتب'), findsOneWidget);
  });

  testWidgets('زر الدفع يفتح حوار الخزينة ويمرر المختار إلى payPayroll',
      (tester) async {
    final cubit = _ActionsTrackingCubit(
      PayrollsLoaded(payrolls: actionPayrolls, filter: PayrollStatusFilter.all),
    );
    await _pump(tester, null, cubit: cubit);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'دفع'));
    await tester.pumpAndSettle();

    // حوار الدفع مع قائمة الخزائن (الافتراضية الأولى مختارة).
    expect(find.text('دفع كشف الراتب'), findsOneWidget);
    expect(find.text('الخزينة الرئيسية'), findsOneWidget);

    await tester.tap(find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text('دفع'),
    ));
    await tester.pumpAndSettle();

    expect(cubit.payPayrollCalls, [('p-2', 't-1')]);
    expect(find.text('تم دفع كشف الراتب وترحيله من الخزينة'), findsOneWidget);
  });

  testWidgets('فشل جلب الخزائن → تلميح داخل حوار الدفع', (tester) async {
    final cubit = _ActionsTrackingCubit(
      PayrollsLoaded(payrolls: actionPayrolls, filter: PayrollStatusFilter.all),
    )..treasuriesResult = const [];
    await _pump(tester, null, cubit: cubit);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'دفع'));
    await tester.pumpAndSettle();

    expect(find.textContaining('لا توجد خزائن'), findsOneWidget);
  });

  testWidgets('FAB "كشف جديد" → الحوار يستدعي createPayroll بالوسائط',
      (tester) async {
    final cubit = _ActionsTrackingCubit(
      PayrollsLoaded(payrolls: actionPayrolls, filter: PayrollStatusFilter.all),
    );
    await _pump(tester, null, cubit: cubit);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FloatingActionButton, 'كشف جديد'));
    await tester.pumpAndSettle();

    // العمال جلبوا والحوار جاهز (أول عامل افتراضيًا).
    expect(find.text('كشف راتب جديد'), findsOneWidget);
    expect(find.text('أحمد محمود (W-001)'), findsOneWidget);

    await tester.enterText(
        find.widgetWithText(TextFormField, 'من (yyyy-MM-dd)'), '2026-08-01');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'إلى (yyyy-MM-dd)'), '2026-08-31');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'مكافأة إضافية (اختياري)'), '150');
    await tester.tap(find.text('إنشاء الكشف'));
    await tester.pumpAndSettle();

    expect(cubit.createPayrollCalls, hasLength(1));
    final call = cubit.createPayrollCalls.single;
    expect(call['workerId'], 'w-1');
    expect(call['from'], DateTime(2026, 8, 1));
    expect(call['to'], DateTime(2026, 8, 31));
    expect(call['bonus'], 150);
    expect(find.text('تم إنشاء كشف الراتب (مسودة) بنجاح'), findsOneWidget);
  });

  testWidgets('تحقق حقول الحوار: تاريخ غير صالح يمنع الإنشاء', (tester) async {
    final cubit = _ActionsTrackingCubit(
      PayrollsLoaded(payrolls: actionPayrolls, filter: PayrollStatusFilter.all),
    );
    await _pump(tester, null, cubit: cubit);
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FloatingActionButton, 'كشف جديد'));
    await tester.pumpAndSettle();

    await tester.enterText(
        find.widgetWithText(TextFormField, 'من (yyyy-MM-dd)'), 'not-a-date');
    await tester.tap(find.text('إنشاء الكشف'));
    await tester.pump();

    expect(find.text('تاريخ غير صالح'), findsOneWidget);
    expect(cubit.createPayrollCalls, isEmpty);
  });
}

Future<void> _pump(
  WidgetTester tester,
  PayrollsState? state, {
  PayrollsCubit? cubit,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: PayrollsScreen(cubit: cubit ?? _StaticPayrollsCubit(state!)),
    ),
  );
  await tester.pump();
  await tester.pump();
}

/// cubit وهمي يصدر حالة واحدة ولا يستعلم الشبكة (نمط المستودع).
class _StaticPayrollsCubit extends PayrollsCubit {
  _StaticPayrollsCubit(PayrollsState state) : super() {
    emit(state);
  }

  @override
  Future<void> fetchPayrolls({bool refreshing = false}) async {}
}

class _TrackingPayrollsCubit extends _StaticPayrollsCubit {
  _TrackingPayrollsCubit(super.state);

  int fetchCalls = 0;
  final List<PayrollStatusFilter> setFilterCalls = <PayrollStatusFilter>[];

  @override
  Future<void> fetchPayrolls({bool refreshing = false}) async => fetchCalls++;

  @override
  Future<void> setFilter(PayrollStatusFilter filter) async =>
      setFilterCalls.add(filter);
}

/// GF-IMP-W3: cubit تتبع لأفعال الدورة — يسجل الاستدعاءات ويعيد نجاحًا.
class _ActionsTrackingCubit extends _TrackingPayrollsCubit {
  _ActionsTrackingCubit(super.state);

  final List<String> approvePayrollCalls = <String>[];
  final List<String> cancelPayrollCalls = <String>[];
  final List<(String, String?)> payPayrollCalls = <(String, String?)>[];
  final List<Map<String, dynamic>> createPayrollCalls =
      <Map<String, dynamic>>[];

  List<Map<String, dynamic>> treasuriesResult = [
    {'id': 't-1', 'name': 'الخزينة الرئيسية'},
    {'id': 't-2', 'name': 'خزينة المصنع'},
  ];

  @override
  Future<String?> approvePayroll(String id) async {
    approvePayrollCalls.add(id);
    return null;
  }

  @override
  Future<String?> cancelPayroll(String id) async {
    cancelPayrollCalls.add(id);
    return null;
  }

  @override
  Future<String?> payPayroll(String id, {String? treasuryId}) async {
    payPayrollCalls.add((id, treasuryId));
    return null;
  }

  @override
  Future<String?> createPayroll({
    required String workerId,
    DateTime? from,
    DateTime? to,
    double? bonus,
    double? deductions,
    String? notes,
  }) async {
    createPayrollCalls.add({
      'workerId': workerId,
      'from': from,
      'to': to,
      'bonus': bonus,
      'deductions': deductions,
      'notes': notes,
    });
    return null;
  }

  @override
  Future<List<Map<String, dynamic>>> fetchWorkers() async => [
        {'id': 'w-1', 'name': 'أحمد محمود', 'code': 'W-001'},
        {'id': 'w-2', 'name': 'سعيد علي', 'code': 'W-002'},
      ];

  @override
  Future<List<Map<String, dynamic>>> fetchTreasuries() async =>
      treasuriesResult;
}

Map<String, dynamic> payroll(String id, String status) =>
    <String, dynamic>{
      'id': id,
      'workerId': 'w-$id',
      'periodStart': '2026-08-01T00:00:00.000Z',
      'periodEnd': '2026-08-31T00:00:00.000Z',
      'grossAmount': 5000,
      'advanceDeduct': 300,
      'absenceDeduct': 200,
      'netAmount': 4500,
      'status': status,
      'createdAt': '2026-09-01T10:00:00.000Z',
      'worker': {'id': 'w-$id', 'name': 'عامل $id', 'code': 'W-00$id'},
    };
