import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../cubit/accounting_cubit.dart';

/// تسميات أنواع الطرف المقابل (تطابق enum الخادم CUSTOMER/SUPPLIER/WORKER).
const Map<String, String> _counterpartyTypeLabels = {
  'CUSTOMER': 'عميل',
  'SUPPLIER': 'مورد',
  'WORKER': 'عامل',
};

class AccountingScreen extends StatelessWidget {
  const AccountingScreen({super.key, this.cubit});

  final AccountingCubit? cubit;

  @override
  Widget build(BuildContext context) {
    final content = Builder(
      builder: (screenContext) => DefaultTabController(
        length: 4,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('الحسابات والمالية'),
            bottom: const TabBar(
              tabs: [
                Tab(text: 'السندات', icon: Icon(Icons.receipt)),
                Tab(text: 'الحسابات', icon: Icon(Icons.account_tree)),
                Tab(text: 'القيود', icon: Icon(Icons.menu_book)),
                Tab(text: 'ميزان المراجعة', icon: Icon(Icons.balance)),
              ],
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.refresh),
                tooltip: 'تحديث',
                onPressed: () =>
                    screenContext.read<AccountingCubit>().fetchData(),
              ),
            ],
          ),
          body: BlocBuilder<AccountingCubit, AccountingState>(
            builder: (context, state) {
              if (state is AccountingInitial || state is AccountingLoading) {
                return const AppLoadingView();
              }
              if (state is AccountingError) {
                return AppErrorView(
                  message: state.message,
                  onRetry: () => context.read<AccountingCubit>().fetchData(),
                );
              }
              if (state is AccountingLoaded) {
                return TabBarView(
                  children: [
                    _VouchersTab(state: state),
                    _AccountsTab(accounts: state.accounts),
                    _JournalEntriesTab(state: state),
                    _TrialBalanceTab(state: state),
                  ],
                );
              }
              return const SizedBox.shrink();
            },
          ),
          floatingActionButton: FloatingActionButton.extended(
            onPressed: () => _showCreateVoucherDialog(screenContext),
            icon: const Icon(Icons.add),
            label: const Text('سند جديد'),
          ),
        ),
      ),
    );

    if (cubit != null) {
      return BlocProvider<AccountingCubit>.value(value: cubit!, child: content);
    }
    return BlocProvider<AccountingCubit>(
      create: (_) => AccountingCubit()..fetchData(),
      child: content,
    );
  }

  Future<void> _showCreateVoucherDialog(BuildContext context) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _CreateVoucherDialog(
        cubit: context.read<AccountingCubit>(),
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تسجيل السند بنجاح')),
      );
    }
  }
}

/// أدوات تنسيق موحدة لشاشة المحاسبة: مبالغ بمنزلتين + «جنيه»، وتواريخ
/// بنمط المشروع (DateFormat('yyyy-MM-dd'))، وخريطة أسماء الحسابات.
class AccountingFormats {
  const AccountingFormats._();

  /// مبلغ بمنزلتين عشريتين دائمًا (toStringAsFixed(2) — نمط المشروع).
  static String money(Object? value) {
    final parsed = num.tryParse(value?.toString() ?? '');
    return (parsed ?? 0).toStringAsFixed(2);
  }

  /// رقم عشري من قيمة JSON (num أو String) — للعمليات الحسابية.
  static double doubleOf(Object? value) {
    final parsed = num.tryParse(value?.toString() ?? '');
    return parsed?.toDouble() ?? 0;
  }

  /// تاريخ بنمط المشروع (yyyy-MM-dd) — أو القيمة الخام إن تعذر تحليلها.
  static String date(Object? value) {
    if (value == null) return '—';
    final parsed = DateTime.tryParse(value.toString());
    if (parsed == null) return value.toString();
    return DateFormat('yyyy-MM-dd').format(parsed);
  }

  /// خريطة معرف الحساب → «الاسم (الكود)» من شجرة الحسابات المحمّلة —
  /// تُستخدم لعرض أسماء الحسابات في بنود القيود بدل UUID الخام.
  static Map<String, String> accountLabels(List<dynamic> accounts) {
    final labels = <String, String>{};
    for (final account in accounts) {
      if (account is! Map || account['id'] == null) continue;
      final name = account['name']?.toString() ?? '';
      final code = account['code']?.toString() ?? '';
      String label;
      if (name.isNotEmpty && code.isNotEmpty) {
        label = '$name ($code)';
      } else if (name.isEmpty) {
        label = code;
      } else {
        label = name;
      }
      labels[account['id'].toString()] =
          label.isEmpty ? 'حساب غير مسمى' : label;
    }
    return labels;
  }

