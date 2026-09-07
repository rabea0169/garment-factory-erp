import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/production/data/datasources/production_remote_data_source.dart';
import 'package:garment_factory_erp/features/production/data/repositories/production_repository_impl.dart';
import 'package:garment_factory_erp/features/production/domain/repositories/production_repository.dart';
import 'package:garment_factory_erp/features/production/domain/usecases/production_usecases.dart';
import 'package:garment_factory_erp/features/production/presentation/cubit/production_cubit.dart';
import 'package:garment_factory_erp/features/production/presentation/screens/production_screen.dart';

import '../../../helpers/fake_cache_service.dart';
import '../../../helpers/routing_dio_adapter.dart';

/// DEV-PQ1: حوار إنشاء أمر تشغيل — المنتجات ثم التحميل البطيء لمتغيرات
/// المنتج وBOM، والـ payload يطابق CreateWorkOrderDto حرفيًا، والنجاح
/// يعرض snackbar برمز الأمر الجديد. كل الشبكة عبر Dio مُحاكى بالمسارات.
///
/// ملاحظة: Dio يجدول مؤقتات حقيقية — داخل testWidgets (نطاق fake async)
/// يجب ضخ إطارات ليتقدم الزمن الوهمي قبل انتظار أي استدعاء شبكي.
void main() {
  late RoutingDioAdapter adapter;
  late FakeCacheService cache;
  late ProductionCubit cubit;
  late Dio dio;

  setUp(() {
    cache = FakeCacheService();
    adapter = RoutingDioAdapter({
      'GET /production/work-orders': (options) async => _workOrdersPayload,
      'GET /products': (options) async => {
            'data': [
              {
                'id': 'p-1',
                'code': 'P-001',
                'name': 'قميص رجالي',
                'variants': [],
                'bomVersions': [],
              },
            ],
            'total': 1,
            'page': 1,
            'limit': 100,
          },
      'GET /products/p-1': (options) async => {
            'id': 'p-1',
            'code': 'P-001',
            'name': 'قميص رجالي',
            'variants': [
              {
                'id': 'v-1',
                'size': 'L',
                'color': 'أبيض',
                'isActive': true,
              },
              {
                'id': 'v-inactive',
                'size': 'M',
                'color': 'أزرق',
                'isActive': false,
              },
            ],
            'bomVersions': [
              {
                'id': 'b-old',
                'versionName': 'إصدار قديم',
                'isActive': false,
                'createdAt': '2026-08-01T10:00:00.000Z',
              },
              {
                'id': 'b-active',
                'versionName': 'صيف 2026',
                'isActive': true,
                'createdAt': '2026-09-01T10:00:00.000Z',
              },
            ],
          },
      'POST /production/work-orders': (options) async => {
            'id': 'wo-new',
            'code': 'WO-0009',
            'status': 'PLANNED',
            'quantity': 50,
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
    final fetch = cubit.fetchWorkOrders();
    await tester.pumpWidget(
      MaterialApp(home: ProductionScreen(cubit: cubit, dio: dio)),
    );
    await tester.pump(const Duration(milliseconds: 50));
    await tester.pump(const Duration(milliseconds: 50));
    await fetch;
    await tester.pumpAndSettle();
  }

  Future<void> openDialogAndPickProduct(WidgetTester tester) async {
    await tester.tap(find.text('أمر تشغيل جديد'));
    await tester.pumpAndSettle();
    expect(find.text('إنشاء أمر تشغيل جديد'), findsOneWidget);
    // limit=100 على جلب المنتجات (لا 20 الافتراضية).
    expect(
      adapter.lastRequest('GET', '/products')!.queryParameters['limit'],
      100,
    );

    // اختيار المنتج يجرّ تفاصيله (التحميل البطيء عبر GET /products/:id).
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('قميص رجالي (P-001)').last);
    await tester.pumpAndSettle();
    expect(adapter.lastRequest('GET', '/products/p-1'), isNotNull);
  }

  testWidgets('يختار المنتج ثم المتغير والوصفة ويرسل payload العقد كاملًا',
      (tester) async {
    await pumpScreen(tester);
    await openDialogAndPickProduct(tester);

    // متغير وحيد نشط → مُختار تلقائيًا؛ أحدث إصدار نشط هو الافتراضي.
    expect(find.text('L - أبيض'), findsOneWidget);
    expect(find.text('صيف 2026'), findsOneWidget);
    // المتغير غير النشط لا يظهر إطلاقًا.
    expect(find.text('M - أزرق'), findsNothing);

    await tester.enterText(find.byType(TextFormField), '50');
    await tester.ensureVisible(find.text('حفظ'));
    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();

    final posted = adapter.lastRequest('POST', '/production/work-orders');
    expect(posted, isNotNull);
    // عقد CreateWorkOrderDto حرفيًا — أي حقل إضافي (مثل dueDate) يُرفض 400.
    expect(posted!.dataAsMap, {
      'productVariantId': 'v-1',
      'bomVersionId': 'b-active',
      'quantity': 50,
    });

    // نجاح: الحوار يغلق وsnackbar يعرض رمز الأمر الجديد والقائمة أعيد
    // جلبها (GET work-orders ثانية بعد الإنشاء).
    expect(find.text('إنشاء أمر تشغيل جديد'), findsNothing);
    expect(find.text('تم إنشاء أمر التشغيل WO-0009 بنجاح'), findsOneWidget);
    expect(
      adapter.requests
          .where((request) =>
              request.method == 'GET' &&
              request.path == '/production/work-orders')
          .length,
      2,
    );
  });

  testWidgets('فشل الإنشاء يبقي الحوار مفتوحًا مع رسالة الخادم',
      (tester) async {
    adapter.routes['POST /production/work-orders'] = (options) async =>
        throw fakeServerError(
            options, 400, 'معرف النسخة يجب أن يكون UUID صالحًا');
    await pumpScreen(tester);
    await openDialogAndPickProduct(tester);

    await tester.enterText(find.byType(TextFormField), '50');
    await tester.ensureVisible(find.text('حفظ'));
    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();

    // الحوار ما زال مفتوحًا والخطأ ظاهر داخله.
    expect(find.text('إنشاء أمر تشغيل جديد'), findsOneWidget);
    expect(find.text('معرف النسخة يجب أن يكون UUID صالحًا'), findsOneWidget);
  });

  testWidgets('الكمية يجب أن تكون عددًا صحيحًا موجبًا', (tester) async {
    await pumpScreen(tester);
    await openDialogAndPickProduct(tester);

    await tester.enterText(find.byType(TextFormField), 'صفر');
    await tester.ensureVisible(find.text('حفظ'));
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('أدخل عددًا صحيحًا موجبًا'), findsOneWidget);
    expect(adapter.lastRequest('POST', '/production/work-orders'), isNull);
  });
}

final Map<String, Object> _workOrdersPayload = {
  'data': [
    {
      'id': 'wo-1',
      'code': 'WO-0001',
      'quantity': 120,
      'status': 'PLANNED',
      'currentStage': null,
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
