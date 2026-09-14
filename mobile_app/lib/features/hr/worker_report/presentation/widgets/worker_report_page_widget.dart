import 'package:flutter/material.dart';

import '../../../../../core/widgets/selim/format.dart';

/// SELIM-ERP W5 — صفحة تقرير العامل (Widget يُصيَّر صورة ثم يوضع في PDF):
/// نفس نهج كشف الحساب W3 — عرض A4 بنسبة ثابتة، العربية من محرك Flutter
/// (المرجع يطبع عبر نوافذ المتصفح؛ التكييف الجوالي المعتمد لدينا).
class WorkerReportPageWidget extends StatelessWidget {
  const WorkerReportPageWidget({
    required this.workerName,
    required this.workerCode,
    required this.factoryName,
    required this.periodLabel,
    required this.summary,
    required this.rows,
    required this.pageNumber,
    required this.totalPages,
    super.key,
  });

  /// عرض A4 بالبكسل المنطقي (96dpi) — نفس ثابت كشف الحساب.
  static const double a4Width = 794;
  static const double a4Height = 1123;

  /// ملخص التقرير (خريطة summary من الخادم) — يظهر في الصفحة الأولى فقط.
  final Map<String, dynamic> summary;

  /// صفوف الحركات المجمعة: {date, label, pieces, amount, note}.
  final List<Map<String, dynamic>> rows;

  final String workerName;
  final String workerCode;
  final String factoryName;
  final String periodLabel;
  final int pageNumber;
  final int totalPages;

  /// عدد الصفوف المتزامن في صفحة A4 (بعد الملخص في الأولى).
  static const int rowsPerFirstPage = 18;
  static const int rowsPerPage = 26;

  /// تجزئة صفوف التقرير إلى صفحات (أول صفحة أقصر — الملخص فوقها).
  static List<List<Map<String, dynamic>>> chunkRows(
    List<Map<String, dynamic>> movements,
  ) {
    if (movements.isEmpty) return [[]];
    final pages = <List<Map<String, dynamic>>>[];
    var remaining = List<Map<String, dynamic>>.of(movements);
    var first = true;
    while (remaining.isNotEmpty) {
      final capacity = first ? rowsPerFirstPage : rowsPerPage;
      pages.add(remaining.take(capacity).toList());
      remaining = remaining.skip(capacity).toList();
      first = false;
    }
    return pages;
  }

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.sizeOf(context).width >= 1000;
    return SizedBox(
      width: isWide ? a4Width : 560,
      height: isWide ? a4Height : a4Height * (560 / a4Width),
      child: Material(
        color: Colors.white,
        child: Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _header(),
                const Divider(thickness: 2, color: Color(0xFF0F172A)),
                if (pageNumber == 1) _summary() else const SizedBox.shrink(),
                _tableHeader(),
                ...rows.map(_row),
                const Spacer(),
                _footer(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _header() => Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text(
            factoryName,
            style: const TextStyle(
              fontFamily: 'Cairo',
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: Color(0xFF0F172A),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'تقرير عامل: $workerName ($workerCode)',
            style: const TextStyle(
              fontFamily: 'Cairo',
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          Text(
            'الفترة: $periodLabel',
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 11),
          ),
        ],
      );

  num _numOf(Object? key) => num.tryParse('$key') ?? 0;

  Widget _summary() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            _cell('رصيد افتتاحي', money(_numOf(summary['openingNet']))),
            _cell('رصيد ختامي', money(_numOf(summary['closingNet']))),
            _cell('سلف الفترة', money(_numOf(summary['totalAdvances']))),
            _cell('سندات القبض', money(_numOf(summary['totalReceipts']))),
            _cell('إنتاج (قطع)', count(_numOf(summary['totalPieces']))),
            _cell('قيمة الإنتاج', money(_numOf(summary['productionValue']))),
            _cell('صافي الرواتب', money(_numOf(summary['totalNet']))),
            _cell(
              'الحضور/الغياب',
              '${count(_numOf(summary['presentDays']))} / '
              '${count(_numOf(summary['absentDays']))} يوم',
            ),
          ],
        ),
      );

  Widget _cell(String label, String value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFCBD5E1)),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 9,
                  color: Color(0xFF475569)),
            ),
            Text(
              value,
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Color(0xFF0F172A),
              ),
            ),
          ],
        ),
      );

  Widget _tableHeader() => Container(
        color: const Color(0xFF0F172A),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Row(
          children: const [
            Expanded(flex: 2, child: Text('التاريخ', style: _headTextStyle)),
            Expanded(flex: 4, child: Text('البيان', style: _headTextStyle)),
            Expanded(flex: 2, child: Text('قطع', style: _headTextStyle)),
            Expanded(flex: 3, child: Text('المبلغ', style: _headTextStyle)),
          ],
        ),
      );

  static const _headTextStyle = TextStyle(
    fontFamily: 'Cairo',
    fontSize: 11,
    fontWeight: FontWeight.w700,
    color: Colors.white,
  );

  Widget _row(Map<String, dynamic> row) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: Color(0xFFE2E8F0))),
        ),
        child: Row(
          children: [
            Expanded(
              flex: 2,
              child: Text(
                date(row['date']),
                style: const TextStyle(fontFamily: 'Cairo', fontSize: 10),
              ),
            ),
            Expanded(
              flex: 4,
              child: Text(
                '${row['label'] ?? ''}'
                '${(row['note']?.toString() ?? '').isEmpty ? '' : ' — ${row['note']}'}',
                style: const TextStyle(fontFamily: 'Cairo', fontSize: 10),
              ),
            ),
            Expanded(
              flex: 2,
              child: Text(
                (row['pieces'] ?? 0) == 0
                    ? '—'
                    : count(num.tryParse('${row['pieces']}') ?? 0),
                style: const TextStyle(fontFamily: 'Cairo', fontSize: 10),
              ),
            ),
            Expanded(
              flex: 3,
              child: Text(
                (row['amount'] ?? 0) == 0
                    ? '—'
                    : money(num.tryParse('${row['amount']}') ?? 0),
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      );

  Widget _footer() => Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text(
            'Garment Factory ERP — تقرير عامل',
            style: TextStyle(fontFamily: 'Cairo', fontSize: 9,
                color: Color(0xFF64748B)),
          ),
          Text(
            'صفحة $pageNumber من $totalPages',
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 9,
                color: Color(0xFF64748B)),
          ),
        ],
      );
}
