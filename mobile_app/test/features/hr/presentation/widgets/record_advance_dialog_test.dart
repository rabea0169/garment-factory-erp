import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/hr/presentation/cubit/hr_cubit.dart';
import 'package:garment_factory_erp/features/hr/presentation/widgets/record_advance_dialog.dart';

/// COMM-F05: حوار تسجيل السلفة — تحقق الحقول، تعطيل الترحيل النقدي عند
/// فشل جلب الخزائن (تلميح "لا توجد خزائن")، وإرسال الوسائط الصحيحة
/// إلى HrCubit.recordAdvance (الـ cubit يُمرَّر عبر constructor).
void main() {
  testWidgets('فشل جلب الخزائن → خيار الترحيل معطل مع تلميح "لا توجد خزائن"',
      (tester) async {
    final cubit = _FakeHrCubit()
      ..treasuriesResult = const <Map<String, dynamic>>[];
    await _pumpDialog(tester, cubit);
    await tester.pumpAndSettle();

    final switchTile =
        tester.widget<SwitchListTile>(find.byType(SwitchListTile));
    expect(switchTile.onChanged, isNull);
    expect(find.textContaining('لا توجد خزائن'), findsOneWidget);
  });

  testWidgets('نجاح جلب الخزائن → خيار الترحيل مفعّل ويختار أول خزينة',
      (tester) async {
    final cubit = _FakeHrCubit()
      ..treasuriesResult = [
        {'id': 't-1', 'name': 'الخزينة الرئيسية'},
        {'id': 't-2', 'name': 'خزينة المصنع'},
      ];
    await _pumpDialog(tester, cubit);
    await tester.pumpAndSettle();

    // تفعيل الترحيل النقدي.
    await tester.tap(find.byType(SwitchListTile));
    await tester.pump();

    // قائمة الخزائن ظاهرة بأول خزينة مختارة.
    expect(find.text('الخزينة الرئيسية'), findsOneWidget);

    // تعبئة النموذج والحفظ.
    await _fillAndSave(tester);
    expect(cubit.recordAdvanceCalls, hasLength(1));
    final call = cubit.recordAdvanceCalls.single;
    expect(call['workerId'], 'w-1');
    expect(call['amount'], 300);
    expect(call['reason'], 'سلفة شهرية');
    expect(call['treasuryId'], 't-1');
  });

  testWidgets('الترحيل النقدي مطفأ → treasuryId لا يُرسل', (tester) async {
    final cubit = _FakeHrCubit()
      ..treasuriesResult = [
        {'id': 't-1', 'name': 'الخزينة الرئيسية'},
      ];
    await _pumpDialog(tester, cubit);
    await tester.pumpAndSettle();

    await _fillAndSave(tester);
    expect(cubit.recordAdvanceCalls, hasLength(1));
    expect(cubit.recordAdvanceCalls.single['treasuryId'], isNull);
  });

  testWidgets('حقول ناقصة → رسائل تحقق ولا استدعاء للـ cubit', (tester) async {
    final cubit = _FakeHrCubit();
    await _pumpDialog(tester, cubit);
    await tester.pumpAndSettle();

    await tester.tap(find.text('حفظ السلفة'));
    await tester.pump();

    expect(find.text('أدخل مبلغًا موجبًا'), findsOneWidget);
    expect(find.text('سبب السلفة مطلوب'), findsOneWidget);
    expect(cubit.recordAdvanceCalls, isEmpty);
  });

  testWidgets('مبلغ غير صالح → رسالة تحقق', (tester) async {
    final cubit = _FakeHrCubit();
    await _pumpDialog(tester, cubit);
    await tester.pumpAndSettle();

    await tester.enterText(
        find.widgetWithText(TextFormField, 'مبلغ السلفة (ج.م) *'), 'abc');
    await tester.enterText(
        find.widgetWithText(TextFormField, 'سبب السلفة *'), 'سلفة');
    await tester.tap(find.text('حفظ السلفة'));
    await tester.pump();

    expect(find.text('أدخل مبلغًا موجبًا'), findsOneWidget);
    expect(cubit.recordAdvanceCalls, isEmpty);
  });

  testWidgets('خطأ من الخادم → الحوار يبقى مفتوحًا برسالة الخطأ', (tester) async {
    final cubit = _FakeHrCubit()..advanceError = 'ليس لديك صلاحية لتنفيذ هذا الإجراء';
    await _pumpDialog(tester, cubit);
    await tester.pumpAndSettle();

    await _fillAndSave(tester);
    await tester.pump();

    expect(cubit.recordAdvanceCalls, hasLength(1));
    // الحوار ما زال ظاهرًا مع رسالة الخادم.
    expect(find.text('تسجيل سلفة'), findsOneWidget);
    expect(find.text('ليس لديك صلاحية لتنفيذ هذا الإجراء'), findsOneWidget);
  });

  testWidgets('قائمة عمال فارغة → رسالة بلا نموذج', (tester) async {
    final cubit = _FakeHrCubit();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RecordAdvanceDialog(cubit: cubit, workers: const []),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('لا يوجد عمال'), findsOneWidget);
    expect(cubit.recordAdvanceCalls, isEmpty);
  });
}

Future<void> _fillAndSave(WidgetTester tester) async {
  await tester.enterText(
      find.widgetWithText(TextFormField, 'مبلغ السلفة (ج.م) *'), '300');
  await tester.enterText(
      find.widgetWithText(TextFormField, 'سبب السلفة *'), 'سلفة شهرية');
  await tester.tap(find.text('حفظ السلفة'));
  await tester.pump();
}

Future<void> _pumpDialog(WidgetTester tester, _FakeHrCubit cubit) async {
  final workers = <Map<String, dynamic>>[
    {'id': 'w-1', 'name': 'أحمد محمود', 'code': 'W-001'},
    {'id': 'w-2', 'name': 'سعيد علي', 'code': 'W-002'},
  ];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: RecordAdvanceDialog(cubit: cubit, workers: workers),
      ),
    ),
  );
  await tester.pump();
}

/// cubit وهمي يسجل الاستدعاءات (نمط create_worker_dialog_test).
class _FakeHrCubit extends HrCubit {
  final List<Map<String, dynamic>> recordAdvanceCalls =
      <Map<String, dynamic>>[];

  List<Map<String, dynamic>> treasuriesResult = const [];
  String? advanceError;

  @override
  Future<List<Map<String, dynamic>>> fetchTreasuries() async =>
      treasuriesResult;

  @override
  Future<String?> recordAdvance({
    required String workerId,
    required double amount,
    required String reason,
    String? treasuryId,
  }) async {
    recordAdvanceCalls.add({
      'workerId': workerId,
      'amount': amount,
      'reason': reason,
      'treasuryId': treasuryId,
    });
    return advanceError;
  }
}
