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
              _summaryBar(outbox),
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

  Widget _summaryBar(OutboxService outbox) {
    final total = outbox.pendingCount;
    final failed = outbox.failedCount;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      color: failed > 0
          ? AppColors.error.withOpacity(0.08)
          : AppColors.primary.withOpacity(0.06),
      child: Row(
        children: [
          Icon(
            failed > 0 ? Icons.warning_amber : Icons.schedule,
            color: failed > 0 ? AppColors.error : AppColors.primary,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              failed > 0
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
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      color: failed ? AppColors.error.withOpacity(0.04) : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  failed ? Icons.error_outline : Icons.cloud_queue,
                  color: failed ? AppColors.error : AppColors.primary,
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
                _statusChip(context, failed),
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
            if (failed && entry.lastError != null) ...[
              const SizedBox(height: 6),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.error.withOpacity(0.08),
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

  Widget _statusChip(BuildContext context, bool failed) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(
          color: failed ? AppColors.error : AppColors.warning,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          failed ? 'فاشلة' : 'معلّقة',
          style: const TextStyle(
            fontFamily: 'Cairo',
            fontSize: 10,
            color: Colors.white,
          ),
        ),
      );

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
