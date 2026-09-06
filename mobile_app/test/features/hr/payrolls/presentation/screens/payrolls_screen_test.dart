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
    expect(find.text('لم تُنشأ أي كشوف بعد'), findsOneWidget);
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
