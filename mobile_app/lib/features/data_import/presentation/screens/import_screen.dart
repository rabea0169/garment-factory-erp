import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/import_cubit.dart';

/// شاشة معالج الاستيراد (SELIM-ERP W2) — معالج بأربع خطوات:
/// (أ) اختيار الكيان من بطاقات ملونة، (ب) اختيار ملف CSV/XLSX عبر
/// file_picker، (ج) رفع المعاينة وعرضها بجدول يميز الصالح/الفاسد،
/// (هـ) الالتزام باستيراد الصفوف الصالحة فقط وعرض ملخص النتيجة.
class ImportScreen extends StatefulWidget {
  const ImportScreen({this.cubit, super.key});

  /// يُحقن في الاختبارات؛ الافتراضي cubit جديد يبدأ بجلب الكيانات.
  final ImportCubit? cubit;

  @override
  State<ImportScreen> createState() => _ImportScreenState();
}

class _ImportScreenState extends State<ImportScreen> {
  /// حالة الواجهة المحلية: الكيان المختار والملف المختار (خطوتا أ وب).
  ImportEntity? _selectedEntity;
  String? _fileName;
  String? _filePath;

  /// الصفوف الموسّعة لعرض أخطائها في جدول المعاينة.
  final Set<int> _expandedRows = <int>{};

