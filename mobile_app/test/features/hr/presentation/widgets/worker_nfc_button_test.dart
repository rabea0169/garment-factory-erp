import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';

// استيراد تنفيذي مقصود: بناء بطاقة Android وهمية (TagPigeon) للاختبار —
// المُصدَّر العام لا يكشف مُنشئ بيانات البطاقة الخام.
// ignore: implementation_imports
import 'package:nfc_manager/src/nfc_manager_android/pigeon.g.dart'
    as android_pigeon;

import 'package:garment_factory_erp/core/services/nfc_service.dart';
import 'package:garment_factory_erp/features/hr/presentation/cubit/hr_cubit.dart';
import 'package:garment_factory_erp/features/hr/presentation/cubit/hr_state.dart';
import 'package:garment_factory_erp/features/hr/presentation/widgets/worker_nfc_button.dart';

/// MOB-4: زر NFC بشاشة العمال — قراءة معرف البطاقة تُعبّئ البحث:
/// عامل مرتبط بالبطاقة → اسمه؛ بطاقة غير مرتبطة → المعرف نفسه؛
/// فشل المنصة → رسالة عربية واضحة (لا crash). القارئ مُحاكى بالكامل
/// (FakeNfcManager) والـ cubit وهمي يصدر الحالة دون أي شبكة.
void main() {
  // بيئة افتراضية موحدة: منصة Android كي يُستخدم المدير المحقون دائمًا.
  // يُصفَّر داخل جسم كل اختبار قبل نهايته (إطار testWidgets يتحقق من
  // متغيرات الأساس قبل تشغيل tearDown).
  void useAndroidPlatform() {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
  }

  void resetPlatform() {
    debugDefaultTargetPlatformOverride = null;
  }

  const workers = [
    {
      'id': 'w-1',
      'name': 'أحمد',
      'code': 'W-001',
      'specialty': 'SEWING',
      'nfcId': '04A2B3',
    },
    {'id': 'w-2', 'name': 'سعيد', 'code': 'W-002', 'specialty': 'CUTTING'},
  ];

  Future<void> pumpButton(
    WidgetTester tester, {
    required HrCubit cubit,
    required TextEditingController controller,
    required NfcService service,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: WorkerNfcButton(
            cubit: cubit,
            searchController: controller,
            service: service,
          ),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('بطاقة مرتبطة بعامل → تعبئة البحث باسمه وإعلان التعرف',
      (tester) async {
    useAndroidPlatform();
    final cubit = _StaticHrCubit(HrLoaded(workers));
    addTearDown(cubit.close);
    final manager = _FakeNfcManager()..availability = NfcAvailability.enabled;
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await pumpButton(
      tester,
      cubit: cubit,
      controller: controller,
      service: NfcService(manager: manager),
    );

    await tester.tap(find.byType(IconButton));
    await tester.pump();

    // اقتراب بطاقة العامل أحمد (nfcId = 04A2B3).
    manager.discoverTag(_tag('04A2B3'));
    await tester.pump();
    await tester.pump();

    expect(controller.text, 'أحمد');
    expect(find.textContaining('تم التعرف على العامل'), findsOneWidget);
    // ننتظر انتهاء مؤقت شريط الرسالة كي لا يبقى Timer معلقًا.
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
    resetPlatform();
  });

  testWidgets('بطاقة غير مرتبطة → تعبئة البحث بمعرفها', (tester) async {
    useAndroidPlatform();
    final cubit = _StaticHrCubit(HrLoaded(workers));
    addTearDown(cubit.close);
    final manager = _FakeNfcManager()..availability = NfcAvailability.enabled;
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await pumpButton(
      tester,
      cubit: cubit,
      controller: controller,
      service: NfcService(manager: manager),
    );

    await tester.tap(find.byType(IconButton));
    await tester.pump();

    manager.discoverTag(_tag('DEADBEEF'));
    await tester.pump();
    await tester.pump();

    expect(controller.text, 'DEADBEEF');
    expect(find.textContaining('لا يوجد عامل مرتبط'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
    resetPlatform();
  });

  testWidgets('فشل المنصة (NFC معطّل) → رسالة عربية بلا crash', (tester) async {
    useAndroidPlatform();
    final cubit = _StaticHrCubit(HrLoaded(workers));
    addTearDown(cubit.close);
    final manager = _FakeNfcManager()..availability = NfcAvailability.disabled;
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await pumpButton(
      tester,
      cubit: cubit,
      controller: controller,
      service: NfcService(manager: manager),
    );

    await tester.tap(find.byType(IconButton));
    await tester.pump();
    await tester.pump();

    expect(controller.text, isEmpty);
    expect(
      find.textContaining('اتصال الحقل القريب (NFC) معطّل'),
      findsOneWidget,
    );
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
    resetPlatform();
  });
}

/// بطاقة Android وهمية بمعرّف سداسي.
android_pigeon.TagPigeon _tag(String hexId) {
  final id = <int>[];
  for (var i = 0; i < hexId.length; i += 2) {
    id.add(int.parse(hexId.substring(i, i + 2), radix: 16));
  }
  return android_pigeon.TagPigeon(
    handle: 'h-$hexId',
    id: Uint8List.fromList(id),
    techList: <String>['android.nfc.tech.NfcA'],
  );
}

/// cubit وهمي يصدر حالة واحدة ولا يستعلم الشبكة (نمط المستودع).
class _StaticHrCubit extends HrCubit {
  _StaticHrCubit(HrState state) : super() {
    emit(state);
  }
}

/// قارئ NFC مُحاكى (نفس نمط nfc_service_test).
class _FakeNfcManager implements NfcManager {
  NfcAvailability availability = NfcAvailability.enabled;

  void Function(NfcTag tag)? _onDiscovered;

  @override
  Future<NfcAvailability> checkAvailability() async => availability;

  // عضو مهمل في واجهة الحزمة — مطلوب للتنفيذ فقط.
  // ignore: deprecated_member_use_from_provided_package
  @override
  Future<bool> isAvailable() async => availability == NfcAvailability.enabled;

  @override
  Future<void> startSession({
    required Set<NfcPollingOption> pollingOptions,
    required void Function(NfcTag tag) onDiscovered,
    String? alertMessageIos,
    bool invalidateAfterFirstReadIos = true,
    void Function(NfcReaderSessionErrorIos)? onSessionErrorIos,
    bool noPlatformSoundsAndroid = false,
  }) async {
    _onDiscovered = onDiscovered;
  }

  void discoverTag(Object platformTagData) {
    _onDiscovered?.call(NfcTag(data: platformTagData));
  }

  @override
  Future<void> stopSession({
    String? alertMessageIos,
    String? errorMessageIos,
  }) async {
    _onDiscovered = null;
  }
}
