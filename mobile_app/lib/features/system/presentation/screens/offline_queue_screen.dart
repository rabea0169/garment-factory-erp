import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/services/outbox_service.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/selim_shell.dart';

/// SELIM-ERP W3 — لوحة طابور المزامنة (نقل OfflineQueuePanel من Selim):
/// عرض العمليات المعلّقة/الفاشلة مع رسالة الخطأ + إعادة محاولة فردية +
/// حذف فردي + مسح الفاشلة. العمليات المالية تطلب تأكيدًا صريحًا قبل
/// إعادة الإرسال (قاعدة APP-1 في المرجع).
class OfflineQueueScreen extends StatelessWidget {
  const OfflineQueueScreen({this.service, super.key});

  final OutboxService? service;

  @override
  Widget build(BuildContext context) {
    final outbox = service ?? OutboxService.instance;
    return SelimShellScaffold(
      title: 'طابور المزامنة',
      actions: [
        IconButton(
          tooltip: 'إرسال المعلّقة الآن',
          icon: const Icon(Icons.cloud_upload),
          onPressed: () => outbox.drain(),
        ),
      ],
      body: ListenableBuilder(
        listenable: outbox,
        builder: (context, _) {
          final entries = outbox.pendingEntries;
          if (entries.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.cloud_done_outlined,
                      size: 56, color: AppColors.success),
                  SizedBox(height: 12),
                  Text('كل العمليات متزامنة',
                      style: TextStyle(fontFamily: 'Cairo', fontSize: 15)),
                ],
              ),
            );
          }
          return Column(
            children: [
              _summaryBar(context, outbox),
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                  itemCount: entries.length,
                  itemBuilder: (context, index) =>
                      _QueueCard(entry: entries[index], outbox: outbox),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _summaryBar(BuildContext context, OutboxService outbox) {
    final total = outbox.pendingCount;
    final failed = outbox.failedCount;
    // SELIM-ERP W4: التعارضات أولوية العرض (بيانات تغيّرت خادميًا).
    final conflicts = outbox.conflictCount;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      color: conflicts > 0
          ? AppColors.warning.withValues(alpha: 0.12)
          : failed > 0
              ? AppColors.error.withValues(alpha: 0.08)
              : AppColors.primary.withValues(alpha: 0.06),
      child: Row(
        children: [
          Icon(
            conflicts > 0
                ? Icons.sync_problem
                : failed > 0
                    ? Icons.warning_amber
                    : Icons.schedule,
            color: conflicts > 0
                ? AppColors.warning
                : failed > 0
                    ? AppColors.error
                    : AppColors.primary,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              conflicts > 0
                  ? '$conflicts تعارضًا و$failed فاشلة من أصل $total — تحتاج قرارك'
                  : failed > 0
                      ? '$failed عملية فاشلة من أصل $total — تحتاج قرارك'
                      : '$total عملية معلّقة — تُرسل تلقائيًا عند عودة الاتصال',
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
            ),
          ),
          if (failed > 0)
            TextButton(
              onPressed: () => _confirmClearFailed(context, outbox),
              child: const Text('مسح الفاشلة'),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmClearFailed(
    BuildContext context,
    OutboxService outbox,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('مسح العمليات الفاشلة؟',
            style: TextStyle(fontFamily: 'Cairo')),
        content: const Text(
          'ستُحذف العمليات المرفوضة نهائيًا من الجهاز — لن تُرسل إلى الخادم.',
          style: TextStyle(fontFamily: 'Cairo'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('تراجع'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('مسح'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      final removed = await outbox.clearFailed();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('مُسحت $removed عملية فاشلة')),
        );
      }
    }
  }
}

class _QueueCard extends StatelessWidget {
  const _QueueCard({required this.entry, required this.outbox});

  final OutboxEntry entry;
  final OutboxService outbox;

  @override
  Widget build(BuildContext context) {
    final failed = entry.status == OutboxStatus.failed;
    // SELIM-ERP W4: التعارض (409) له تمييز كهرماني وزر حلّ خاص.
    final conflict = entry.status == OutboxStatus.conflict;
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      color: conflict
          ? AppColors.warning.withValues(alpha: 0.10)
          : failed
              ? AppColors.error.withValues(alpha: 0.04)
              : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  conflict
                      ? Icons.sync_problem
                      : failed
                          ? Icons.error_outline
                          : Icons.cloud_queue,
                  color: conflict
                      ? AppColors.warning
                      : failed
                          ? AppColors.error
                          : AppColors.primary,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    entry.title ?? _fallbackTitle(),
                    style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
                _statusChip(context, failed, conflict),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              entry.description ?? entry.path,
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12,
                color: Color(0xFF64748B),
              ),
            ),
            if (entry.amount != null) ...[
              const SizedBox(height: 2),
              Text(
                money(entry.amount!),
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            const SizedBox(height: 4),
            Text(
              'أُنشئت ${dateTime(entry.createdAt)}'
              ' · محاولات ${entry.attempts}/${entry.maxAttempts}',
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 10),
            ),
            if ((failed || conflict) && entry.lastError != null) ...[
              const SizedBox(height: 6),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.error.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  entry.lastError!,
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 11,
                    color: AppColors.error,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (conflict)
                  TextButton.icon(
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.warning,
                    ),
                    onPressed: () => _resolveConflict(context),
                    icon: const Icon(Icons.merge_type, size: 18),
                    label: const Text('حلّ التعارض'),
                  ),
                if (failed)
                  TextButton.icon(
                    onPressed: () => _retry(context),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('إعادة المحاولة'),
                  ),
                TextButton.icon(
                  onPressed: () => _delete(context),
                  icon: const Icon(Icons.delete_outline,
                      size: 18, color: AppColors.error),
                  label: const Text('حذف',
                      style: TextStyle(color: AppColors.error)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _fallbackTitle() => 'عملية ${entry.method} ${entry.path}';

  Widget _statusChip(BuildContext context, bool failed, bool conflict) =>
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(
          color: conflict
              ? AppColors.warning
              : failed
                  ? AppColors.error
                  : AppColors.primary,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          conflict ? 'تعارض' : failed ? 'فاشلة' : 'معلّقة',
          style: const TextStyle(
            fontFamily: 'Cairo',
            fontSize: 10,
            color: Colors.white,
          ),
        ),
      );

  /// SELIM-ERP W4 (ConflictResolver APP-2): عرض النسختين وقرار المستخدم —
  /// أعد إرسال نسختك بمفتاح اندماجية جديد / اعتمد بيانات الخادم (حذف).
  Future<void> _resolveConflict(BuildContext context) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => _ConflictResolverSheet(
        entry: entry,
        outbox: outbox,
      ),
    );
  }

  Future<void> _retry(BuildContext context) async {
    // العمليات المالية: تأكيد صريح قبل إعادة الإرسال (لا كتابة صامتة).
    var confirmed = true;
    if (entry.isFinancial) {
      confirmed = await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: const Text('إعادة إرسال عملية مالية؟',
                  style: TextStyle(fontFamily: 'Cairo')),
              content: Text(
                entry.amount != null
                    ? 'المبلغ ${money(entry.amount!)} — تأكد من عدم تكرارها خادميًا أولًا.'
                    : 'هذه عملية مالية معلّقة — تأكد من حالتها قبل إعادة الإرسال.',
                style: const TextStyle(fontFamily: 'Cairo'),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext, false),
                  child: const Text('تراجع'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(dialogContext, true),
                  child: const Text('إرسال'),
                ),
              ],
            ),
          ) ??
          false;
    }
    if (!confirmed) return;
    final ok = await outbox.retryOne(entry.id);
    if (context.mounted && !ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('ما زالت العملية مرفوضة من الخادم')),
      );
    }
  }

  Future<void> _delete(BuildContext context) async {
    await outbox.deleteOne(entry.id);
  }
}