  /// اسم حساب من الخريطة — أو نص وصفي عند غيابه عن القائمة المحمّلة.
  static String account(Map<String, String> labels, Object? id) {
    if (id == null) return '—';
    return labels[id.toString()] ?? 'حساب غير متوفر';
  }
}

// ============================================================================
// تبويب السندات
// ============================================================================

class _VouchersTab extends StatelessWidget {
  const _VouchersTab({required this.state});

  final AccountingLoaded state;

  @override
  Widget build(BuildContext context) {
    if (state.vouchers.isEmpty) {
      return const AppEmptyView(title: 'لا توجد سندات مسجلة');
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: state.vouchers.length,
      itemBuilder: (context, index) {
        final voucher = state.vouchers[index];
        if (voucher is! Map) return const SizedBox.shrink();
        return _VoucherCard(
          voucher: Map<String, dynamic>.from(voucher),
          state: state,
        );
      },
    );
  }
}

class _VoucherCard extends StatelessWidget {
  const _VoucherCard({required this.voucher, required this.state});

  final Map<String, dynamic> voucher;
  final AccountingLoaded state;

  @override
  Widget build(BuildContext context) {
    final isPayment = voucher['type'] == 'PAYMENT';
    final treasury = voucher['treasury'];
    final treasuryName =
        treasury is Map ? (treasury['name']?.toString() ?? 'غير محددة') : 'غير محددة';
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        onTap: () => showVoucherDetailsSheet(
          context,
          voucher: voucher,
          state: state,
        ),
        leading: CircleAvatar(
          backgroundColor:
              isPayment ? Colors.red.shade50 : Colors.green.shade50,
          child: Icon(
            isPayment ? Icons.arrow_upward : Icons.arrow_downward,
            color: isPayment ? AppColors.error : AppColors.success,
          ),
        ),
        title: Text('${voucher['description'] ?? 'سند'}'),
        subtitle: Text(
          'المبلغ: ${AccountingFormats.money(voucher['amount'])} جنيه | '
          'الخزينة: $treasuryName\n'
          'التاريخ: ${AccountingFormats.date(voucher['date'])}',
        ),
        isThreeLine: true,
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _AccountingChip(
              label: isPayment ? 'صرف' : 'قبض',
              color: isPayment ? AppColors.error : AppColors.success,
            ),
            const SizedBox(width: 4),
            const Icon(
              Icons.chevron_left,
              size: 18,
              color: AppColors.textHint,
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================================
// تبويب شجرة الحسابات (كما كان — مع تنسيق ثابت)
// ============================================================================

class _AccountsTab extends StatelessWidget {
  const _AccountsTab({required this.accounts});

  final List<dynamic> accounts;

  @override
  Widget build(BuildContext context) {
    if (accounts.isEmpty) {
      return const AppEmptyView(title: 'شجرة الحسابات فارغة');
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: accounts.length,
      itemBuilder: (context, index) {
        final account = accounts[index];
        if (account is! Map) return const SizedBox.shrink();
        return Card(
          child: ListTile(
            leading: const Icon(Icons.account_balance_wallet),
            title: Text('${account['name'] ?? ''}'),
            subtitle: Text(
                'كود: ${account['code'] ?? ''} | النوع: ${account['type'] ?? ''}'),
            trailing:
                account['isGroup'] == true ? const Icon(Icons.folder) : null,
          ),
        );
      },
    );
  }
}

// ============================================================================
// تبويب القيود (GET /accounting/journal-entries — قائمة ببنودها المختصرة)
// ============================================================================

class _JournalEntriesTab extends StatelessWidget {
  const _JournalEntriesTab({required this.state});

  final AccountingLoaded state;

  @override
  Widget build(BuildContext context) {
    if (state.journalLoading) {
      return const AppLoadingView(message: 'جاري تحميل القيود...');
    }
    final error = state.journalEntriesError;
    if (error != null) {
      return AppErrorView(
        message: error,
        onRetry: () =>
            context.read<AccountingCubit>().fetchJournalEntries(),
      );
    }
    if (state.journalEntries.isEmpty) {
      return const AppEmptyView(
        title: 'لا توجد قيود محاسبية',
        message: 'سجّل قيدًا يدويًا أو أنشئ سندًا ليظهر هنا',
      );
    }
    final accountLabels = AccountingFormats.accountLabels(state.accounts);
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: state.journalEntries.length,
      itemBuilder: (context, index) {
        final entry = state.journalEntries[index];
        if (entry is! Map) return const SizedBox.shrink();
        return _JournalEntryCard(
          entry: Map<String, dynamic>.from(entry),
          accountLabels: accountLabels,
        );
      },
    );
  }
}

class _JournalEntryCard extends StatelessWidget {
  const _JournalEntryCard({
    required this.entry,
    required this.accountLabels,
  });

  final Map<String, dynamic> entry;
  final Map<String, String> accountLabels;

  @override
  Widget build(BuildContext context) {
    final lines = (entry['lines'] as List?)
            ?.whereType<Map>()
            .map((line) => Map<String, dynamic>.from(line))
            .toList() ??
        const <Map<String, dynamic>>[];
    final isAuto = entry['isAuto'] == true;
    final isReversed = entry['isReversed'] == true;
    final createdBy = entry['createdBy'];
    final createdByName =
        createdBy is Map ? createdBy['name']?.toString() : null;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    entry['code']?.toString() ?? 'قيد بدون كود',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
                _AccountingChip(
                  label: isAuto ? 'آلي' : 'يدوي',
                  color: isAuto ? AppColors.info : AppColors.textSecondary,
                ),
                if (isReversed) ...[
                  const SizedBox(width: 6),
                  const _AccountingChip(
                    label: 'معكوس',
                    color: AppColors.warning,
                  ),
                ],
              ],
            ),
            const SizedBox(height: 4),
            Text(entry['description']?.toString() ?? ''),
            const SizedBox(height: 4),
            Text(
              'التاريخ: ${AccountingFormats.date(entry['date'])}'
              '${createdByName != null && createdByName.isNotEmpty ? ' | بواسطة: $createdByName' : ''}',
              style:
                  const TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
            const Divider(height: 18),
            const Text(
              'بنود القيد',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
            ),
            const SizedBox(height: 4),
            if (lines.isEmpty)
              const Text('لا توجد بنود لهذا القيد',
                  style: TextStyle(fontSize: 12)),
            for (final line in lines)
              _JournalLineView(
                line: line,
                accountLabels: accountLabels,
                compact: true,
              ),
          ],
        ),
      ),
    );
  }
}

