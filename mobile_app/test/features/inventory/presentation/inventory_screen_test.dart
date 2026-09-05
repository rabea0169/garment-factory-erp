import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/services/barcode_scanner_launcher.dart';
import 'package:garment_factory_erp/core/widgets/app_feedback.dart';
import 'package:garment_factory_erp/features/inventory/presentation/cubit/inventory_cubit.dart';
import 'package:garment_factory_erp/features/inventory/presentation/cubit/inventory_state.dart';
import 'package:garment_factory_erp/features/inventory/presentation/screens/inventory_screen.dart';

/// GF-REMAINING-008: حالات شاشة المخزون loading/empty/error/offline مختبرة،
/// وزر المسح يفتح الماسح (عبر launcher قابل للحقن) ويرجع SKU يملأ البحث.
/// لا mock صامت: كل حالة تُثبَت بالمحتوى المرئي المتوقع.
void main() {
  const materials = [
    {
      'id': 'rm-1',
      'code': 'RM-001',
      'name': 'قماش قطني أبيض',
      'unit': 'متر',
      'currentStock': 150.0,
      'minStockLevel': 50.0,
    },
    {
      'id': 'rm-2',
      'code': 'SKU-987',
      'name': 'خيط أزرق',
      'unit': 'بكرة',
      'currentStock': 90.0,
      'minStockLevel': 20.0,
    },
  ];

  testWidgets('loading state shows AppLoadingView', (tester) async {
    await _pump(tester, state: InventoryLoading());
    expect(find.byType(AppLoadingView), findsOneWidget);
    expect(find.byType(AppOfflineView), findsNothing);
  });

  testWidgets('loaded state renders the raw materials list', (tester) async {
    await _pump(
      tester,
      state: InventoryLoaded(
        rawMaterials: materials,
        finishedGoods: const [],
        lowStockMaterials: const [],
      ),
    );
    expect(find.text('قماش قطني أبيض'), findsOneWidget);
    expect(find.text('خيط أزرق'), findsOneWidget);
  });

  testWidgets('loaded state with empty list shows AppEmptyView',
      (tester) async {
    await _pump(
      tester,
      state: InventoryLoaded(
        rawMaterials: const [],
        finishedGoods: const [],
        lowStockMaterials: const [],
      ),
    );
    expect(find.byType(AppEmptyView), findsOneWidget);
    expect(find.text('لا توجد مواد خام'), findsOneWidget);
  });

  testWidgets('offline state shows the dedicated offline view, not the error view',
      (tester) async {
    await _pump(tester, state: InventoryOffline());
    expect(find.byType(AppOfflineView), findsOneWidget);
    expect(find.byType(AppErrorView), findsNothing);
    expect(find.text('لا يوجد اتصال بالإنترنت'), findsOneWidget);
  });

  testWidgets('offline view retry triggers a cubit refetch', (tester) async {
    final cubit = _TrackingInventoryCubit(InventoryOffline());
    await _pump(tester, state: null, cubit: cubit);

    expect(cubit.fetchCalls, 0);
    await tester.tap(find.text('إعادة المحاولة'));
    await tester.pump();
    expect(cubit.fetchCalls, 1);
  });

  testWidgets('error state shows AppErrorView with the server message',
      (tester) async {
    await _pump(tester, state: InventoryError('خطأ داخلي في الخادم'));
    expect(find.byType(AppErrorView), findsOneWidget);
    expect(find.byType(AppOfflineView), findsNothing);
    expect(find.text('خطأ داخلي في الخادم'), findsOneWidget);
  });

  testWidgets('scan button opens the scanner and fills search with the SKU',
      (tester) async {
    final launcher = _FakeScannerLauncher('SKU-987');
    await _pump(
      tester,
      state: InventoryLoaded(
        rawMaterials: materials,
        finishedGoods: const [],
        lowStockMaterials: const [],
      ),
      launcher: launcher,
    );

    expect(launcher.scanCalls, 0);
    expect(find.text('خيط أزرق'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.qr_code_scanner));
    await tester.pump();

    // الماسح فُتح مرة واحدة وعاد بـ SKU الذي ملأ خانة البحث.
    expect(launcher.scanCalls, 1);
    expect(find.text('SKU-987'), findsOneWidget);

    // التصفية بالـ SKU تُبقي المادة المطابقة فقط.
    expect(find.text('خيط أزرق'), findsOneWidget);
    expect(find.text('قماش قطني أبيض'), findsNothing);
  });

  testWidgets('cancelling the scanner leaves the search unchanged',
      (tester) async {
    final launcher = _FakeScannerLauncher(null);
    await _pump(
      tester,
      state: InventoryLoaded(
        rawMaterials: materials,
        finishedGoods: const [],
        lowStockMaterials: const [],
      ),
      launcher: launcher,
    );

    await tester.tap(find.byIcon(Icons.qr_code_scanner));
    await tester.pump();

    expect(find.text('قماش قطني أبيض'), findsOneWidget);
    expect(find.text('خيط أزرق'), findsOneWidget);
    expect(find.text('SKU-987'), findsNothing);
  });
}

Future<void> _pump(
  WidgetTester tester, {
  InventoryState? state,
  InventoryCubit? cubit,
  BarcodeScannerLauncher? launcher,
}) async {
  final effectiveCubit = cubit ?? _StaticInventoryCubit(state ?? InventoryLoading());
  await tester.pumpWidget(
    MaterialApp(
      home: InventoryScreen(cubit: effectiveCubit, scannerLauncher: launcher),
    ),
  );
  await tester.pump();
  await tester.pump();
}

/// cubit وهمي يصدر حالة واحدة ولا يستعلم الشبكة؛ يُستخدم لضبط كل حالة.
class _StaticInventoryCubit extends InventoryCubit {
  _StaticInventoryCubit(InventoryState state) : super() {
    emit(state);
  }

  @override
  Future<void> fetchInventoryData() async {}
}

class _TrackingInventoryCubit extends _StaticInventoryCubit {
  _TrackingInventoryCubit(super.state);

  int fetchCalls = 0;

  @override
  Future<void> fetchInventoryData() async => fetchCalls++;
}

/// بديل الماسح الحقيقي في الاختبارات: يرجع كودًا محددًا (أو null = إلغاء)
/// ويحصي عدد مرات الفتح — يثبت أن زر المسح يفتح الماسح فعلاً.
class _FakeScannerLauncher implements BarcodeScannerLauncher {
  _FakeScannerLauncher(this.result);

  final String? result;
  int scanCalls = 0;

  @override
  Future<String?> scan(BuildContext context) async {
    scanCalls++;
    return result;
  }
}