/// SELIM-ERP W4 — محلّ التعارض (نقل ConflictResolver APP-2 من المرجع):
/// يعرض رسالة الخادم وبياناته مقابل نسختك المحلية، والقرار:
/// - «أعد إرسال نسختي» (keepLocal): مفتاح اندماجية جديد + إرسال.
/// - «اعتمد بيانات الخادم» (keepServer): حذف العنصر (بيانات الخادم
///   هي الحقيقة) — قرار لا رجعة فيه.
class _ConflictResolverSheet extends StatefulWidget {
  const _ConflictResolverSheet({required this.entry, required this.outbox});

  final OutboxEntry entry;
  final OutboxService outbox;

  @override
  State<_ConflictResolverSheet> createState() =>
      _ConflictResolverSheetState();
}

class _ConflictResolverSheetState extends State<_ConflictResolverSheet> {
  bool _working = false;

  Future<void> _keepLocal() async {
    setState(() => _working = true);
    final ok = await widget.outbox.retryWithFreshKey(widget.entry.id);
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أُرسلت نسختك وقُبلت من الخادم')),
      );
    } else {
      setState(() => _working = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('ما زال التعارض قائمًا — راجع بيانات الخادم'),
        ),
      );
    }
  }

  Future<void> _keepServer() async {
    setState(() => _working = true);
    await widget.outbox.deleteOne(widget.entry.id);
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final entry = widget.entry;
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.sync_problem, color: AppColors.warning),
              const SizedBox(width: 8),
              Text(
                'تعارض مع بيانات الخادم',
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            entry.title ?? 'عملية ${entry.method} ${entry.path}',
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
          ),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.warning.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'رسالة الخادم:',
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  entry.lastError ?? 'تعارض (409)',
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 12,
                    color: AppColors.warning,
                  ),
                ),
                if (entry.serverData != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    'بيانات الخادم: ${entry.serverData}',
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 10,
                      color: Colors.black54,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'نسختك المحلية: ${entry.body}',
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontFamily: 'Cairo',
              fontSize: 10,
              color: Colors.black54,
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _working ? null : _keepLocal,
              icon: _working
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.upload_rounded),
              label: const Text('أعد إرسال نسختي (مفتاح جديد)'),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.error,
              ),
              onPressed: _working ? null : _keepServer,
              icon: const Icon(Icons.cloud_done_outlined),
              label: const Text('اعتمد بيانات الخادم (حذف نسختك)'),
            ),
          ),
          if (entry.isFinancial)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                'عملية مالية — التأكد من عدم التكرار مسؤوليتك قبل القرار.',
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 11,
                  color: AppColors.error,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