// ============================================================================
// تبويب ميزان المراجعة (GET /accounting/trial-balance)
// ============================================================================

class _TrialBalanceTab extends StatelessWidget {
  const _TrialBalanceTab({required this.state});

  final AccountingLoaded state;

  @override
  Widget build(BuildContext context) {
    if (state.trialBalanceLoading) {
      return const AppLoadingView(message: 'جاري تحميل ميزان المراجعة...');
    }
    final error = state.trialBalanceError;
    if (error != null) {
      return AppErrorView(
        message: error,
        onRetry: () => context.read<AccountingCubit>().fetchTrialBalance(),
      );
    }
    // صفوف الحركة فقط (الحسابات الصفرية بلا معنى في ميزان العرض).
    final rows = [
      for (final row in state.trialBalanceRows)
        if (AccountingFormats.doubleOf(row['totalDebit']) != 0 ||
            AccountingFormats.doubleOf(row['totalCredit']) != 0 ||
            AccountingFormats.doubleOf(row['balance']) != 0)
          row,
    ];
    if (rows.isEmpty) {
      return const AppEmptyView(
        title: 'لا توجد حركات في ميزان المراجعة',
        message: 'سجّل قيودًا محاسبية لتظهر الأرصدة هنا',
      );
    }
    return Column(
      children: [
        _TrialBalanceSummaryCard(state: state),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            children: [
              _TrialBalanceTable(rows: rows),
            ],
          ),
        ),
      ],
    );
  }
}

class _TrialBalanceSummaryCard extends StatelessWidget {
  const _TrialBalanceSummaryCard({required this.state});

  final AccountingLoaded state;

