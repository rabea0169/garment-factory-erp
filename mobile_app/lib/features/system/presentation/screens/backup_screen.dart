import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/backup_cubit.dart';

/// عبارة التأكيد الحرفية (RTL) التي يجب كتابتها لتفعيل زر الاستعادة.
const String kRestoreConfirmPhrase = 'استعادة';

/// هل النص المطابق لعبارة تأكيد الاستعادة (تقليم الفراغات فقط)؟
bool isValidRestorePhrase(String input) =>
    input.trim() == kRestoreConfirmPhrase;

/// شرط تفعيل زر الاستعادة: ملف نسخة محدد + عبارة «استعادة» حرفيًا.
bool canRunRestore({required String? filePath, required String phrase}) =>
    filePath != null && filePath.isNotEmpty && isValidRestorePhrase(phrase);

/// شاشة النسخ الاحتياطي والاستعادة (SELIM-ERP W2) — SUPER_ADMIN فقط
/// (الحماية خادمية عبر /system/* — لا فحص دور محلي هنا).
///
/// 1. بطاقة إحصائيات من GET /system/backup/summary (جداول/صفوف + آخر نسخة).
/// 2. زر إنشاء نسخة احتياطية وتنزيلها (GET /system/backup) — يعرض المسار
///    وحجم الملف بعد الحفظ.
/// 3. قسم الاستعادة بتحذير أحمر جسيم: اختيار ملف JSON + كتابة كلمة
///    «استعادة» حرفيًا + تأكيد نهائي في AlertDialog قبل الاستبدال.
class BackupScreen extends StatefulWidget {
  const BackupScreen({this.cubit, super.key});

  /// يُحقن في الاختبارات؛ الافتراضي cubit جديد يبدأ بجلب الملخص.
  final BackupCubit? cubit;

