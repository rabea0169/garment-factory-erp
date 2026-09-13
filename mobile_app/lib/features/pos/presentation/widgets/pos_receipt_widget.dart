import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../cubit/pos_cubit.dart';

/// SELIM-ERP W2 — إيصار نقطة البيع الحراري (Widget يُطبع عبر printWidget).
///
/// يُبنى كـ Widget عربي RTL كامل — مكتبة الطباعة تصيّره صورة نقطية
/// ESC/POS فتظهر العربية بسلام على أي طابعة (بلا codepage) — نفس
/// نهج إيصارات Selim. العرض 58mm تقريبًا (350px منطقي) ويكفي 80mm.
class PosReceiptWidget extends StatelessWidget {
  const PosReceiptWidget({
    super.key,
    required this.receipt,
    this.storeName = 'مصنع الملابس الجاهزة',
    this.storePhone = '',
    this.cashierName,
  });

  final PosReceipt receipt;
  final String storeName;
  final String storePhone;
  final String? cashierName;

  @override
  Widget build(BuildContext context) {
    final now = receipt.createdAt ?? DateTime.now();
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Container(
        color: Colors.white,
        width: 360,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Text(
                storeName,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: Colors.black,
                ),
              ),
            ),
            if (storePhone.isNotEmpty)
              Center(
                child: Text(
                  storePhone,
                  style: const TextStyle(fontSize: 11, color: Colors.black),
                ),
              ),
            if (cashierName != null && cashierName!.isNotEmpty)
              Center(
                child: Text(
                  'كاشير: $cashierName',
                  style: const TextStyle(fontSize: 11, color: Colors.black),
                ),
              ),
            const _DashedDivider(),
            _row('رقم الفاتورة', receipt.code),
            _row('التاريخ', _formatDate(now)),
            if (receipt.pendingOffline)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 2),
                child: Text(
                  '* فاتورة معلقة — ستُرسل تلقائيًا عند عودة الاتصال',
                  style: TextStyle(fontSize: 10, color: Colors.black),
                ),
              ),
            const _DashedDivider(),
            for (final item in receipt.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${item['name'] ?? ''}'
                      '${_variantLabel(item)}',
                      style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: Colors.black),
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          '${item['quantity']} × ${_money(item['unitPrice'])}',
                          style: const TextStyle(
                              fontSize: 11, color: Colors.black),
                        ),
                        Text(
                          _money(item['total']),
                          style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: Colors.black),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            const _DashedDivider(),
            _row('الإجمالي', _money(receipt.subtotal)),
            if (receipt.discount > 0)
              _row('الخصم', '- ${_money(receipt.discount)}'),
            _row('ضريبة القيمة المضافة (14%)', _money(receipt.vatAmount)),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(border: Border.all(width: 1.5)),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'الإجمالي المستحق',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: Colors.black),
                    ),
                    Text(
                      _money(receipt.total),
                      style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: Colors.black),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            if (receipt.qrPayload.isNotEmpty)
              Center(
                child: QrImageView(
                  data: receipt.qrPayload,
                  size: 110,
                  backgroundColor: Colors.white,
                ),
              ),
            const SizedBox(height: 8),
            const Center(
              child: Text(
                'شكرًا لزيارتكم — البضاعة المبيعة لا ترد ولا تستبدل',
                style: TextStyle(fontSize: 10, color: Colors.black),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  String _variantLabel(Map<String, dynamic> item) {
    final size = item['size']?.toString() ?? '';
    final color = item['color']?.toString() ?? '';
    final parts = [
      if (size.isNotEmpty) size,
      if (color.isNotEmpty) color,
    ];
    return parts.isEmpty ? '' : ' (${parts.join(' / ')})';
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: Colors.black)),
          Text(
            value,
            style: const TextStyle(
                fontSize: 11, fontWeight: FontWeight.w700, color: Colors.black),
          ),
        ],
      ),
    );
  }

  String _money(Object? value) {
    final num v = value is num ? value : (num.tryParse('$value') ?? 0);
    return '${v.toStringAsFixed(2)} ج.م';
  }

  String _formatDate(DateTime date) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(date.day)}/${two(date.month)}/${date.year} '
        '${two(date.hour)}:${two(date.minute)}';
  }
}

/// فاصل منقط — يظهر كخط مقطع على الورق الحراري.
class _DashedDivider extends StatelessWidget {
  const _DashedDivider();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: CustomPaint(
        size: const Size(double.infinity, 1),
        painter: _DashPainter(),
      ),
    );
  }
}

class _DashPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.black
      ..strokeWidth = 1;
    const dash = 4.0;
    const gap = 3.0;
    var x = 0.0;
    while (x < size.width) {
      canvas.drawLine(Offset(x, 0), Offset(x + dash, 0), paint);
      x += dash + gap;
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