  @override
  Widget build(BuildContext context) {
    final balanced = state.balanced;
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      color: balanced == false
          ? AppColors.error.withValues(alpha: 0.06)
          : AppColors.success.withValues(alpha: 0.06),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    children: [
                      const Text('إجمالي المدين',
                          style: TextStyle(
                              fontSize: 12, color: AppColors.textSecondary)),
                      const SizedBox(height: 2),
                      Text(
                        '${AccountingFormats.money(state.totalDebit)} جنيه',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppColors.success,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                    width: 1, height: 36, color: AppColors.divider),
                Expanded(
                  child: Column(
                    children: [
                      const Text('إجمالي الدائن',
                          style: TextStyle(
                              fontSize: 12, color: AppColors.textSecondary)),
                      const SizedBox(height: 2),
                      Text(
                        '${AccountingFormats.money(state.totalCredit)} جنيه',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppColors.error,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (balanced != null) ...[
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    balanced ? Icons.check_circle : Icons.error,
                    color: balanced ? AppColors.success : AppColors.error,
                    size: 20,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    balanced ? 'الميزان متوازن' : 'الميزان غير متوازن',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontFamily: 'Cairo',
                      color: balanced ? AppColors.success : AppColors.error,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _TrialBalanceTable extends StatelessWidget {
  const _TrialBalanceTable({required this.rows});

  final List<Map<String, dynamic>> rows;

  @override
  Widget build(BuildContext context) {
    return Table(
      columnWidths: const {
        0: FlexColumnWidth(2.6),
        1: FlexColumnWidth(1.2),
        2: FlexColumnWidth(1.2),
        3: FlexColumnWidth(1.6),
      },
      defaultVerticalAlignment: TableCellVerticalAlignment.middle,
      border: TableBorder(
        top: BorderSide(color: AppColors.divider),
        horizontalInside: BorderSide(color: AppColors.divider),
        bottom: BorderSide(color: AppColors.divider),
      ),
      children: [
        TableRow(
          decoration:
              BoxDecoration(color: AppColors.primary.withValues(alpha: 0.08)),
          children: const [
            _TableHeaderCell('الحساب'),
            _TableHeaderCell('مدين', centered: true),
            _TableHeaderCell('دائن', centered: true),
            _TableHeaderCell('الرصيد', centered: true),
          ],
        ),
        for (final row in rows)
          TableRow(
            children: [
              _AccountCell(
                name: row['name']?.toString() ?? '',
                code: row['code']?.toString() ?? '',
              ),
              _NumberCell(AccountingFormats.money(row['totalDebit'])),
              _NumberCell(AccountingFormats.money(row['totalCredit'])),
              _BalanceCell(balance: AccountingFormats.doubleOf(row['balance'])),
            ],
          ),
      ],
    );
  }
}

class _TableHeaderCell extends StatelessWidget {
  const _TableHeaderCell(this.label, {this.centered = false});

  final String label;
  final bool centered;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
      child: Text(
        label,
        textAlign: centered ? TextAlign.center : TextAlign.start,
        style: const TextStyle(
          fontWeight: FontWeight.bold,
          fontSize: 12,
          fontFamily: 'Cairo',
        ),
      ),
    );
  }
}

class _AccountCell extends StatelessWidget {
  const _AccountCell({required this.name, required this.code});

  final String name;
  final String code;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            name.isEmpty ? 'حساب غير مسمى' : name,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
          if (code.isNotEmpty)
            Text(
              code,
              style: const TextStyle(
                  fontSize: 10, color: AppColors.textSecondary),
            ),
        ],
      ),
    );
  }
}

class _NumberCell extends StatelessWidget {
  const _NumberCell(this.value);

  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      child: Text(
        value,
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 12),
      ),
    );
  }
}

class _BalanceCell extends StatelessWidget {
  const _BalanceCell({required this.balance});

  final double balance;

  @override
  Widget build(BuildContext context) {
    final label = balance > 0
        ? 'مدين'
        : balance < 0
            ? 'دائن'
            : '';
    final color = balance > 0
        ? AppColors.success
        : balance < 0
            ? AppColors.error
            : AppColors.textSecondary;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            AccountingFormats.money(balance.abs()),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12),
          ),
          if (label.isNotEmpty) ...[
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                  fontSize: 10, color: color, fontWeight: FontWeight.bold),
            ),
          ],
        ],
      ),
    );
  }
}

// ============================================================================
// ورقة تفاصيل السند (BottomSheet) + بنود القيد المرتبط
// ============================================================================