  /// لوحة ألوان بطاقات الكيانات (تدور بالتناوب).
  static const List<Color> _entityPalette = [
    Color(0xFF1565C0),
    Color(0xFF00838F),
    Color(0xFF2E7D32),
    Color(0xFFF57F17),
    Color(0xFF6A1B9A),
    Color(0xFFAD1457),
    Color(0xFF37474F),
    Color(0xFF5E35B1),
  ];

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => widget.cubit ?? (ImportCubit()..loadEntities()),
      child: BlocBuilder<ImportCubit, ImportState>(
        builder: (context, state) => SelimShellScaffold(
          title: 'معالج الاستيراد',
          body: _body(context, state),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, ImportState state) {
    if (state is ImportInitial || state is ImportLoading) {
      return const AppLoadingView(message: 'جاري تحميل كيانات الاستيراد...');
    }
    if (state is ImportError) {
      return AppErrorView(
        message: state.message,
        onRetry: () {
          setState(() {
            _selectedEntity = null;
            _fileName = null;
            _filePath = null;
          });
          context.read<ImportCubit>().loadEntities();
        },
      );
    }
    if (state is ImportEntitiesLoaded) {
      // الخطوة أ قبل الاختيار، والخطوة ب بعده.
      return _selectedEntity == null
          ? _entitiesStep(context, state)
          : _fileStep(context);
    }
    if (state is ImportPreviewReady) {
      return _previewStep(context, state);
    }
    if (state is ImportCommitting) {
      return const AppLoadingView(message: 'جاري تنفيذ الاستيراد...');
    }
    if (state is ImportDone) {
      return _doneStep(context, state);
    }
    return const SizedBox.shrink();
  }

  // ---------------------------------------------------------------- خطوات

  /// رأس الخطوات الأربع مع تفعيل الخطوة الحالية.
  Widget _stepsHeader(int active) {
    const labels = ['اختيار الكيان', 'اختيار الملف', 'المعاينة', 'النتيجة'];
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 12, 16, 4),
      child: Row(
        children: [
          for (var i = 0; i < labels.length; i++) ...[
            Expanded(
              child: _StepChip(
                index: i + 1,
                label: labels[i],
                active: i == active,
                done: i < active,
              ),
            ),
            if (i != labels.length - 1)
              const Icon(Icons.chevron_left_rounded,
                  size: 18, color: AppColors.textHint),
          ],
        ],
      ),
    );
  }

  /// الخطوة (أ): بطاقات الكيانات الملونة من GET /import/entities.
  Widget _entitiesStep(BuildContext context, ImportEntitiesLoaded state) {
    return ListView(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 8, 16, 24),
      children: [
        _stepsHeader(0),
        const SizedBox(height: 8),
        Text(
          'اختر نوع البيانات التي تريد استيرادها من ملف CSV أو Excel:',
          style: const TextStyle(
            fontFamily: 'Cairo',
            color: AppColors.textSecondary,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: 12),
        if (state.entities.isEmpty)
          const AppEmptyView(title: 'لا توجد كيانات متاحة للاستيراد')
        else
          ...state.entities.asMap().entries.map(
                (entry) => _entityCard(context, entry.value, entry.key),
              ),
      ],
    );
  }

  Widget _entityCard(BuildContext context, ImportEntity entity, int index) {
    final color = _entityPalette[index % _entityPalette.length];
    return Card(
      margin: const EdgeInsetsDirectional.only(bottom: 10),
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () {
          context.read<ImportCubit>().selectEntity(entity);
          setState(() => _selectedEntity = entity);
        },
        child: Padding(
          padding: const EdgeInsetsDirectional.symmetric(
              horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.table_view_rounded, color: color, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      entity.title,
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${count(entity.columns.length)} عمودًا · '
                      '${entity.requiredColumnsCount} إلزاميًا'
                      '${entity.uniqueKeys.isEmpty ? '' : ' · مفتاح فريد: ${entity.uniqueKeys.join('، ')}'}',
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 11,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_left_rounded,
                  color: AppColors.textHint),
            ],
          ),
        ),
      ),
    );
  }

  /// الخطوة (ب): اختيار ملف CSV/XLSX عبر file_picker.
  Widget _fileStep(BuildContext context) {
    final entity = _selectedEntity!;
    return ListView(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 8, 16, 24),
      children: [
        _stepsHeader(1),
        const SizedBox(height: 8),
        // ملخص الكيان المختار مع إمكانية تغييره.
        Card(
          margin: const EdgeInsetsDirectional.only(bottom: 12),
          child: ListTile(
            leading: const Icon(Icons.table_view_rounded,
                color: AppColors.primary),
            title: Text(entity.title,
                style: const TextStyle(
                    fontFamily: 'Cairo', fontWeight: FontWeight.w700)),
            subtitle: Text(
              'قالب الأعمدة: ${entity.columns.map((c) => c.header).join('، ')}',
              style: const TextStyle(
                  fontFamily: 'Cairo', fontSize: 11, color: AppColors.textSecondary),
            ),
            isThreeLine: true,
            trailing: TextButton(
              onPressed: () => setState(() {
                _selectedEntity = null;
                _fileName = null;
                _filePath = null;
              }),
              child: const Text('تغيير'),
            ),
          ),
        ),
        // بطاقة اختيار الملف.
        DashedFilePicker(
          fileName: _fileName,
          onPick: _pickImportFile,
        ),
        const SizedBox(height: 16),
        AppAsyncButton(
          label: 'رفع الملف ومعاينة البيانات',
          icon: Icons.cloud_upload_rounded,
          onPressed: (_filePath == null)
              ? null
              : () => context
                  .read<ImportCubit>()
                  .previewFile(filePath: _filePath!, fileName: _fileName!),
        ),
      ],
    );
  }

  Future<void> _pickImportFile() async {
    // file_picker 12.x: pickFiles ثابتة تُرجع List<PlatformFile> مباشرة.
    final files = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['csv', 'xlsx'],
    );
    if (files.isEmpty || files.first.path == null) return;
    if (!mounted) return;
    setState(() {
      _filePath = files.first.path;
      _fileName = files.first.name;
    });
  }

  /// الخطوتان (ج/د): جدول المعاينة + زر الاستيراد.
  Widget _previewStep(BuildContext context, ImportPreviewReady state) {
    return Column(
      children: [
        _stepsHeader(2),
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(16, 8, 16, 0),
          child: _previewStats(state),
        ),
        if (state.missingRequiredColumns.isNotEmpty)
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(16, 10, 16, 0),
            child: _missingColumnsWarning(state),
          ),
        if (state.unmappedHeaders.isNotEmpty)
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(16, 10, 16, 0),
            child: _unmappedHeadersInfo(state),
          ),
        Expanded(child: _previewTable(state)),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(16, 8, 16, 12),
            child: AppAsyncButton(
              label: 'استيراد الصفوف الصالحة (${count(state.validCount)})',
              icon: Icons.check_circle_rounded,
              onPressed: state.canImport
                  ? () => context.read<ImportCubit>().commitValidRows()
                  : null,
            ),
          ),
        ),
      ],
    );
  }

  /// شريط إحصائيات المعاينة: صالحة / فاسدة / إجمالي.
  Widget _previewStats(ImportPreviewReady state) {
    return Card(
      margin: const EdgeInsetsDirectional.only(bottom: 0),
      child: Padding(
        padding: const EdgeInsetsDirectional.symmetric(
            horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: _statPill(
                'صفوف صالحة',
                count(state.validCount),
                Icons.check_circle_rounded,
                AppColors.success,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _statPill(
                'صفوف فاسدة',
                count(state.invalidCount),
                Icons.error_rounded,
                AppColors.error,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _statPill(
                'إجمالي الصفوف',
                count(state.rows.length),
                Icons.receipt_long_rounded,
                AppColors.info,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statPill(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsetsDirectional.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 2),
          Text(value,
              style: TextStyle(
                  fontFamily: 'Cairo',
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                  color: color)),
          Text(label,
              style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 10,
                  color: AppColors.textSecondary)),
        ],
      ),
    );
  }

  /// تحذير جسيم أحمر: أعمدة إلزامية مفقودة — يمنع الاستيراد كليًا.
  Widget _missingColumnsWarning(ImportPreviewReady state) {
    return Container(
      padding: const EdgeInsetsDirectional.all(12),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.08),
        border: Border.all(color: AppColors.error.withValues(alpha: 0.5)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.block_rounded, color: AppColors.error),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'أعمدة إلزامية مفقودة — لا يمكن الاستيراد',
                  style: TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                      color: AppColors.error,
                      fontSize: 13),
                ),
                const SizedBox(height: 4),
                Text(
                  'الملف "${state.fileName}" لا يحتوي الأعمدة: '
                  '${state.missingRequiredColumns.join('، ')}. '
                  'أضفها وأعد المحاولة.',
                  style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 12,
                      color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// معلومة كهرمانية: أعمدة غير معروفة ستُهمل.
  Widget _unmappedHeadersInfo(ImportPreviewReady state) {
    return Container(
      padding: const EdgeInsetsDirectional.all(12),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.08),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_rounded, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'أعمدة في الملف خارج قالب الكيان وستُهمل: '
              '${state.unmappedHeaders.join('، ')}',
              style: const TextStyle(
                  fontFamily: 'Cairo', fontSize: 12, color: AppColors.textSecondary),
            ),
          ),
        ],
      ),
    );
  }

  /// جدول المعاينة: ListView عمودي داخل تمرير أفقي — الصفوف الصالحة
  /// خضراء والفاسدة حمراء مع شارة عدد أخطاء كل صف، والنقر يوسّع الأخطاء.
  Widget _previewTable(ImportPreviewReady state) {
    const cellWidth = 116.0;
    const numberWidth = 52.0;
    const badgeWidth = 86.0;
    final tableWidth =
        numberWidth + state.headers.length * cellWidth + badgeWidth;
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 10, 16, 0),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: tableWidth,
          child: Column(
            children: [
              _tableHeaderRow(state.headers,
                  cellWidth: cellWidth,
                  numberWidth: numberWidth,
                  badgeWidth: badgeWidth),
              const SizedBox(height: 2),
              Expanded(
                child: state.rows.isEmpty
                    ? const AppEmptyView(title: 'لا صفوف في الملف')
                    : ListView.builder(
                        itemCount: state.rows.length,
                        itemBuilder: (context, index) =>
                            _tableRow(state.rows[index], state.headers,
                                cellWidth: cellWidth,
                                numberWidth: numberWidth,
                                badgeWidth: badgeWidth),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tableHeaderRow(
    List<String> headers, {
    required double cellWidth,
    required double numberWidth,
    required double badgeWidth,
  }) {
    return Container(
      height: 38,
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          SizedBox(
            width: numberWidth,
            child: const Center(
              child: Text('#',
                  style: TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                      fontSize: 12)),
            ),
          ),
          ...headers.map(
            (header) => SizedBox(
              width: cellWidth,
              child: Padding(
                padding: const EdgeInsetsDirectional.symmetric(horizontal: 6),
                child: Text(
                  header,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                      color: AppColors.primaryDark),
                ),
              ),
            ),
          ),
          SizedBox(width: badgeWidth),
        ],
      ),
    );
  }

  Widget _tableRow(
    ImportPreviewRow row,
    List<String> headers, {
    required double cellWidth,
    required double numberWidth,
    required double badgeWidth,
  }) {
    final expanded = _expandedRows.contains(row.row);
    final background =
        row.valid ? AppColors.success.withValues(alpha: 0.07) : AppColors.error.withValues(alpha: 0.08);
    return Column(
      children: [
        InkWell(
          onTap: row.errors.isEmpty
              ? null
              : () => setState(() {
                    if (expanded) {
                      _expandedRows.remove(row.row);
                    } else {
                      _expandedRows.add(row.row);
                    }
                  }),
          child: Container(
            height: 44,
            margin: const EdgeInsetsDirectional.only(bottom: 2),
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                SizedBox(
                  width: numberWidth,
                  child: Center(
                    child: Text(
                      '${row.row}',
                      style: const TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 12,
                          color: AppColors.textSecondary),
                    ),
                  ),
                ),
                ...headers.map(
                  (header) => SizedBox(
                    width: cellWidth,
                    child: Padding(
                      padding:
                          const EdgeInsetsDirectional.symmetric(horizontal: 6),
                      child: Text(
                        row.data[header]?.toString() ?? '',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontFamily: 'Cairo', fontSize: 12),
                      ),
                    ),
                  ),
                ),
                SizedBox(
                  width: badgeWidth,
                  child: Center(
                    child: row.valid
                        ? const Icon(Icons.check_circle_rounded,
                            color: AppColors.success, size: 20)
                        : _errorsBadge(row.errors.length),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (expanded && row.errors.isNotEmpty)
          Container(
            width: double.infinity,
            margin: const EdgeInsetsDirectional.only(bottom: 6),
            padding: const EdgeInsetsDirectional.all(10),
            decoration: BoxDecoration(
              color: AppColors.error.withValues(alpha: 0.05),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final error in row.errors)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(bottom: 2),
                    child: Text(
                      'الصف ${error.row} · ${error.field.isEmpty ? 'عام' : error.field}: ${error.message}',
                      style: const TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 11,
                          color: AppColors.error),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  /// شارة عدد أخطاء الصف الفاسد (حمراء).
  Widget _errorsBadge(int count) {
    return Container(
      padding: const EdgeInsetsDirectional.symmetric(
          horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.error,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        '$count ${count == 1 ? 'خطأ' : 'أخطاء'}',
        style: const TextStyle(
            fontFamily: 'Cairo',
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: Colors.white),
      ),
    );
  }

  /// الخطوة الأخيرة: ملخص نتيجة الاستيراد.
  Widget _doneStep(BuildContext context, ImportDone state) {
    final summary = state.summary;
    return ListView(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 8, 16, 24),
      children: [
        _stepsHeader(3),
        const SizedBox(height: 12),
        Card(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          child: Padding(
            padding: const EdgeInsetsDirectional.all(16),
            child: Column(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.task_alt_rounded,
                      color: AppColors.success, size: 36),
                ),
                const SizedBox(height: 10),
                const Text(
                  'اكتمل الاستيراد',
                  style: TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                      fontSize: 18),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                        child: _statPill('أُنشئت',
                            count(summary.created), Icons.add_circle_rounded, AppColors.success)),
                    const SizedBox(width: 8),
                    Expanded(
                        child: _statPill('تخطيت (مكررة)',
                            count(summary.skipped), Icons.skip_next_rounded, AppColors.warning)),
                    const SizedBox(width: 8),
                    Expanded(
                        child: _statPill('أُرسلت',
                            count(summary.total), Icons.outbox_rounded, AppColors.info)),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (summary.results.isNotEmpty) ...[
          const Text(
            'تفاصيل الصفوف:',
            style: TextStyle(
                fontFamily: 'Cairo', fontWeight: FontWeight.w700, fontSize: 13),
          ),
          const SizedBox(height: 6),
          ...summary.results.map(_resultRow),
        ],
        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: () {
            setState(() {
              _selectedEntity = null;
              _fileName = null;
              _filePath = null;
              _expandedRows.clear();
            });
            final cubit = context.read<ImportCubit>();
            cubit.reset();
            cubit.loadEntities();
          },
          icon: const Icon(Icons.replay_rounded),
          label: const Text('استيراد ملف جديد',
              style: TextStyle(fontFamily: 'Cairo')),
        ),
      ],
    );
  }

  Widget _resultRow(Map<String, dynamic> result) {
    final status = result['status']?.toString() ?? '';
    final (label, color) = switch (status) {
      'CREATED' => ('أُنشئ', AppColors.success),
      'SKIPPED' => ('مُتخطى (موجود)', AppColors.warning),
      _ => ('خطأ', AppColors.error),
    };
    final code = result['code']?.toString();
    final errors = (result['errors'] as List?) ?? const [];
    return Card(
      margin: const EdgeInsetsDirectional.only(bottom: 6),
      child: ListTile(
        dense: true,
        leading: Icon(
          status == 'CREATED'
              ? Icons.check_circle_rounded
              : status == 'SKIPPED'
                  ? Icons.skip_next_rounded
                  : Icons.error_rounded,
          color: color,
        ),
        title: Text('الصف ${result['row'] ?? '—'} · $label',
            style: const TextStyle(fontFamily: 'Cairo', fontSize: 13)),
        subtitle: code != null && code.isNotEmpty
            ? Text(code,
                style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 11,
                    color: AppColors.textSecondary))
            : (errors.isEmpty
                ? null
                : Text('أخطاء: ${errors.length}',
                    style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 11,
                        color: AppColors.error))),
        trailing: code != null && code.isNotEmpty
            ? Chip(
                label: Text(code,
                    style: const TextStyle(fontFamily: 'Cairo', fontSize: 10)),
                visualDensity: VisualDensity.compact,
              )
            : null,
      ),
    );
  }
}

/// شارة خطوة واحدة في رأس المعالج (رقم + تسمية).
class _StepChip extends StatelessWidget {
  const _StepChip({
    required this.index,
    required this.label,
    required this.active,
    required this.done,
  });

  final int index;
  final String label;
  final bool active;
  final bool done;

  @override
  Widget build(BuildContext context) {
    final color = done
        ? AppColors.success
        : active
            ? AppColors.primary
            : AppColors.textHint;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child: Center(
            child: done
                ? const Icon(Icons.check_rounded, size: 14, color: Colors.white)
                : Text(
                    '$index',
                    style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: Colors.white),
                  ),
          ),
        ),
        const SizedBox(width: 5),
        Expanded(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 10,
                fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                color: color),
          ),
        ),
      ],
    );
  }
}

