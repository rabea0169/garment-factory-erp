import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/widgets/app_feedback.dart';
import 'package:garment_factory_erp/features/hr/worker_activity/presentation/cubit/worker_activity_cubit.dart';
import 'package:garment_factory_erp/features/hr/worker_activity/presentation/cubit/worker_activity_state.dart';
import 'package:garment_factory_erp/features/hr/worker_activity/presentation/screens/worker_activity_screen.dart';

/// MOB-8: شاشة نشاط العامل — تبويبا آخر السلف وآخر الإنتاج بحالاتهما،
/// بـ cubit وهمي يصدر حالة واحدة (نمط المستودع — بلا شبكة).
void main() {
  final advances = <Map<String, dynamic>>[
    {
      'id': 'adv-1',
      'workerId': 'w-1',
      'amount': 500,
      'settledAmount': 200,
      'date': '2026-08-10T00:00:00.000Z',
      'notes': 'سلفة شهر أغسطس',
      'worker': {'id': 'w-1', 'name': 'أحمد', 'code': 'W-001'},
    },
  ];

  final production = <Map<String, dynamic>>[
    {
      'id': 'prod-1',
      'workerId': 'w-1',
      'workOrderId': 'wo-1',
      'date': '2026-08-25T00:00:00.000Z',
      'piecesCount': 40,
      'pieceRate': 2.5,
      'totalAmount': 100,
      'notes': null,
      'worker': {'id': 'w-1', 'name': 'أحمد', 'code': 'W-001'},
    },
  ];

  testWidgets('تحميل → AppLoadingView برسالة نشاط العامل', (tester) async {
    await _pump(tester, const WorkerActivityLoading());
    expect(find.byType(AppLoadingView), findsOneWidget);
    expect(find.text('جاري تحميل نشاط العامل...'), findsOneWidget);
  });

  testWidgets('محملة → تبويبان: سلفة العامل وإنتاجه (أبسط تمثيل)',
      (tester) async {
    await _pump(
      tester,
      WorkerActivityLoaded(advances: advances, production: production),
    );

    // التبويبان.
    expect(find.text('آخر السلف'), findsOneWidget);
    expect(find.text('آخر الإنتاج'), findsOneWidget);

    // تبويب السلف افتراضيًا: المبلغ والملاحظة (الملاحظة داخل نص متعدد
    // الأسطر مع التاريخ — نطابقها بـ textContaining).
    expect(find.textContaining('500.00'), findsOneWidget);
    expect(find.textContaining('سلفة شهر أغسطس'), findsOneWidget);

    // الانتقال لتبويب الإنتاج: القطع والتاريخ.
    await tester.tap(find.text('آخر الإنتاج'));
    await tester.pumpAndSettle();
    expect(find.text('40 قطعة'), findsOneWidget);
    expect(find.textContaining('2026-08-25'), findsOneWidget);
  });

  testWidgets('تبويب السلف فارغ → حالة فراغ خاصة به (والإنتاج معروض)',
      (tester) async {
    await _pump(
      tester,
      WorkerActivityLoaded(advances: const [], production: production),
    );
    expect(find.text('لا توجد سلف لهذا العامل'), findsOneWidget);

    // التبويب الآخر لا يزال سليمًا.
    await tester.tap(find.text('آخر الإنتاج'));
    await tester.pumpAndSettle();
    expect(find.text('لا يوجد إنتاج مسجل لهذا العامل'), findsNothing);
    expect(find.text('40 قطعة'), findsOneWidget);
  });

  testWidgets('تبويب الإنتاج فارغ → حالة فراغ خاصة به', (tester) async {
    await _pump(
      tester,
      WorkerActivityLoaded(advances: advances, production: const []),
    );
    // الانتقال لتبويب الإنتاج الفارغ.
    await tester.tap(find.text('آخر الإنتاج'));
    await tester.pumpAndSettle();
    expect(find.text('لا يوجد إنتاج مسجل لهذا العامل'), findsOneWidget);
  });

  testWidgets('خطأ → AppErrorView برسالة الخادم وإعادة المحاولة',
      (tester) async {
    final cubit = _TrackingWorkerActivityCubit(
      const WorkerActivityError('تعذر الاتصال بالخادم'),
    );
    await _pump(tester, null, cubit: cubit);

    expect(find.byType(AppErrorView), findsOneWidget);
    expect(find.text('تعذر الاتصال بالخادم'), findsOneWidget);

    expect(cubit.fetchCalls, 0);
    await tester.tap(find.text('إعادة المحاولة'));
    await tester.pump();
    expect(cubit.fetchCalls, 1);
  });

  testWidgets('الترويسة تحمل اسم العامل عند تمريره', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: WorkerActivityScreen(
          workerId: 'w-1',
          workerName: 'أحمد',
          cubit: _StaticWorkerActivityCubit(const WorkerActivityLoading()),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('نشاط العامل: أحمد'), findsOneWidget);
  });
}

Future<void> _pump(
  WidgetTester tester,
  WorkerActivityState? state, {
  WorkerActivityCubit? cubit,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: WorkerActivityScreen(
        workerId: 'w-1',
        workerName: 'أحمد',
        cubit: cubit ?? _StaticWorkerActivityCubit(state!),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

/// cubit وهمي يصدر حالة واحدة ولا يستعلم الشبكة (نمط المستودع).
class _StaticWorkerActivityCubit extends WorkerActivityCubit {
  _StaticWorkerActivityCubit(WorkerActivityState state)
      : super(workerId: 'w-1', workerName: 'أحمد') {
    emit(state);
  }

  @override
  Future<void> fetchActivity() async {}
}

class _TrackingWorkerActivityCubit extends _StaticWorkerActivityCubit {
  _TrackingWorkerActivityCubit(super.state);

  int fetchCalls = 0;

  @override
  Future<void> fetchActivity() async => fetchCalls++;
}
