import 'package:flutter/material.dart';

import '../widgets/barcode_scanner_screen.dart';

/// GF-REMAINING-008: يفتح شاشة الماسح الحقيقي ويرجع الكود الممسوح.
///
/// غلاف قابل للحقن فوق `BarcodeScannerScreen` (mobile_scanner) حتى تختبر
/// الشاشات سلك زر المسح دون تشغيل الكاميرا: الاختبار يحقن نسخة وهمية
/// ترجع SKU محددًا، بينما الإنتاج يستخدم النسخة الحقيقية.
class BarcodeScannerLauncher {
  const BarcodeScannerLauncher();

  /// يفتح الماسح وينتظر نتيجة المسح. يرجع الكود (SKU) أو `null` عند الإلغاء.
  Future<String?> scan(BuildContext context) async {
    return Navigator.of(context).push<String>(
      MaterialPageRoute<String>(builder: (_) => const BarcodeScannerScreen()),
    );
  }
}