Future<void> showVoucherDetailsSheet(
  BuildContext context, {
  required Map<String, dynamic> voucher,
  required AccountingLoaded state,
}) {
  // يُلتقط الـ cubit قبل فتح الورقة — لا context عبر async داخلها.
  final cubit = context.read<AccountingCubit>();
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _VoucherDetailsSheet(
      voucher: voucher,
      cubit: cubit,
      accountLabels: AccountingFormats.accountLabels(state.accounts),
    ),
  );
}

class _VoucherDetailsSheet extends StatefulWidget {
  const _VoucherDetailsSheet({
    required this.voucher,
    required this.cubit,
    required this.accountLabels,
  });

  final Map<String, dynamic> voucher;
  final AccountingCubit cubit;
  final Map<String, String> accountLabels;

  @override
  State<_VoucherDetailsSheet> createState() => _VoucherDetailsSheetState();
}

class _VoucherDetailsSheetState extends State<_VoucherDetailsSheet> {
  /// يبدأ الجلب مرة واحدة عند فتح الورقة (وليس داخل build).
  late final Future<Map<String, dynamic>?> _entryFuture;
  late final Future<String?> _counterpartyNameFuture;

  @override
  void initState() {
    super.initState();
    _entryFuture = widget.cubit.findJournalEntryForVoucher(widget.voucher);
    _counterpartyNameFuture = _resolveCounterpartyName();
  }

  /// اسم الطرف المقابل من قائمة نوعه — يعطّل الـ UUID الخام في العرض.
  Future<String?> _resolveCounterpartyName() async {
    final type = widget.voucher['counterpartyType']?.toString();
    final id = widget.voucher['counterpartyId']?.toString();
    if (type == null || id == null || type.isEmpty || id.isEmpty) return null;
    try {
      final parties = await widget.cubit.fetchCounterparties(type);
      for (final party in parties) {
        if (party['id']?.toString() == id) {
          final name = party['name']?.toString();
          if (name != null && name.isNotEmpty) return name;
          return party['code']?.toString();
        }
      }
    } catch (_) {
      // فشل التعرف على الاسم ليس فادحًا — يُعرض المعرف كما هو.
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final voucher = widget.voucher;
    final isPayment = voucher['type'] == 'PAYMENT';
    final treasury = voucher['treasury'];
    final createdBy = voucher['createdBy'];
    final code = voucher['code']?.toString() ??
        (voucher['journalEntry'] is Map
            ? voucher['journalEntry']['code']?.toString()
            : null) ??
        '—';
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.85,
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _SheetHeader(
                isPayment: isPayment,
                code: code,
                amount: AccountingFormats.money(voucher['amount']),
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.background,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(voucher['description']?.toString() ?? 'بلا وصف'),
              ),
              const SizedBox(height: 12),
              _infoRow(
                'التاريخ',
                AccountingFormats.date(voucher['date']),
              ),
              _infoRow(
                'الخزينة',
                treasury is Map
                    ? (treasury['name']?.toString() ?? 'غير محددة')
                    : 'غير محددة',
              ),
              _infoRow(
                'أنشأه',
                createdBy is Map
                    ? (createdBy['name']?.toString() ?? '—')
                    : '—',
              ),
              _infoRow(
                'المرجع الخارجي',
                (voucher['reference']?.toString() ?? '').isEmpty
                    ? '—'
                    : voucher['reference'].toString(),
              ),
              _counterpartyRow(),
              const SizedBox(height: 8),
              FutureBuilder<Map<String, dynamic>?>(
                future: _entryFuture,
                builder: (context, snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: Center(
                        child: SizedBox(
                          height: 28,
                          width: 28,
                          child: CircularProgressIndicator(strokeWidth: 3),
                        ),
                      ),
                    );
                  }
                  if (snapshot.hasError) {
                    return _sheetNotice(
                      'تعذر تحميل القيد المحاسبي المرتبط — تحقق من الشبكة وحاول مجددًا.',
                    );
                  }
                  final entry = snapshot.data;
                  if (entry == null) {
                    return _sheetNotice(
                      'لم يُعثر على القيد المحاسبي المرتبط بهذا السند — قد يكون خارج آخر 100 قيد أو غير متاح لصلاحيات دورك.',
                    );
                  }
                  return _buildEntrySection(entry);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _counterpartyRow() {
    final type = widget.voucher['counterpartyType']?.toString();
    if (type == null || type.isEmpty) {
      return _infoRow('الطرف المقابل', 'سند نثري (بلا طرف مقابل)');
    }
    final typeLabel = _counterpartyTypeLabels[type] ?? type;
    return FutureBuilder<String?>(
      future: _counterpartyNameFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return _infoRow('الطرف المقابل', '$typeLabel — جاري التعرف...');
        }
        final name = snapshot.data;
        if (name != null && name.isNotEmpty) {
          return _infoRow('الطرف المقابل', '$typeLabel — $name');
        }
        return _infoRow(
          'الطرف المقابل',
          '$typeLabel — ${widget.voucher['counterpartyId']}',
        );
      },
    );
  }

