import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/production/data/datasources/production_remote_data_source.dart';
import 'package:garment_factory_erp/features/production/data/repositories/production_repository_impl.dart';
import 'package:garment_factory_erp/features/production/domain/repositories/production_repository.dart';
import 'package:garment_factory_erp/features/production/domain/usecases/production_usecases.dart';
import 'package:garment_factory_erp/features/production/presentation/cubit/production_cubit.dart';
import 'package:garment_factory_erp/features/production/presentation/screens/production_screen.dart';
import 'package:garment_factory_erp/features/production/stage_run_registry.dart';

import '../../../helpers/fake_cache_service.dart';
import '../../../helpers/routing_dio_adapter.dart';

/// DEV-PQ2: زر/حوار استهلاك خامات المرحلة — يظهر لأوامر التشغيل الجارية،
/// يجلب الخامة والمخزن من /inventory، يملأ الوحدة من وحدة الخامة، يربط
/// الاستهلاك بـ stageRunId من السجل المحلي، ويرسل payload مطابقًا
/// لـ ConsumeMaterialDto. كل الشبكة عبر Dio مُحاكى بالمسارات.
void main() {
  late RoutingDioAdapter adapter;
  late FakeCacheService cache;
  late ProductionCubit cubit;
  late Dio dio;

  setUp(() {
    cache = FakeCacheService();
    adapter = RoutingDioAdapter({
      'GET /production/work-orders': (options) async => _workOrdersPayload,
      'GET /inventory/raw-materials': (options) async => {
            'data': [
              {
                'id': 'rm-1',
                'code': 'RM-001',
                'name': 'قماش قطني أبيض',
                'unit': 'METER',
                'isActive': true,
              },
              {
                'id': 'rm-off',
                'code': 'RM-002',
                'name': 'خيط أزرق',
                'unit': 'PIECE',
                'isActive': false,
              },
            ],
            'total': 2,
            'page': 1,
            'limit': 100,
          },
      'GET /inventory/warehouses': (options) async => {
            'data': [
              {
                'id': 'wh-1',
                'code': 'WH-01',
                'name': 'مخزن الخامات الرئيسي',
                'type': 'RAW_MATERIAL',
                'isActive': true,
              },
            ],
            'total': 1,
            'page': 1,
            'limit': 100,
          },
      'POST /production/work-orders/wo-1/material-consumptions':
          (options) async => {
            'replayed': false,
            'consumptionId': 'consumption-1',
            'workOrderId': 'wo-1',
            'stageRunId': 'stage-run-1',
            'stockLedgerEntryId': 'ledger-1',
            'actualQuantity': 12,
            'wasteQuantity': 2,
            'unitCost': 15,
            'totalCost': 180,
            'wasteCost': 30,
          },
    });
    dio = buildTestDio(adapter);
    final remote = ProductionRemoteDataSource(dio);
    final ProductionRepository repository = ProductionRepositoryImpl(remote);
    cubit = ProductionCubit(
      getWorkOrders: GetWorkOrders(repository),
      createWorkOrder: CreateWorkOrder(repository),
      transitionStage: TransitionProductionStage(repository),
      recordStageOutput: RecordProductionStageOutput(repository),
      consumeMaterial: ConsumeProductionMaterial(repository),
      finalizeCost: FinalizeProductionCost(repository),
      cache: cache,
    );
    addTearDown(cubit.close);
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    // سطح أكبر من الافتراضي (800x600) — الحوار الطويل والقوائم المنسدلة
    // العربية تحتاج ارتفاعًا أكبر وإلا فاض RenderFlex أثناء الاختبار.
    await tester.binding.setSurfaceSize(const Size(900, 1600));
    final fetch = cubit.fetchWorkOrders();
    await tester.pumpWidget(
      MaterialApp(home: ProductionScreen(cubit: cubit, dio: dio)),
    );
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));
    await fetch;
    await tester.pumpAndSettle();
  }

  Future<void> openConsumeDialog(WidgetTester tester) async {
    // فتح بطاقة أمر التشغيل الجاري (SEWING) ثم زر استهلاك الخامات.
    await tester.tap(find.text('قميص قطني (مقاس: L)'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('استهلاك خامات'));
    await tester.tap(find.text('استهلاك خامات'));
    await tester.pumpAndSettle();
    expect(find.text('استهلاك خامات — الخياطة'), findsOneWidget);
  }

  testWidgets('يسجل الاستهلاك بـ stageRunId من السجل المحلي وpayload العقد',
      (tester) async {
    // المرحلة الجارية SEWING — سجّلنا تشغيلها محليًا (كما يفعل انتقال
    // المرحلة من التطبيق).
    await rememberStageRun(
      cache,
      workOrderId: 'wo-1',
      stageApiValue: 'SEWING',
      stageRunId: 'stage-run-1',
    );
    await pumpScreen(tester);
    await openConsumeDialog(tester);

    // الخامات/المخازن جُلبت بـ limit=100 والخامة غير النشطة مستبعدة.
    expect(
      adapter.lastRequest('GET', '/inventory/raw-materials')!
          .queryParameters['limit'],
      100,
    );
    expect(find.text('خيط أزرق (RM-002)'), findsNothing);

    // اختيار الخامة والمخزن.
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('قماش قطني أبيض (RM-001)').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('مخزن الخامات الرئيسي (WH-01)').last);
    await tester.pumpAndSettle();

    // الوحدة امتلأت تلقائيًا بوحدة الخامة المترجمة (METER → متر).
    expect(find.widgetWithText(TextFormField, 'متر'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'الكمية المخططة *'),
      '10',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'الكمية الفعلية *'),
      '12',
    );
    await tester.ensureVisible(find.text('حفظ'));
    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();

    final posted = adapter.lastRequest(
      'POST',
      '/production/work-orders/wo-1/material-consumptions',
    );
    expect(posted, isNotNull);
    // عقد ConsumeMaterialDto — stageRunId من السجل المحلي لا من إدخال يدوي.
    expect(posted!.dataAsMap, {
      'stageRunId': 'stage-run-1',
      'rawMaterialId': 'rm-1',
      'warehouseId': 'wh-1',
      'plannedQuantity': 10.0,
      'actualQuantity': 12.0,
      'wasteQuantity': 0.0,
      'unit': 'متر',
    });

    // نجاح: الحوار يغلق وsnackbar التأكيد يظهر.
    expect(find.text('استهلاك خامات — الخياطة'), findsNothing);
    expect(find.text('تم تسجيل استهلاك الخامات بنجاح'), findsOneWidget);
  });

  testWidgets('بلا stageRunId محلي: تحذير واضح والحفظ معطل', (tester) async {
    await pumpScreen(tester);
    await openConsumeDialog(tester);

    expect(
      find.textContaining('معرف تشغيل المرحلة غير متوفر محليًا'),
      findsOneWidget,
    );
    final saveButton = tester.widget<FilledButton>(
      find.ancestor(
        of: find.text('حفظ'),
        matching: find.byType(FilledButton),
      ),
    );
    expect(saveButton.onPressed, isNull);
    // لم يُرسل أي استهلاك.
    expect(
      adapter.lastRequest(
        'POST',
        '/production/work-orders/wo-1/material-consumptions',
      ),
      isNull,
    );
  });

  testWidgets('الهالك لا يمكن أن يتجاوز الكمية الفعلية', (tester) async {
    await rememberStageRun(
      cache,
      workOrderId: 'wo-1',
      stageApiValue: 'SEWING',
      stageRunId: 'stage-run-1',
    );
    await pumpScreen(tester);
    await openConsumeDialog(tester);

    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('قماش قطني أبيض (RM-001)').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('مخزن الخامات الرئيسي (WH-01)').last);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextFormField, 'الكمية المخططة *'),
      '10',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'الكمية الفعلية *'),
      '12',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'كمية الهالك'),
      '20',
    );
    await tester.ensureVisible(find.text('حفظ'));
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(
      find.text('كمية الهالك يجب أن تكون بين 0 والكمية الفعلية'),
      findsOneWidget,
    );
    expect(
      adapter.lastRequest(
        'POST',
        '/production/work-orders/wo-1/material-consumptions',
      ),
      isNull,
    );
  });

  testWidgets('زر الاستهلاك لا يظهر للأوامر غير الجارية', (tester) async {
    adapter.routes['GET /production/work-orders'] = (options) async => {
          'data': [
            {
              'id': 'wo-2',
              'code': 'WO-0002',
              'quantity': 50,
              'status': 'PLANNED',
              'currentStage': null,
              'variant': {
                'size': 'M',
                'product': {'name': 'بنطال'},
              },
              'createdAt': '2026-08-27T10:00:00.000Z',
            },
          ],
          'total': 1,
          'page': 1,
          'limit': 20,
        };
    await pumpScreen(tester);

    await tester.tap(find.text('بنطال (مقاس: M)'));
    await tester.pumpAndSettle();

    // أمر مخطط بلا مرحلة جارية: لا زر استهلاك ولا زر مخرجات.
    expect(find.text('استهلاك خامات'), findsNothing);
    expect(find.text('تسجيل مخرجات المرحلة'), findsNothing);
  });
}

final Map<String, Object> _workOrdersPayload = {
  'data': [
    {
      'id': 'wo-1',
      'code': 'WO-0001',
      'quantity': 120,
      'status': 'SEWING',
      'currentStage': 'SEWING',
      'variant': {
        'size': 'L',
        'product': {'name': 'قميص قطني'},
      },
      'createdAt': '2026-08-26T10:00:00.000Z',
    },
  ],
  'total': 1,
  'page': 1,
  'limit': 20,
};
