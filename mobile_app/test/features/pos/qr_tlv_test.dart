import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/services/qr_tlv.dart';

/// SELIM-ERP W2 — اختبارات ترميز QR TLV (نفس عقود qr-tlv.util.ts الخادمية).
void main() {
  group('QrTlv — ترميز ETA المحلي', () {
    test('buildTlvBase64: خمسة وسوم بالترتيب مع فك صحيح', () {
      final payload = QrTlv.buildTlvBase64(
        sellerName: 'شركة النسيج',
        vatNumber: '123456789',
        timestamp: '2026-09-13T10:00:00.000Z',
        total: '570.00',
        vatAmount: '70.00',
      );
      final decoded = QrTlv.decodeTlv(payload);
      expect(decoded[1], 'شركة النسيج');
      expect(decoded[2], '123456789');
      expect(decoded[3], '2026-09-13T10:00:00.000Z');
      expect(decoded[4], '570.00');
      expect(decoded[5], '70.00');
      expect(decoded.keys.toSet(), {1, 2, 3, 4, 5});
    });

    test('الأسماء العربية تُرمَّز UTF-8 كاملة (متعددة البايتات)', () {
      final payload = QrTlv.buildTlvBase64(
        sellerName: 'مصنع القاهرة للملابس',
        vatNumber: '555-666-777',
        timestamp: '2026-01-01T00:00:00Z',
        total: '1.00',
        vatAmount: '0.14',
      );
      expect(QrTlv.decodeTlv(payload)[1], 'مصنع القاهرة للملابس');
    });

    test('buildPayload بلا رقم تسجيل → نص عربي موجز', () {
      final payload = QrTlv.buildPayload(
        sellerName: 'أي اسم',
        vatNumber: '',
        code: 'SO-2026-1',
        total: 570,
        vatAmount: 70,
        createdAt: DateTime(2026, 9, 13),
      );
      expect(payload, contains('SO-2026-1'));
      expect(payload, contains('570'));
    });

    test('buildPayload برقم تسجيل → TLV base64', () {
      final payload = QrTlv.buildPayload(
        sellerName: 'شركة النسيج',
        vatNumber: '123456789',
        code: 'SO-2026-1',
        total: 570,
        vatAmount: 70,
        createdAt: DateTime.utc(2026, 9, 13, 10),
      );
      final decoded = QrTlv.decodeTlv(payload);
      expect(decoded[2], '123456789');
      expect(decoded[4], '570.00');
    });
  });
}
