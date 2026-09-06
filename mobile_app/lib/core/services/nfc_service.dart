import 'package:flutter/foundation.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';

/// MOB-4: خدمة NFC فوق حزمة nfc_manager (المصرّح بها في pubspec).
///
/// السلوك: جلسة قراءة واحدة تتوقف عند أول بطاقة تُقرأ (يُقرأ معرفها
/// كنص سداسي عشري uppercase) — لا جلسات متكررة ولا عمليات كتابة.
/// تحيّز الأمان: كل مسار فشل (منصة غير مدعومة، NFC معطّل/غير موجود،
/// فشل بدء الجلسة، بطاقة بلا معرف) يُمرَّر إلى onError برسالة عربية
/// واضحة — لا استثناءات غير معالجة ولا crash.
class NfcService {
  NfcService({NfcManager? manager}) : _injectedManager = manager;

  /// الخدمة المشتركة للتطبيق.
  static final NfcService instance = NfcService();

  final NfcManager? _injectedManager;
  bool _reading = false;

  /// هل جلسة قراءة جارية الآن؟
  bool get isReading => _reading;

  /// يحل المدير الآمن للمنصة الحالية — null على منصة غير مدعومة.
  NfcManager? _resolveManager() {
    final injected = _injectedManager;
    if (injected != null) return injected;
    if (kIsWeb) return null;
    if (defaultTargetPlatform != TargetPlatform.android &&
        defaultTargetPlatform != TargetPlatform.iOS) {
      return null;
    }
    try {
      return NfcManager.instance;
    } catch (_) {
      // NfcManager.instance يرمي UnsupportedError على منصات أخرى.
      return null;
    }
  }

  /// هل NFC متاح ومفعّل على هذا الجهاز؟ (false عند أي فشل منصة).
  Future<bool> isAvailable() async {
    final manager = _resolveManager();
    if (manager == null) return false;
    try {
      return await manager.checkAvailability() == NfcAvailability.enabled;
    } catch (_) {
      return false;
    }
  }

  /// يبدأ جلسة قراءة NFC. عند اقتراب أول بطاقة:
  /// - نجاح: onRead بمعرف البطاقة (سداسي عشري uppercase) ثم تُوقف
  ///   الجلسة تلقائيًا (قراءة واحدة لا تدور).
  /// - فشل: onError برسالة عربية محددة.
  Future<void> startReading(
    void Function(String tagId) onRead,
    void Function(String message) onError,
  ) async {
    final manager = _resolveManager();
    if (manager == null) {
      onError('قراءة بطاقات NFC غير مدعومة على هذه المنصة');
      return;
    }
    if (_reading) return;
    try {
      final availability = await manager.checkAvailability();
      if (availability != NfcAvailability.enabled) {
        onError(
          availability == NfcAvailability.disabled
              ? 'اتصال الحقل القريب (NFC) معطّل — فعّله من إعدادات الجهاز'
              : 'هذا الجهاز لا يدعم قراءة بطاقات NFC',
        );
        return;
      }
      _reading = true;
      await manager.startSession(
        pollingOptions: const <NfcPollingOption>{
          NfcPollingOption.iso14443,
          NfcPollingOption.iso15693,
          NfcPollingOption.iso18092,
        },
        // iOS: ينهي الجلسة بعد أول قراءة تلقائيًا.
        invalidateAfterFirstReadIos: true,
        onDiscovered: (tag) async {
          final tagId = extractTagId(tag);
          await stopReading();
          if (tagId == null) {
            onError('تعذر قراءة معرف البطاقة — قرّبها مرة أخرى');
            return;
          }
          onRead(tagId);
        },
      );
    } catch (_) {
      _reading = false;
      onError('تعذر بدء جلسة قراءة NFC');
    }
  }

  /// يوقف جلسة القراءة إن كانت جارية (آمن الاستدعاء دائمًا).
  Future<void> stopReading() async {
    if (!_reading) return;
    _reading = false;
    final manager = _resolveManager();
    if (manager == null) return;
    try {
      await manager.stopSession();
    } catch (_) {
      // إيقاف فاشل لا يهم المستخدم — الجلسة ستنتهي وحدها.
    }
  }

  /// يستخرج معرف البطاقة (UID) عبر تقنيات Android ثم iOS.
  /// يعيد نصًا سداسيًا عشريًا uppercase أو null عند تعذر الاستخراج.
  @visibleForTesting
  static String? extractTagId(NfcTag tag) {
    // Android: NfcTagAndroid.id (تقنية Tag الأساسية).
    try {
      final android = NfcTagAndroid.from(tag);
      if (android != null && android.id.isNotEmpty) {
        return _bytesToHex(android.id);
      }
    } catch (_) {
      // data ليس TagPigeon — نجرّب iOS.
    }
    // iOS: معرّفات التقنيات الشائعة (ISO7816/ISO15693/MiFare).
    try {
      final iso7816 = Iso7816Ios.from(tag);
      if (iso7816 != null && iso7816.identifier.isNotEmpty) {
        return _bytesToHex(iso7816.identifier);
      }
    } catch (_) {
      // بيانات iOS غير متوافقة.
    }
    try {
      final iso15693 = Iso15693Ios.from(tag);
      if (iso15693 != null && iso15693.identifier.isNotEmpty) {
        return _bytesToHex(iso15693.identifier);
      }
    } catch (_) {
      // بيانات iOS غير متوافقة.
    }
    try {
      final miFare = MiFareIos.from(tag);
      if (miFare != null && miFare.identifier.isNotEmpty) {
        return _bytesToHex(miFare.identifier);
      }
    } catch (_) {
      // بيانات iOS غير متوافقة.
    }
    return null;
  }

  static String _bytesToHex(Uint8List bytes) {
    final buffer = StringBuffer();
    for (final byte in bytes) {
      buffer.write(byte.toRadixString(16).padLeft(2, '0').toUpperCase());
    }
    return buffer.toString();
  }
}