  Widget _buildEntrySection(Map<String, dynamic> entry) {
    final lines = (entry['lines'] as List?)
            ?.whereType<Map>()
            .map((line) => Map<String, dynamic>.from(line))
            .toList() ??
        const <Map<String, dynamic>>[];
    final isAuto = entry['isAuto'] == true;
    final isReversed = entry['isReversed'] == true;
    final createdBy = entry['createdBy'];
    final createdByName =
        createdBy is Map ? createdBy['name']?.toString() : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(height: 24),
        Row(
          children: [
            const Icon(Icons.menu_book,
                size: 18, color: AppColors.primary),
            const SizedBox(width: 6),
            const Expanded(
              child: Text(
                'القيد المحاسبي المرتبط',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
              ),
            ),
            Text(
              entry['code']?.toString() ?? '—',
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(entry['description']?.toString() ?? ''),
        const SizedBox(height: 4),
        Text(
          'التاريخ: ${AccountingFormats.date(entry['date'])}'
          '${createdByName != null && createdByName.isNotEmpty ? ' | بواسطة: $createdByName' : ''}',
          style: const TextStyle(
              color: AppColors.textSecondary, fontSize: 12),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            _AccountingChip(
              label: isAuto ? 'قيد آلي' : 'قيد يدوي',
              color: isAuto ? AppColors.info : AppColors.textSecondary,
            ),
            if (isReversed) ...[
              const SizedBox(width: 6),
              const _AccountingChip(
                  label: 'معكوس', color: AppColors.warning),
            ],
          ],
        ),
        const Divider(height: 20),
        const Text(
          'بنود القيد',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
        ),
        const SizedBox(height: 4),
        if (lines.isEmpty)
          const Text('لا توجد بنود مسجلة لهذا القيد')
        else
          for (final line in lines)
            _JournalLineView(
              line: line,
              accountLabels: widget.accountLabels,
            ),
      ],
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sheetNotice(String message) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline,
              size: 18, color: AppColors.textSecondary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _SheetHeader extends StatelessWidget {
  const _SheetHeader({
    required this.isPayment,
    required this.code,
    required this.amount,
  });

  final bool isPayment;
  final String code;
  final String amount;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        CircleAvatar(
          backgroundColor:
              isPayment ? Colors.red.shade50 : Colors.green.shade50,
          child: Icon(
            isPayment ? Icons.arrow_upward : Icons.arrow_downward,
            color: isPayment ? AppColors.error : AppColors.success,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                isPayment ? 'سند صرف' : 'سند قبض',
                style: const TextStyle(
                    fontWeight: FontWeight.bold, fontSize: 17),
              ),
              Text(
                'الكود: $code',
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 12),
              ),
            ],
          ),
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              amount,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 20,
                fontFamily: 'Cairo',
                color: isPayment ? AppColors.error : AppColors.success,
              ),
            ),
            const Text('جنيه',
                style: TextStyle(
                    color: AppColors.textSecondary, fontSize: 12)),
          ],
        ),
      ],
    );
  }
}

/// بند قيد واحد: مدين/دائن + المبلغ (+وصف البند). يُستخدم في ورقة تفاصيل
/// السند (تفصيلي) وفي تبويب القيود (مختصر compact).
class _JournalLineView extends StatelessWidget {
  const _JournalLineView({
    required this.line,
    required this.accountLabels,
    this.compact = false,
  });

  final Map<String, dynamic> line;
  final Map<String, String> accountLabels;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final debit = AccountingFormats.account(
      accountLabels,
      line['debitAccountId'],
    );
    final credit = AccountingFormats.account(
      accountLabels,
      line['creditAccountId'],
    );
    final amount = AccountingFormats.money(line['amount']);
    final description = line['description']?.toString();
    final hasDescription = description != null && description.isNotEmpty;

