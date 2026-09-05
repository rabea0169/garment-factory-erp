import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

/// GF-REMAINING-008: مراقبة حالة الشبكة على مستوى التطبيق.
///
/// مصدر حقيقة واحد لحالة الاتصال: يستمع إلى `connectivity_plus` ويحوّل
/// النتائج إلى بثّ boolean (true = متصل). أي فشل في قراءة المنصة
/// (اختبارات، منصات غير مدعومة) يُهمل بهدوء مع افتراض "متصل" —
/// التصنيف النهائي يبقى مسؤولية طبقة الشبكة (`ApiClient.isNetworkError`)
/// حتى لا يعرض التطبيق حالة offline خاطئة لمجرد تعذّر قراءة المنصة.
class ConnectivityService {
  ConnectivityService({Connectivity? connectivity})
      : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;
  final StreamController<bool> _onlineController =
      StreamController<bool>.broadcast();

  /// آخر حالة معروفة (يقرأها OfflineBanner عند البناء). تبدأ "متصل"
  /// (الوضع الأمثل) حتى تثبت القراءة غير ذلك.
  bool isOnline = true;

  /// بثّ حالة الاتصال (broadcast — يسمح بعدة مستمعين دون فقدان الأحداث).
  Stream<bool> get onlineStream => _onlineController.stream;

  StreamSubscription<List<ConnectivityResult>>? _subscription;
  bool _started = false;

  /// يبدأ المراقبة (idempotent). يُستدعى مرة واحدة عند إقلاع التطبيق.
  void start() {
    if (_started) return;
    _started = true;
    _subscription = _connectivity.onConnectivityChanged.listen(
      _onResults,
      onError: (_) {
        // فشل المنصة لا يغيّر الحالة — نفترض الاتصال قائم.
      },
    );
    // فحص أولي فوري بعد الاشتراك حتى تعكس الحالة الواقع الحالي
    // وليس آخر تغيير سابق فقط.
    unawaited(_checkNow());
  }

  Future<void> _checkNow() async {
    try {
      _onResults(await _connectivity.checkConnectivity());
    } catch (_) {
      // المنصة غير متاحة (اختبار/سطح مكتب): نبقى على الافتراض "متصل".
    }
  }

  void _onResults(List<ConnectivityResult> results) {
    final online =
        results.isNotEmpty && !results.contains(ConnectivityResult.none);
    if (online != isOnline) {
      isOnline = online;
      _onlineController.add(online);
    }
  }

  Future<void> dispose() async {
    await _subscription?.cancel();
    await _onlineController.close();
  }
}
