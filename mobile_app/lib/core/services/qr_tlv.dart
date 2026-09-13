import 'dart:convert';
import 'dart:typed_data';

/// SELIM-ERP W2 — ترميز QR إيصار نقطة البيع بصيغة TLV (ETA) في Dart.
///
/// **ترميز محلي فقط** — الطباعة الحرارية تطبع QR بترميز TLV محلي بلا أي
/// تكامل خارجي (استُثني تكامل الفاتورة الإلكترونية بناء على طلب المالك).
///
/// الوسوم (مواصفة ETA):
///   1 = اسم البائع · 2 = رقم التسجيل الضريبي · 3 = طابع زمني ISO
///   4 = إجمالي الفاتورة · 5 = إجمالي الضريبة
///
/// عند غياب رقم التسجيل (متغيرات البيئة غير مهيأة — بيئة UAT) نُرجع
/// نصًا عاديًا موجزًا — نفس سلوك سقوط الخادم في `qr-tlv.util.ts`.
class QrTlv {
  const QrTlv._();

  /// يبني حِمل QR: TLV base64 عند اكتمال بيانات التسجيل، وإلا نص عادي.
  ///
  /// [sellerName]/[vatNumber] قيمتان خادميتان تُمرَّران من إعدادات النشر؛
  /// [vatNumber] الفارغ يعني التراجع للنص العادي.
  static String buildPayload({
    required String sellerName,
    required String vatNumber,
    required String code,
    required double total,
    required double vatAmount,
    required DateTime createdAt,
  }) {
    final vat = vatNumber.trim();
    if (vat.isEmpty) {
      return 'فاتورة $code | إجمالي ${total.toStringAsFixed(2)} ج.م | '
          '${createdAt.toIso8601String().substring(0, 10)}';
    }
    return buildTlvBase64(
      sellerName: sellerName,
      vatNumber: vat,
      timestamp: createdAt.toUtc().toIso8601String(),
      total: total.toStringAsFixed(2),
      vatAmount: vatAmount.toStringAsFixed(2),
    );
  }

  /// ترميز TLV صريح — الحقول الخمسة كاملة (وسوم 1-5).
  static String buildTlvBase64({
    required String sellerName,
    required String vatNumber,
    required String timestamp,
    required String total,
    required String vatAmount,
  }) {
    final bytes = BytesBuilder();
    void tag(int id, String value) {
      final valueBytes = utf8.encode(value);
      bytes.add(Uint8List.fromList([id, valueBytes.length]));
      bytes.add(valueBytes);
    }

    tag(1, sellerName);
    tag(2, vatNumber);
    tag(3, timestamp);
    tag(4, total);
    tag(5, vatAmount);
    return base64Encode(bytes.toBytes());
  }

  /// فك ترميز TLV للاختبارات — يعيد خريطة {الوسم: القيمة}.
  static Map<int, String> decodeTlv(String base64Payload) {
    final bytes = base64Decode(base64Payload);
    final result = <int, String>{};
    var i = 0;
    while (i + 1 < bytes.length) {
      final tag = bytes[i];
      final length = bytes[i + 1];
      if (i + 2 + length > bytes.length) break;
      result[tag] = utf8.decode(bytes.sublist(i + 2, i + 2 + length));
      i += 2 + length;
    }
    return result;
  }
}