    if (compact) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            const Icon(Icons.subdirectory_arrow_left,
                size: 14, color: AppColors.textSecondary),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                'مدين: $debit — دائن: $credit',
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12),
              ),
            ),
            Text(
              '$amount جنيه',
              style: const TextStyle(
                  fontSize: 12, fontWeight: FontWeight.bold),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const _DebitCreditChip(isDebit: true),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  debit,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
              Text(
                '$amount جنيه',
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              const _DebitCreditChip(isDebit: false),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  credit,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ],
          ),
          if (hasDescription)
            Padding(
              padding: const EdgeInsetsDirectional.only(top: 2, start: 4),
              child: Text(
                description,
                style: const TextStyle(
                    fontSize: 11, color: AppColors.textSecondary),
              ),
            ),
        ],
      ),
    );
  }
}

// ============================================================================
// عناصر مشتركة
// ============================================================================

class _AccountingChip extends StatelessWidget {
  const _AccountingChip({
    required this.label,
    required this.color,
  });

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              fontFamily: 'Cairo',
            ),
          ),
        ],
      ),
    );
  }
}

class _DebitCreditChip extends StatelessWidget {
  const _DebitCreditChip({required this.isDebit});

  final bool isDebit;

  @override
  Widget build(BuildContext context) {
    return _AccountingChip(
      label: isDebit ? 'مدين' : 'دائن',
      color: isDebit ? AppColors.success : AppColors.error,
    );
  }
}

// ============================================================================
// حوار إنشاء السند — مع منتقي الطرف المقابل (تحميل كسول)
// ============================================================================

class _CreateVoucherDialog extends StatefulWidget {
  const _CreateVoucherDialog({required this.cubit});

  final AccountingCubit cubit;

  @override
  State<_CreateVoucherDialog> createState() => _CreateVoucherDialogState();
}

