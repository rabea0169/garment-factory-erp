import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/services/cache_service.dart';
import 'package:garment_factory_erp/features/quality/presentation/cubit/quality_cubit.dart';
import 'package:garment_factory_erp/features/quality/presentation/cubit/quality_state.dart';
import 'package:garment_factory_erp/features/quality/presentation/screens/quality_screen.dart';
import 'package:garment_factory_erp/features/production/stage_run_registry.dart';

import '../../../../helpers/fake_cache_service.dart';
import '../../../../helpers/routing_dio_adapter.dart';

/// DEV-PQ3: حوار الفحص يعتمد قوائم منسدلة (أمر التشغيل + المرحلة) بدل
/// إدخال UUID يدويًا — هذه الاختبارات تحل محل اختبارات الحقول النصية
/// القديمة التي وثقت السلوك المتقادم.
class _FakeQualityCubit extends QualityCubit {
  _FakeQualityCubit(CacheService cache) : super(cache: cache) {
    // ابدأ محمّلًا — وإلا تبقى الشاشة على AppLoadingView (دوران لانهائي
    // يفشل pumpAndSettle في الاختبار).
    emit(QualityLoaded(const []));
  }

  int submitCalls = 0;
  String? lastWorkOrderId;

  @override
  Future<void> fetchQualityChecks() async {}

  @override
  Future<String?> resolveStageRunId(
    String workOrderId,
    String stageApiValue,
  ) async {
    return 'stage-run-1';
  }

  @override
  Future<void> submitQualityCheck({
    required String workOrderId,
    required String stageRunId,
    required String stage,
    required int checkedQty,
    required int passedQty,
    required int rejectedQty,
    required int wasteQty,
    String? rejectionReason,
    String? wasteReason,
    String? notes,
  }) async {
    submitCalls++;
    lastWorkOrderId = workOrderId;
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FakeQualityCubit cubit,
  RoutingDioAdapter adapter,
) async {
  final dio = buildTestDio(adapter);
  await tester.pumpWidget(
    MaterialApp(home: QualityScreen(cubit: cubit, dio: dio)),
  );
  // Dio يجدول مؤقتات حقيقية — ضخ إطارات ليتقدم الزمن الوهمي قبل الاستقرار.
  await tester.pump(const Duration(milliseconds: 50));
  await tester.pump(const Duration(milliseconds: 50));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('التحقق: زر الحفظ معطل حتى اختيار أمر تشغيل بحلّ stageRun',
      (tester) async {
    final adapter = RoutingDioAdapter({
      'GET /production/work-orders': (options) async => <String, Object?>{
            'data': [
              {
                'id': 'wo-1',
                'code': 'WO-1',
                'status': 'IN_PROGRESS',
                'currentStage': 'SEWING',
              },
            ],
            'total': 1,
          },
    });
    final cubit = _FakeQualityCubit(FakeCacheService());
    await _pump(tester, cubit, adapter);

    await tester.tap(find.text('تقرير جديد'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pumpAndSettle();

    // الحفظ محجوب بالتصميم (onPressed = null) حتى يُختار أمر ويُحلّ
    // تشغيل المرحلة — لا يوجد إرسال ولا إغلاق للحوار.
    final saveButton = find.ancestor(
      of: find.text('حفظ'),
      matching: find.byType(FilledButton),
    );
    final button = tester.widget<FilledButton>(saveButton);
    expect(button.onPressed, isNull);
    await tester.tap(find.text('حفظ'));
    await tester.pump();
    expect(cubit.submitCalls, 0);
    expect(find.byType(AlertDialog), findsOneWidget);
  });

  testWidgets('التحقق: الرفض غير المحافظ للكميات يُمنع', (tester) async {
    final adapter = RoutingDioAdapter({
      'GET /production/work-orders': (options) async => <String, Object?>{
            'data': [
              {
                'id': 'wo-1',
                'code': 'WO-1',
                'status': 'IN_PROGRESS',
                'currentStage': 'SEWING',
              },
            ],
            'total': 1,
          },
      'GET /quality': (options) async => <String, Object?>{'data': [], 'total': 0},
    });
    final cache = FakeCacheService();
    // مرحلة مكتملة مسجلة من هذا الجهاز: SEWING بعد الانتقال إليها.
    await rememberStageRun(
      cache,
      workOrderId: 'wo-1',
      stageApiValue: 'CUTTING',
      stageRunId: 'stage-run-cutting',
    );
    final cubit = _FakeQualityCubit(cache);
    await _pump(tester, cubit, adapter);

    await tester.tap(find.text('تقرير جديد'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pumpAndSettle();

    // اختر أمر التشغيل من القائمة المنسدلة.
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('WO-1').last);
    await tester.pumpAndSettle();

    // املأ الكميات: 10 مفحوص ≠ 8+1+0.
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '10');
    await tester.enterText(fields.at(1), '8');
    await tester.enterText(fields.at(2), '1');
    await tester.enterText(fields.at(3), '0');
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(
      find.text('يجب أن يساوي المفحوص مجموع السليم والمرفوض والهالك'),
      findsOneWidget,
    );
    expect(cubit.submitCalls, 0);
  });

  testWidgets('النجاح: يرسل بأمر التشغيل المختار وstageRun من السجل',
      (tester) async {
    final adapter = RoutingDioAdapter({
      'GET /production/work-orders': (options) async => <String, Object?>{
            'data': [
              {
                'id': 'wo-1',
                'code': 'WO-1',
                'status': 'IN_PROGRESS',
                'currentStage': 'SEWING',
              },
            ],
            'total': 1,
          },
      'GET /quality': (options) async => <String, Object?>{'data': [], 'total': 0},
    });
    final cache = FakeCacheService();
    await rememberStageRun(
      cache,
      workOrderId: 'wo-1',
      stageApiValue: 'CUTTING',
      stageRunId: 'stage-run-cutting',
    );
    final cubit = _FakeQualityCubit(cache);
    await _pump(tester, cubit, adapter);

    await tester.tap(find.text('تقرير جديد'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('WO-1').last);
    await tester.pumpAndSettle();

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '10');
    await tester.enterText(fields.at(1), '10');
    await tester.enterText(fields.at(2), '0');
    await tester.enterText(fields.at(3), '0');
    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();

    expect(cubit.submitCalls, 1);
    expect(cubit.lastWorkOrderId, 'wo-1');
  });
}
