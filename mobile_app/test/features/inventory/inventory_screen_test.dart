import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:garment_factory_erp/core/router/app_router.dart';
import 'package:garment_factory_erp/features/inventory/presentation/cubit/inventory_cubit.dart';
import 'package:garment_factory_erp/features/inventory/presentation/cubit/inventory_state.dart';
import 'package:garment_factory_erp/features/inventory/presentation/screens/inventory_screen.dart';

const _cotton = {
  'id': 'm-1',
  'name': 'قطن مصري',
  'code': 'RM-001',
  'sku': 'SKU-COTTON-001',
  'currentStock': 40,
  'minStockLevel': 10,
  'unit': 'متر',
};

const _polyester = {
  'id': 'm-2',
  'name': 'قماش بوليستر',
  'code': 'RM-002',
  'sku': 'SKU-POLY-002',
  'currentStock': 15,
  'minStockLevel': 5,
  'unit': 'متر',
};

// نفس أسلوب quality_screen_test — cubit مزيف يحقن في الشاشة.
class _FakeInventoryCubit extends InventoryCubit {
  _FakeInventoryCubit(InventoryState initialState) {
    emit(initialState);
  }

  int fetchCalls = 0;

  @override
  Future<void> fetchInventoryData() async {
    fetchCalls++;
  }
}

// مسار ماسح بديل (stub route) — يرجع الكود عبر pop تمامًا كما تفعل
// شاشة BarcodeScannerScreen الحقيقية (Navigator.pop(context, code)).
class _StubScannerPage extends StatelessWidget {
  const _StubScannerPage({this.result});

  final String? result;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ماسح تجريبي')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ElevatedButton(
              onPressed: () => Navigator.of(context).pop(result),
              child: const Text('رجوع بباركود'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('رجوع بدون مسح'),
            ),
          ],
        ),
      ),
    );
  }
}

Future<_FakeInventoryCubit> _pumpInventory(
  WidgetTester tester, {
  required InventoryState initialState,
}) async {
  final cubit = _FakeInventoryCubit(initialState);
  await tester.pumpWidget(MaterialApp(home: InventoryScreen(cubit: cubit)));
  await tester.pump();
  return cubit;
}

GoRouter _routerWith(InventoryCubit cubit, {String? scanResult}) {
  return GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        builder: (_, __) => InventoryScreen(cubit: cubit),
      ),
      GoRoute(
        path: AppRouter.barcodeScanner,
        builder: (_, __) => _StubScannerPage(result: scanResult),
      ),
    ],
  );
}

void main() {
  testWidgets('shows a loading indicator while fetching', (tester) async {
    await _pumpInventory(tester, initialState: InventoryLoading());

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('the scan button opens the scanner and returns the SKU',
      (tester) async {
    final cubit = _FakeInventoryCubit(
      InventoryLoaded(
        rawMaterials: [_cotton, _polyester],
        finishedGoods: const [],
        lowStockMaterials: const [],
      ),
    );
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: _routerWith(cubit, scanResult: 'SKU-POLY-002'),
      ),
    );
    await tester.pumpAndSettle();

    // زر المسح يفتح مسار الماسح (stub لنفس المسار الحقيقي /barcode-scanner).
    await tester.tap(find.byTooltip('مسح الباركود'));
    await tester.pumpAndSettle();
    expect(find.byType(_StubScannerPage), findsOneWidget);

    // الماسح يرجع الكود عبر pop → حقل البحث يمتلئ والفلترة تنشط فورًا.
    await tester.tap(find.text('رجوع بباركود'));
    await tester.pumpAndSettle();

    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, 'SKU-POLY-002');
    expect(find.text('قماش بوليستر'), findsOneWidget);
    expect(find.text('قطن مصري'), findsNothing);
  });

  testWidgets('cancelling the scanner keeps the search empty', (tester) async {
    final cubit = _FakeInventoryCubit(
      InventoryLoaded(
        rawMaterials: [_cotton, _polyester],
        finishedGoods: const [],
        lowStockMaterials: const [],
      ),
    );
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: _routerWith(cubit),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('مسح الباركود'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('رجوع بدون مسح'));
    await tester.pumpAndSettle();

    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, '');
    expect(find.text('قطن مصري'), findsOneWidget);
    expect(find.text('قماش بوليستر'), findsOneWidget);
  });

  testWidgets('shows the empty state with a retry action', (tester) async {
    final cubit = await _pumpInventory(
      tester,
      initialState: InventoryLoaded(
        rawMaterials: const [],
        finishedGoods: const [],
        lowStockMaterials: const [],
      ),
    );

    expect(find.text('لا توجد مواد خام'), findsOneWidget);
    expect(find.byIcon(Icons.inbox_outlined), findsOneWidget);

    await tester.tap(find.text('إعادة التحميل'));
    await tester.pump();
    expect(cubit.fetchCalls, 1);
  });

  testWidgets('shows the offline placeholder when no data is cached',
      (tester) async {
    final cubit = await _pumpInventory(
      tester,
      initialState: InventoryOffline(),
    );

    expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    expect(
      find.text('تعذر الاتصال بالخادم، تحقق من الشبكة وحاول مرة أخرى'),
      findsOneWidget,
    );

    await tester.tap(find.text('إعادة المحاولة'));
    await tester.pump();
    expect(cubit.fetchCalls, 1);
  });

  testWidgets('keeps showing the cached data with an offline banner',
      (tester) async {
    await _pumpInventory(
      tester,
      initialState: InventoryOffline(
        snapshot: InventoryLoaded(
          rawMaterials: [_cotton],
          finishedGoods: const [],
          lowStockMaterials: const [],
        ),
      ),
    );

    expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    expect(
      find.text('انقطع الاتصال — تُعرض آخر بيانات محفوظة'),
      findsOneWidget,
    );
    // آخر بيانات ناجحة (من الذاكرة) ما زالت ظاهرة — لا شاشة فارغة.
    expect(find.text('قطن مصري'), findsOneWidget);
  });

  testWidgets('shows the error view for non-auth failures', (tester) async {
    await _pumpInventory(
      tester,
      initialState: InventoryError('حدث خطأ غير متوقع، حاول مرة أخرى'),
    );

    expect(find.byIcon(Icons.cloud_off), findsOneWidget);
    expect(find.text('حدث خطأ غير متوقع، حاول مرة أخرى'), findsOneWidget);
  });

  // 401: يعرض الشاشة رسالة انتهاء الجلسة. إعادة التوجيه لشاشة الدخول
  // يجريها ApiClient عالميًا (onUnauthorized → AppRouter.goToLogin في
  // main.dart) — الـ cubit يبث InventoryUnauthorized فقط.
  testWidgets('shows the session-expired view on 401', (tester) async {
    await _pumpInventory(
      tester,
      initialState: InventoryUnauthorized(),
    );

    expect(
      find.text('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى'),
      findsOneWidget,
    );
  });
}
