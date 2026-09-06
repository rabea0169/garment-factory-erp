import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';
// استيراد تنفيذي مقصود: بناء بطاقة Android وهمية (TagPigeon) للاختبار —
// المُصدَّر العام لا يكشف مُنشئ بيانات البطاقة الخام.
// ignore: implementation_imports
import 'package:nfc_manager/src/nfc_manager_android/pigeon.g.dart'
    as android_pigeon;

import 'package:garment_factory_erp/core/services/nfc_service.dart';

/// MOB-4: اختبارات NfcService بقارئ مُحاكى (FakeNfcManager) — بلا عتاد NFC
/// حقيقي: نجاح القراءة، فشل المنصة (رسائل عربية بلا crash)، وتوقف الجلسة
/// عند أول بطاقة (قراءة واحدة لا تدور).
void main() {
  // بيئة افتراضية موحدة: منصة Android كي يُستخدم المدير المحقون دائمًا.
  setUpAll(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
  });
  tearDownAll(() {
    debugDefaultTargetPlatformOverride = null;
  });

  group('isAvailable', () {
    test('متاح ومفعّل → true', () async {
      final manager = _FakeNfcManager()..availability = NfcAvailability.enabled;
      final service = NfcService(manager: manager);
      expect(await service.isAvailable(), isTrue);
    });

    test('معطّل أو غير مدعوم أو رمي استثناء → false', () async {
      final disabled = _FakeNfcManager()
        ..availability = NfcAvailability.disabled;
      expect(await NfcService(manager: disabled).isAvailable(), isFalse);

      final unsupported = _FakeNfcManager()
        ..availability = NfcAvailability.unsupported;
      expect(await NfcService(manager: unsupported).isAvailable(), isFalse);

      final throwing = _FakeNfcManager()..throwOnAvailability = true;
      expect(await NfcService(manager: throwing).isAvailable(), isFalse);
    });

    test('منصة غير مدعومة (لا مدير) → false بلا استثناء', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      expect(await NfcService().isAvailable(), isFalse);
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
    });
  });

  group('startReading — قراءة أول بطاقة', () {
    test('بطاقة بمعرف صالح → onRead بالسداسي uppercase وstopSession', () async {
      final manager = _FakeNfcManager()..availability = NfcAvailability.enabled;
      final service = NfcService(manager: manager);

      String? readId;
      String? errorMessage;
      await service.startReading(
        (tagId) => readId = tagId,
        (message) => errorMessage = message,
      );

      // محاكاة اقتراب بطاقة بمعرّف [0x04, 0xA2, 0xB3].
      manager.discoverTag(
        android_pigeon.TagPigeon(
          handle: '1',
          id: Uint8List.fromList([0x04, 0xA2, 0xB3]),
          techList: <String>['android.nfc.tech.NfcA'],
        ),
      );
      // onDiscovered داخل الخدمة async — ننتظر اكتمال المِيكروتاسكات.
      await pumpEventQueue();

      expect(readId, '04A2B3');
      expect(errorMessage, isNull);
      // قراءة واحدة: الجلسة أُوقفت تلقائيًا بعد أول بطاقة.
      expect(manager.stopSessionCalls, 1);
      expect(service.isReading, isFalse);
    });

    test('بطاقة بلا معرف (id فارغ) → رسالة عربية ولا crash', () async {
      final manager = _FakeNfcManager()..availability = NfcAvailability.enabled;
      final service = NfcService(manager: manager);

      String? readId;
      String? errorMessage;
      await service.startReading(
        (tagId) => readId = tagId,
        (message) => errorMessage = message,
      );

      manager.discoverTag(
        android_pigeon.TagPigeon(
          handle: '2',
          id: Uint8List(0),
          techList: <String>[],
        ),
      );
      // onDiscovered داخل الخدمة async — ننتظر اكتمال المِيكروتاسكات.
      await pumpEventQueue();

      expect(readId, isNull);
      expect(errorMessage, 'تعذر قراءة معرف البطاقة — قرّبها مرة أخرى');
      // الجلسة أُوقفت أيضًا (قراءة واحدة حتى عند التعذر).
      expect(manager.stopSessionCalls, 1);
      expect(service.isReading, isFalse);
    });

    test('NFC معطّل → onError عربي واضح ولا جلسة', () async {
      final manager = _FakeNfcManager()
        ..availability = NfcAvailability.disabled;
      final service = NfcService(manager: manager);

      String? errorMessage;
      await service.startReading(
        (tagId) => fail('يجب ألا تُقرأ بطاقة'),
        (message) => errorMessage = message,
      );

      expect(errorMessage,
          'اتصال الحقل القريب (NFC) معطّل — فعّله من إعدادات الجهاز');
      expect(manager.startSessionCalls, 0);
      expect(service.isReading, isFalse);
    });

    test('NFC غير مدعوم على الجهاز → onError عربي', () async {
      final manager = _FakeNfcManager()
        ..availability = NfcAvailability.unsupported;
      final service = NfcService(manager: manager);

      String? errorMessage;
      await service.startReading(
        (tagId) => fail('يجب ألا تُقرأ بطاقة'),
        (message) => errorMessage = message,
      );

      expect(errorMessage, 'هذا الجهاز لا يدعم قراءة بطاقات NFC');
    });

    test('منصة غير مدعومة للتطبيق → onError عربي (لا UnsupportedError)',
        () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      final service = NfcService();

      String? errorMessage;
      await service.startReading(
        (tagId) => fail('يجب ألا تُقرأ بطاقة'),
        (message) => errorMessage = message,
      );

      expect(errorMessage, 'قراءة بطاقات NFC غير مدعومة على هذه المنصة');
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
    });

    test('فشل بدء الجلسة → onError عربي ولا crash', () async {
      final manager = _FakeNfcManager()
        ..availability = NfcAvailability.enabled
        ..throwOnStartSession = true;
      final service = NfcService(manager: manager);

      String? errorMessage;
      await service.startReading(
        (tagId) => fail('يجب ألا تُقرأ بطاقة'),
        (message) => errorMessage = message,
      );

      expect(errorMessage, 'تعذر بدء جلسة قراءة NFC');
      expect(service.isReading, isFalse);
    });

    test('جلسة جارية → استدعاء ثانٍ يُتجاهل (جلسة واحدة)', () async {
      final manager = _FakeNfcManager()..availability = NfcAvailability.enabled;
      final service = NfcService(manager: manager);

      await service.startReading((_) {}, (_) {});
      await service.startReading(
          (_) => fail('لا قراءة من الجلسة الثانية'), (_) {});

      expect(manager.startSessionCalls, 1);

      await service.stopReading();
    });

    test('stopReading آمن دائمًا (بلا جلسة/بلا مدير/فشل إيقاف)', () async {
      final manager = _FakeNfcManager()
        ..availability = NfcAvailability.enabled
        ..throwOnStopSession = true;
      final service = NfcService(manager: manager);

      // بلا جلسة: no-op.
      await service.stopReading();

      // بجلسة وفشل الإيقاف: يُبتلع ولا يرمي.
      await service.startReading((_) {}, (_) {});
      await service.stopReading();
      expect(service.isReading, isFalse);
    });
  });

  group('extractTagId', () {
    test('بطاقة Android بمعرف → سداسي uppercase', () {
      final tag = NfcTag(
        data: android_pigeon.TagPigeon(
          handle: '3',
          id: Uint8List.fromList([0x00, 0x01, 0x0A, 0xFF]),
          techList: <String>[],
        ),
      );
      expect(NfcService.extractTagId(tag), '00010AFF');
    });

    test('بيانات غير متوافقة (ليست بطاقة منصة) → null بلا استثناء', () {
      expect(NfcService.extractTagId(NfcTag(data: 'not-a-tag')), isNull);
      expect(
        NfcService.extractTagId(
          NfcTag(
              data: android_pigeon.TagPigeon(
                  handle: '4', id: Uint8List(0), techList: <String>[])),
        ),
        isNull,
      );
    });
  });
}

/// قارئ NFC مُحاكى — ينفّذ واجهة NfcManager ويحاكي اكتشاف البطاقات يدويًا.
class _FakeNfcManager implements NfcManager {
  NfcAvailability availability = NfcAvailability.enabled;
  bool throwOnAvailability = false;
  bool throwOnStartSession = false;
  bool throwOnStopSession = false;

  int startSessionCalls = 0;
  int stopSessionCalls = 0;

  void Function(NfcTag tag)? _onDiscovered;

  @override
  Future<NfcAvailability> checkAvailability() async {
    if (throwOnAvailability) throw UnsupportedError('platform error');
    return availability;
  }

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
    if (throwOnStartSession) throw StateError('session start failed');
    startSessionCalls++;
    _onDiscovered = onDiscovered;
  }

  /// يحاكي اقتراب بطاقة من القارئ (يستدعيها الاختبار).
  void discoverTag(Object platformTagData) {
    _onDiscovered?.call(NfcTag(data: platformTagData));
  }

  @override
  Future<void> stopSession({
    String? alertMessageIos,
    String? errorMessageIos,
  }) async {
    if (throwOnStopSession) throw StateError('session stop failed');
    stopSessionCalls++;
    _onDiscovered = null;
  }
}