/// بطاقة اختيار الملف (إطار متقطع + اسم الملف المختار وحجمه).
class DashedFilePicker extends StatelessWidget {
  const DashedFilePicker({required this.fileName, required this.onPick, super.key});

  /// اسم الملف المختار — null يعني لا ملف بعد.
  final String? fileName;

  final VoidCallback onPick;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onPick,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsetsDirectional.all(20),
        decoration: BoxDecoration(
          color: AppColors.inputFill,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: fileName == null
                ? AppColors.divider
                : AppColors.primary.withValues(alpha: 0.6),
            width: 1.4,
          ),
        ),
        child: Column(
          children: [
            Icon(
              fileName == null
                  ? Icons.upload_file_rounded
                  : Icons.description_rounded,
              size: 40,
              color: fileName == null ? AppColors.textHint : AppColors.primary,
            ),
            const SizedBox(height: 8),
            Text(
              fileName ?? 'اضغط لاختيار ملف CSV أو Excel',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: 'Cairo',
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: fileName == null
                    ? AppColors.textSecondary
                    : AppColors.primaryDark,
              ),
            ),
            if (fileName != null) ...[
              const SizedBox(height: 2),
              const Text(
                'اضغط للتغيير — يدعم .csv و .xlsx فقط',
                style: TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 10,
                    color: AppColors.textSecondary),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