  @override
  State<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends State<BackupScreen> {
  final _phraseController = TextEditingController();

  /// ملف النسخة المختار للاستعادة (خطوة التمكين).
  String? _restoreFilePath;
  String? _restoreFileName;

  @override
  void dispose() {
    _phraseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => widget.cubit ?? (BackupCubit()..loadSummary()),
      child: BlocBuilder<BackupCubit, BackupState>(
        builder: (context, state) => SelimShellScaffold(
          title: 'النسخ الاحتياطي والاستعادة',
          body: _body(context, state),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, BackupState state) {
    if (state is BackupInitial || state is BackupSummaryLoading) {
      return const AppLoadingView(message: 'جاري تحميل ملخص البيانات...');
    }
    if (state is BackupError && state.summary == null) {
      return AppErrorView(
        message: state.message,
        onRetry: () => context.read<BackupCubit>().loadSummary(),
      );
    }
    if (state is BackupError) {
      // خطأ عملية (إنشاء/استعادة) بعد نجاح الملخص — الملخص يبقى معروضًا.
      return _mainView(context, state, state.summary);
    }
    if (state is BackupSummaryLoaded) {
      return _mainView(context, state, state.summary);
    }
    if (state is BackupCreating) {
      return _mainView(context, state, state.summary);
    }
    if (state is BackupCreated) {
      return _mainView(context, state, state.summary);
    }
    if (state is BackupRestoring) {
      return _mainView(context, state, state.summary);
    }
    if (state is BackupRestored) {
      return _mainView(context, state, state.summary);
    }
    return const SizedBox.shrink();
  }

  Widget _mainView(BuildContext context, BackupState state,
      BackupSummary? summary) {
    return ListView(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 24),
      children: [
        if (summary != null) ...[
          _statsCard(context, state, summary),
          const SizedBox(height: 16),
        ],
        _backupSection(context, state),
        const SizedBox(height: 16),
        _restoreSection(context, state),
      ],
    );
  }

  // ------------------------------------------------------- بطاقة الإحصائيات

  /// بطاقة إحصائيات قاعدة البيانات: عدد الجداول / إجمالي الصفوف.
  Widget _statsCard(
      BuildContext context, BackupState state, BackupSummary summary) {
    DateTime? lastBackupAt;
    if (state is BackupSummaryLoaded) lastBackupAt = state.lastBackupAt;
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: _statTile(
                    icon: Icons.table_chart_rounded,
                    value: count(summary.tables),
                    label: 'جدولًا في قاعدة البيانات',
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _statTile(
                    icon: Icons.storage_rounded,
                    value: count(summary.totalRows),
                    label: 'إجمالي الصفوف',
                    color: AppColors.info,
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            Row(
              children: [
                const Icon(Icons.history_rounded,
                    size: 18, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    lastBackupAt == null
                        ? 'آخر نسخة احتياطية: لم تُنشأ نسخة بعد'
                        : 'آخر نسخة احتياطية: ${dateTime(lastBackupAt)}',
                    style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 12,
                        color: AppColors.textSecondary),
                  ),
                ),
                Text(
                  'إصدار التنسيق v${summary.formatVersion}',
                  style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 11,
                      color: AppColors.textHint),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _statTile({
    required IconData icon,
    required String value,
    required String label,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 26),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
                fontFamily: 'Cairo',
                fontWeight: FontWeight.w700,
                fontSize: 20,
                color: color),
          ),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontFamily: 'Cairo',
                fontSize: 11,
                color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------ قسم الإنشاء

  Widget _backupSection(BuildContext context, BackupState state) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.backup_rounded, color: AppColors.primary),
                SizedBox(width: 8),
                Text('إنشاء نسخة احتياطية',
                    style: TextStyle(
                        fontFamily: 'Cairo',
                        fontWeight: FontWeight.w700,
                        fontSize: 15)),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'تنزيل نسخة كاملة من بيانات النظام (JSON) وحفظها في مستندات '
              'الجهاز باسم garment-erp-backup-<التاريخ-الوقت>.json',
              style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 12,
                  color: AppColors.textSecondary),
            ),
            const SizedBox(height: 14),
            AppAsyncButton(
              label: 'إنشاء نسخة احتياطية وتنزيلها',
              icon: Icons.download_rounded,
              isLoading: state is BackupCreating,
              onPressed:
                  state is BackupCreating ? null : _createBackup(context),
            ),
            if (state is BackupCreated) ...[
              const SizedBox(height: 12),
              _createdResultCard(state),
            ],
          ],
        ),
      ),
    );
  }

  VoidCallback _createBackup(BuildContext context) {
    // نلتقط cubit والرسول قبل العملية غير المتزامنة (نمط عروض الأسعار).
    final cubit = context.read<BackupCubit>();
    final messenger = ScaffoldMessenger.of(context);
    return () async {
      await cubit.createBackup();
      if (!mounted) return;
      final ok = cubit.state is BackupCreated;
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              ok ? 'تم إنشاء النسخة الاحتياطية وحفظها' : 'تعذر إنشاء النسخة الاحتياطية',
              style: const TextStyle(fontFamily: 'Cairo'),
            ),
            backgroundColor: ok ? AppColors.success : AppColors.error,
            duration: const Duration(seconds: 3),
          ),
        );
    };
  }

  /// بطاقة نتيجة الإنشاء: المسار + الحجم + التاريخ.
  Widget _createdResultCard(BackupCreated state) {
    return Container(
      padding: const EdgeInsetsDirectional.all(12),
      decoration: BoxDecoration(
        color: AppColors.success.withValues(alpha: 0.07),
        border: Border.all(color: AppColors.success.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.check_circle_rounded, color: AppColors.success, size: 20),
              SizedBox(width: 6),
              Text('تم حفظ النسخة الاحتياطية',
                  style: TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                      color: AppColors.success)),
            ],
          ),
          const SizedBox(height: 6),
          _resultRow('المسار', state.filePath),
          _resultRow('الحجم', _formatBytes(state.sizeBytes)),
          _resultRow('التاريخ', dateTime(state.createdAt)),
        ],
      ),
    );
  }

  Widget _resultRow(String label, String value) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(bottom: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 52,
            child: Text(
              '$label:',
              style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 11,
                  color: AppColors.textSecondary),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                  fontFamily: 'Cairo', fontSize: 11, color: AppColors.textPrimary),
            ),
          ),
        ],
      ),
    );
  }

  /// تحويل الحجم بالبايت إلى نص مقروء (KB / MB).
  String _formatBytes(int bytes) {
    if (bytes >= 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(2)} MB';
    }
    if (bytes >= 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    }
    return '$bytes بايت';
  }

  // ----------------------------------------------------------- قسم الاستعادة

  Widget _restoreSection(BuildContext context, BackupState state) {
    final enabled = canRunRestore(
      filePath: _restoreFilePath,
      phrase: _phraseController.text,
    );
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: AppColors.error.withValues(alpha: 0.4)),
      ),
      child: Padding(
        padding: const EdgeInsetsDirectional.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // التحذير الأحمر الجسيم.
            Container(
              width: double.infinity,
              padding: const EdgeInsetsDirectional.all(14),
              decoration: BoxDecoration(
                color: AppColors.error.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.error, width: 1.4),
              ),
              child: Column(
                children: [
                  const Icon(Icons.warning_rounded,
                      color: AppColors.error, size: 34),
                  const SizedBox(height: 6),
                  const Text(
                    'تحذير جسيم — الاستعادة تستبدل كل البيانات',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        fontFamily: 'Cairo',
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                        color: AppColors.error),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'ستُمحى كل بيانات النظام الحالية وتُستبدل بمحتوى ملف النسخة '
                    'الاحتياطية. هذا الإجراء لا يمكن التراجع عنه — تأكد من أخذ '
                    'نسخة حديثة أولًا.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 12,
                        color: AppColors.error),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            // اختيار ملف النسخة (JSON فقط).
            OutlinedButton.icon(
              onPressed: _pickRestoreFile,
              icon: const Icon(Icons.folder_open_rounded),
              label: Text(
                _restoreFileName ?? 'اختيار ملف النسخة (JSON)',
                style: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
              ),
            ),
            const SizedBox(height: 12),
            // حقل عبارة التأكيد — يفعّل زر التنفيذ فقط عند كتابة «استعادة».
            TextField(
              controller: _phraseController,
              onChanged: (_) => setState(() {}),
              textAlign: TextAlign.right,
              decoration: InputDecoration(
                labelText: 'اكتب كلمة «استعادة» لتأكيد التنفيذ',
                labelStyle: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
                helperText: 'الزر يبقى معطلًا حتى تكتب الكلمة حرفيًا',
                helperStyle: const TextStyle(
                    fontFamily: 'Cairo', fontSize: 10),
                prefixIcon: const Icon(Icons.gpp_bad_rounded),
                filled: true,
                fillColor: AppColors.inputFill,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.error,
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(48),
              ),
              onPressed: (enabled && state is! BackupRestoring)
                  ? () => _confirmRestore(context)
                  : null,
              icon: state is BackupRestoring
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child:
                          CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.restore_rounded),
              label: Text(
                state is BackupRestoring ? 'جاري الاستعادة...' : 'تنفيذ الاستعادة',
                style: const TextStyle(
                    fontFamily: 'Cairo', fontWeight: FontWeight.w700),
              ),
            ),
            if (state is BackupRestored) ...[
              const SizedBox(height: 12),
              _restoredResultCard(state),
            ],
          ],
        ),
      ),
    );
  }

  /// بطاقة نتيجة الاستعادة: أعيدت البيانات من N جدولًا.
  Widget _restoredResultCard(BackupRestored state) {
    final ok = state.restored;
    final color = ok ? AppColors.success : AppColors.error;
    return Container(
      padding: const EdgeInsetsDirectional.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        border: Border.all(color: color.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            ok ? Icons.check_circle_rounded : Icons.error_rounded,
            color: color,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              ok
                  ? 'تمت الاستعادة — ${count(state.tables)} جدولًا و${count(state.totalRows)} صفًا'
                  : 'رفض الخادم الاستعادة — تحقق من الملف والصلاحيات',
              style: TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                  color: color),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _pickRestoreFile() async {
    // file_picker 12.x: pickFiles ثابتة تُرجع List<PlatformFile> مباشرة.
    final files = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['json'],
    );
    if (files.isEmpty || files.first.path == null) return;
    if (!mounted) return;
    setState(() {
      _restoreFilePath = files.first.path;
      _restoreFileName = files.first.name;
    });
  }

  /// تأكيد نهائي قبل الاستبدال — AlertDialog يشرح خطورة العملية.
  Future<void> _confirmRestore(BuildContext context) async {
    final path = _restoreFilePath;
    final name = _restoreFileName;
    if (path == null || name == null) return;
    final cubit = context.read<BackupCubit>();
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('تأكيد الاستعادة النهائي',
            style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700)),
        content: const Text(
          'أنت على وشك استبدال كل بيانات النظام الحالية بمحتوى ملف النسخة '
          'الاحتياطية المختار. لن يمكن التراجع عن هذا الإجراء. هل أنت متأكد؟',
          style: TextStyle(fontFamily: 'Cairo', fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('إلغاء', style: TextStyle(fontFamily: 'Cairo')),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('استبدال البيانات والاستعادة',
                style: TextStyle(fontFamily: 'Cairo')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final ok = await cubit.restore(
      filePath: path,
      fileName: name,
      phrase: kRestoreConfirmPhrase,
    );
    if (!mounted) return;
    final failureMessage = cubit.state is BackupError
        ? (cubit.state as BackupError).message
        : 'سبب غير معروف';
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            ok ? 'تمت الاستعادة بنجاح' : 'فشلت الاستعادة — $failureMessage',
            style: const TextStyle(fontFamily: 'Cairo'),
          ),
          backgroundColor: ok ? AppColors.success : AppColors.error,
          duration: const Duration(seconds: 4),
        ),
      );
  }
}
