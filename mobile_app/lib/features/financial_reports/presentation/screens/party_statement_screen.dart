import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/services/statement_pdf_service.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/party_statement_cubit.dart';

/// SELIM-ERP W3 — شاشة كشف حساب العميل/المورد (نقل PartyReport من
/// Selim): ملخص (افتتاحي/ختامي/مدين/دائن) + جدول الحركات برصيد جارٍ +
/// نطاق فترة قابل للتغيير + تصدير PDF (عربية كاملة عبر محرك Flutter).
class PartyStatementScreen extends StatefulWidget {
  const PartyStatementScreen({
    super.key,
    required this.partyId,
    required this.isCustomer,
    this.cubit,
  });

  final String partyId;
  final bool isCustomer;
  final PartyStatementCubit? cubit;

  @override
  State<PartyStatementScreen> createState() => _PartyStatementScreenState();
}

class _PartyStatementScreenState extends State<PartyStatementScreen> {
  PartyStatementCubit? _ownCubit;
  DateTime _from = DateTime.now().subtract(const Duration(days: 90));
  DateTime _to = DateTime.now();
  bool _exporting = false;

  @override
  void dispose() {
    _ownCubit?.close();
    super.dispose();
  }

  Future<void> _pickRange() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      initialDateRange: DateTimeRange(start: _from, end: _to),
      helpText: 'اختر فترة الكشف',
    );
    if (picked == null) return;
    setState(() {
      _from = picked.start;
      _to = picked.end;
    });
    await cubit.load(widget.partyId, from: _from, to: _to);
  }

  PartyStatementCubit get cubit =>
      widget.cubit ??
      (_ownCubit ??= PartyStatementCubit(isCustomer: widget.isCustomer));

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => cubit..load(widget.partyId, from: _from, to: _to),
      child: BlocBuilder<PartyStatementCubit, PartyStatementState>(
        builder: (context, state) => SelimShellScaffold(
          title:
              widget.isCustomer ? 'كشف حساب عميل' : 'كشف حساب مورد',
          actions: [
            IconButton(
              tooltip: 'نطاق الفترة',
              icon: const Icon(Icons.date_range),
              onPressed: _pickRange,
            ),
          ],
          body: _body(context, state),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, PartyStatementState state) {
    if (state is PartyStatementLoading || state is PartyStatementInitial) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state is PartyStatementError) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(state.message, style: const TextStyle(fontFamily: 'Cairo')),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () =>
                  cubit.load(widget.partyId, from: _from, to: _to),
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }
    final statement = (state as PartyStatementLoaded).statement;
    return Column(
      children: [
        _summaryHeader(statement),
        Expanded(
          child: statement.movements.isEmpty
              ? const Center(
                  child: Text('لا حركات في الفترة المحددة',
                      style: TextStyle(fontFamily: 'Cairo')),
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                  itemCount: statement.movements.length,
                  itemBuilder: (context, index) =>
                      _movementRow(statement.movements[index]),
                ),
        ),
        _exportBar(statement),
      ],
    );
  }

  Widget _summaryHeader(PartyStatement statement) => Card(
        margin: const EdgeInsets.all(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      statement.name,
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Text(
                    statement.code,
                    style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 13,
                      color: AppColors.primary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  _metric('رصيد افتتاحي', money(statement.openingBalance)),
                  _metric('مدين', money(statement.totalDebit)),
                  _metric('دائن', money(statement.totalCredit)),
                  _metric(
                    'رصيد ختامي',
                    money(statement.closingBalance),
                    highlight: true,
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'الفترة: ${date(statement.from)} — ${date(statement.to)} · '
                '${count(statement.movementsCount)} حركة',
                style: const TextStyle(fontFamily: 'Cairo', fontSize: 11),
              ),
            ],
          ),
        ),
      );

  Widget _metric(String label, String value, {bool highlight = false}) =>
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

  Widget _movementRow(StatementMovement movement) => Card(
        margin: const EdgeInsets.symmetric(vertical: 3),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Expanded(
                flex: 3,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${movement.typeLabel} ${movement.ref}',
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    Text(
                      '${date(movement.date)} · ${movement.description}',
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 11,
                        color: Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                flex: 2,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      movement.debit > 0
                          ? money(movement.debit)
                          : (movement.credit > 0 ? money(movement.credit) : '—'),
                      style: TextStyle(
                        fontFamily: 'Cairo',
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                        color: movement.debit > 0
                            ? AppColors.error
                            : AppColors.success,
                      ),
                    ),
                    Text(
                      'رصيد ${money(movement.balanceAfter)}',
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 10,
                        color: Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );

  Widget _exportBar(PartyStatement statement) => Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: _exporting ? null : () => _exportPdf(statement),
                icon: _exporting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.picture_as_pdf),
                label: Text(_exporting ? 'جارٍ التصدير…' : 'تصدير PDF'),
              ),
            ),
          ],
        ),
      );

  Future<void> _exportPdf(PartyStatement statement) async {
    setState(() => _exporting = true);
    try {
      final path = await StatementPdfService.instance.shareStatementPdf(
        context: context,
        statement: statement,
      );
      if (mounted && path == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر توليد PDF')),
        );
      }
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }
}
