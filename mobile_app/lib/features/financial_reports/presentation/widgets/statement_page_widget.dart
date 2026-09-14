import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/selim/format.dart';
import '../cubit/party_statement_cubit.dart';

/// SELIM-ERP W3 — صفحة كشف حساب (Widget يُصيَّر صورة ثم يوضع في PDF):
/// عرض A4 بنسبة ثابتة — نفس نهج المرجع في ضمان العربية الكاملة (المرجع
/// يصيّر عبر Playwright على الخادم؛ نحن نصيّر الـ Widget نفسه بمحرك
/// Flutter — تشكيل عربي سليم بلا Playwright).
class StatementPageWidget extends StatelessWidget {
  const StatementPageWidget({
    required this.statement,
    required this.rows,
    required this.pageNumber,
    required this.totalPages,
    required this.factoryName,
    super.key,
  });

  /// عرض A4 بالبكسل المنطقي (96dpi).
  static const double a4Width = 794;
  static const double a4Height = 1123;

  final PartyStatement statement;
  final List<StatementMovement> rows;
  final int pageNumber;
  final int totalPages;
  final String factoryName;

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.sizeOf(context).width >= 1000;
    return SizedBox(
      width: isWide ? a4Width : 560,
      height: isWide ? a4Height : 1123 * (560 / a4Width),
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
            statement.isCustomer
                ? 'كشف حساب عميل: ${statement.name} (${statement.code})'
                : 'كشف حساب مورد: ${statement.name} (${statement.code})',
            style: const TextStyle(
              fontFamily: 'Cairo',
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          Text(
            'الفترة: ${date(statement.from)} — ${date(statement.to)}',
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 11),
          ),
        ],
      );

  Widget _summary() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            _summaryCell('رصيد افتتاحي', money(statement.openingBalance)),
            _summaryCell('مدين الفترة', money(statement.totalDebit)),
            _summaryCell('دائن الفترة', money(statement.totalCredit)),
            _summaryCell(
              'رصيد ختامي',
              money(statement.closingBalance),
              highlight: true,
            ),
          ],
        ),
      );

  Widget _summaryCell(String label, String value, {bool highlight = false}) =>
      Expanded(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 3),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: highlight ? AppColors.primary : const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            children: [
              Text(
                label,
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 10,
                  color: highlight ? Colors.white : const Color(0xFF64748B),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: highlight ? Colors.white : const Color(0xFF0F172A),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _tableHeader() => Container(
        color: AppColors.primary,
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
        child: const Row(
          children: [
            Expanded(flex: 2, child: _HeaderText('التاريخ')),
            Expanded(flex: 2, child: _HeaderText('البيان')),
            Expanded(flex: 3, child: _HeaderText('المرجع')),
            Expanded(flex: 2, child: _HeaderText('مدين')),
            Expanded(flex: 2, child: _HeaderText('دائن')),
            Expanded(flex: 2, child: _HeaderText('الرصيد')),
          ],
        ),
      );

  Widget _row(StatementMovement movement) => Container(
        padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 8),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: Colors.grey.shade300, width: 0.5),
          ),
        ),
        child: Row(
          children: [
            Expanded(
              flex: 2,
              child: _CellText(date(movement.date), fontSize: 10),
            ),
            Expanded(
              flex: 2,
              child: _CellText(
                '${movement.typeLabel} ${movement.description}',
                fontSize: 10,
              ),
            ),
            Expanded(flex: 3, child: _CellText(movement.ref, fontSize: 10)),
            Expanded(
              flex: 2,
              child: _CellText(
                movement.debit > 0 ? money(movement.debit) : '—',
                fontSize: 10,
              ),
            ),
            Expanded(
              flex: 2,
              child: _CellText(
                movement.credit > 0 ? money(movement.credit) : '—',
                fontSize: 10,
              ),
            ),
            Expanded(
              flex: 2,
              child: _CellText(money(movement.balanceAfter), fontSize: 10),
            ),
          ],
        ),
      );

  Widget _footer() => Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            'صفحة $pageNumber من $totalPages',
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 9),
          ),
          Text(
            'أُنشئ بواسطة نظام ERP مصنع الملابس — ${dateTime(DateTime.now())}',
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 9),
          ),
        ],
      );
}

class _HeaderText extends StatelessWidget {
  const _HeaderText(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(
          fontFamily: 'Cairo',
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
        overflow: TextOverflow.ellipsis,
      );
}

class _CellText extends StatelessWidget {
  const _CellText(this.text, {this.fontSize = 11});

  final String text;
  final double fontSize;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: TextStyle(fontFamily: 'Cairo', fontSize: fontSize),
        overflow: TextOverflow.ellipsis,
        maxLines: 1,
      );
}