class _CreateVoucherDialogState extends State<_CreateVoucherDialog> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _referenceController = TextEditingController();
  String _type = 'RECEIPT';
  String? _treasuryId;
  String? _counterpartyType;
  String? _counterpartyId;
  var _isSaving = false;

  /// كاش الأطراف المقابلة حسب النوع — يُجلب مرة واحدة لكل نوع (تحميل كسول).
  final Map<String, List<Map<String, dynamic>>> _counterpartiesCache = {};
  final Set<String> _counterpartiesLoading = {};
  final Map<String, String> _counterpartiesErrors = {};

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    _referenceController.dispose();
    super.dispose();
  }

  void _onCounterpartyTypeChanged(String? value) {
    if (value == null || value == _counterpartyType) return;
    setState(() {
      _counterpartyType = value;
      // تغيير النوع يبدأ اختيار طرف جديد من نوعه.
      _counterpartyId = null;
    });
    _loadCounterparties(value);
  }

  Future<void> _loadCounterparties(String type) async {
    if (_counterpartiesCache.containsKey(type) ||
        _counterpartiesLoading.contains(type)) {
      return;
    }
    setState(() {
      _counterpartiesLoading.add(type);
      _counterpartiesErrors.remove(type);
    });
    try {
      final parties = await widget.cubit.fetchCounterparties(type);
      if (!mounted) return;
      setState(() {
        _counterpartiesLoading.remove(type);
        _counterpartiesCache[type] = parties;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _counterpartiesLoading.remove(type);
        _counterpartiesErrors[type] = ApiClient.instance.messageFor(error);
      });
    }
  }

  Future<void> _save(AccountingLoaded state) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.createVoucher(
        type: _type,
        amount: double.parse(_amountController.text.trim()),
        description: _descriptionController.text.trim(),
        treasuryId: _treasuryId!,
        reference: _referenceController.text.trim(),
        counterpartyType: _counterpartyType,
        counterpartyId: _counterpartyId,
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      // رسالة الخادم الفعلية (403/400/شبكة) بدل رسالة عامة تبتلعها.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content:
              Text('تعذر حفظ السند: ${ApiClient.instance.messageFor(error)}'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.cubit.state;
    if (state is! AccountingLoaded) {
      return const AlertDialog(
        content: Text('بيانات الخزائن غير متاحة. حدّث الشاشة وحاول مرة أخرى.'),
      );
    }
    return AlertDialog(
      title: const Text('إنشاء سند جديد'),
      content: SizedBox(
        width: 460,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _type,
                  decoration: const InputDecoration(labelText: 'نوع السند *'),
                  items: const [
                    DropdownMenuItem(value: 'RECEIPT', child: Text('قبض')),
                    DropdownMenuItem(value: 'PAYMENT', child: Text('صرف')),
                  ],
                  onChanged: _isSaving
                      ? null
                      : (value) {
                          if (value != null) setState(() => _type = value);
                        },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _amountController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'المبلغ *'),
                  validator: (value) {
                    final amount = double.tryParse(value?.trim() ?? '');
                    return amount == null || amount <= 0
                        ? 'أدخل مبلغًا موجبًا'
                        : null;
                  },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _descriptionController,
                  decoration: const InputDecoration(labelText: 'الوصف *'),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'الوصف مطلوب'
                      : null,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _treasuryId,
                  decoration: const InputDecoration(labelText: 'الخزينة *'),
                  items: state.treasuries
                      .whereType<Map>()
                      .where((treasury) => treasury['id'] != null)
                      .map(
                        (treasury) => DropdownMenuItem<String>(
                          value: treasury['id'].toString(),
                          child: Text('${treasury['name'] ?? 'خزينة'}'),
                        ),
                      )
                      .toList(),
                  onChanged: _isSaving
                      ? null
                      : (value) => setState(() => _treasuryId = value),
                  validator: (value) => value == null ? 'اختر الخزينة' : null,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _counterpartyType,
                  decoration: const InputDecoration(
                      labelText: 'نوع الطرف المقابل'),
                  items: const [
                    DropdownMenuItem(value: 'CUSTOMER', child: Text('عميل')),
                    DropdownMenuItem(value: 'SUPPLIER', child: Text('مورد')),
                    DropdownMenuItem(value: 'WORKER', child: Text('عامل')),
                  ],
                  onChanged: _isSaving
                      ? null
                      : _onCounterpartyTypeChanged,
                ),
                if (_counterpartyType != null) ...[
                  const SizedBox(height: 10),
                  _buildCounterpartyField(),
                ],
                const SizedBox(height: 10),
                TextFormField(
                  controller: _referenceController,
                  decoration: const InputDecoration(labelText: 'مرجع خارجي'),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : () => _save(state),
          child: Text(_isSaving ? 'جاري الحفظ...' : 'حفظ'),
        ),
      ],
    );
  }

  /// حقل الطرف المقابل — قائمة منسدلة بأسماء الأطراف (الاسم + الكود)
  /// تُجلب عند اختيار النوع مع مؤشر تحميل وإعادة محاولة عند الفشل.
  Widget _buildCounterpartyField() {
    final type = _counterpartyType!;
    if (_counterpartiesLoading.contains(type)) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 14),
        child: Row(
          children: [
            SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 10),
            Text('جاري تحميل الأطراف المقابلة...'),
          ],
        ),
      );
    }
    final error = _counterpartiesErrors[type];
    if (error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'تعذر تحميل الأطراف المقابلة: $error',
              style: const TextStyle(color: AppColors.error, fontSize: 12),
            ),
            TextButton.icon(
              onPressed:
                  _isSaving ? null : () => _loadCounterparties(type),
              icon: const Icon(Icons.refresh),
              label: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }
    final parties = (_counterpartiesCache[type] ?? const [])
        .whereType<Map>()
        .where((party) => party['id'] != null)
        .map((party) => Map<String, dynamic>.from(party))
        .toList();
    if (parties.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 6),
        child: Text(
          'لا توجد أطراف مسجلة من هذا النوع بعد — يمكنك حفظ السند بدون طرف مقابل.',
        ),
      );
    }
    return DropdownButtonFormField<String>(
      // مفتاح لكل نوع: تغيير النوع يعيد بناء الحقل فيبدأ الاختيار من جديد.
      key: ValueKey('counterparty-$type'),
      initialValue: _counterpartyId,
      decoration: const InputDecoration(labelText: 'الطرف المقابل *'),
      items: [
        for (final party in parties)
          DropdownMenuItem<String>(
            value: party['id'].toString(),
            child: Text(
              '${party['name'] ?? 'غير مسمى'} — ${party['code'] ?? party['id']}',
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      onChanged: _isSaving
          ? null
          : (value) => setState(() => _counterpartyId = value),
      validator: (value) => value == null ? 'اختر الطرف المقابل' : null,
    );
  }
}
