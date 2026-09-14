import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../features/hr/worker_report/presentation/widgets/worker_report_page_widget.dart';
import 'factory_settings_cache.dart';
import '../utils/file_name_sanitizer.dart';

/// SELIM-ERP W5 — تصدير تقرير العامل إلى PDF بنفس نهج كشف الحساب W3:
/// صفحات A4 تُصيَّر كـ Widget عبر RepaintBoundary (تشكيل عربي من محرك
/// Flutter نفسه) ثم تُركَّب في PDF — بلا أي تبعية خارجية.
class WorkerReportPdfService {
  WorkerReportPdfService._();

  static final WorkerReportPdfService instance = WorkerReportPdfService._();

  /// يبني ويشارك PDF تقرير العامل (يفتح ورقة المشاركة/الحفظ).
  ///
  /// يرجع مسار الملف المؤقت عند النجاح (null عند الفشل/الإلغاء).
  Future<String?> shareWorkerReportPdf({
    required BuildContext context,
    required Map<String, dynamic> report,
    required DateTime from,
    required DateTime to,
  }) async {
    // نلتقط الـ Overlay أولًا — قبل أي await — استعمال لاحق آمن.
    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) return null;

    final settings = await FactorySettingsCache.instance.load();
    final worker = (report['worker'] as Map?)?.cast<String, dynamic>() ?? {};
    final summary =
        (report['summary'] as Map?)?.cast<String, dynamic>() ?? {};
    final workerName = worker['name']?.toString() ?? 'عامل';
    final workerCode = worker['code']?.toString() ?? '—';

    final movements = _flattenMovements(report);
    final pages = WorkerReportPageWidget.chunkRows(movements);
    final totalPages = pages.length;

    final document = pw.Document(
      title: 'تقرير عامل $workerName',
      author: settings.factoryName,
    );

    for (var index = 0; index < pages.length; index++) {
      final bytes = await _capturePage(
        overlay,
        WorkerReportPageWidget(
          workerName: workerName,
          workerCode: workerCode,
          factoryName: settings.factoryName,
          periodLabel:
              '${_iso(from)} — ${_iso(to)}',
          summary: summary,
          rows: pages[index],
          pageNumber: index + 1,
          totalPages: totalPages,
        ),
      );
      if (bytes == null) return null;
      document.addPage(
        pw.Page(
          pageFormat: PdfPageFormat.a4,
          margin: pw.EdgeInsets.zero,
          build: (pageContext) => pw.Center(
            child: pw.Image(
              pw.MemoryImage(bytes),
              fit: pw.BoxFit.contain,
            ),
          ),
        ),
      );
    }

    final pdfBytes = await document.save();
    final file = await File(
      '${Directory.systemTemp.path}/${sanitizeFileName(
        'worker',
      )}_report_${workerCode}_${_iso(from)}_${_iso(to)}.pdf',
    ).writeAsBytes(pdfBytes);
    await Printing.sharePdf(
      bytes: pdfBytes,
      filename: file.path.split('/').last,
    );
    return file.path;
  }

  static String _iso(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';

  /// دمج حركات التقرير في جدول واحد مرتب تنازليًا (أحدث أولًا) —
  /// السلف/السندات/الرواتب مبلغًا، والإنتاج قطعًا وقيمة بالأجر بالقطعة.
  static List<Map<String, dynamic>> _flattenMovements(
    Map<String, dynamic> report,
  ) {
    final rows = <Map<String, dynamic>>[];
    void addAll(String key, String label, String amountKey) {
      final list = report[key];
      if (list is! List) return;
      for (final item in list) {
        if (item is! Map) continue;
        rows.add(<String, dynamic>{
          'date': item['date'] ?? item['periodEnd'],
          'label': label,
          'pieces': 0,
          'amount': item[amountKey] ?? 0,
          'note': item['notes'] ?? '',
          '_d': DateTime.tryParse(
                '${item['date'] ?? item['periodEnd'] ?? ''}',
              )?.millisecondsSinceEpoch ??
              0,
        });
      }
    }

    addAll('advances', 'سلفة عامل', 'amount');
    addAll('receipts', 'سند قبض عامل', 'amount');
    addAll('payrolls', 'كشف رواتب', 'netAmount');
    // الإنتاج: القطع والمبلغ = قيمتها بالأجر بالقطعة (من بيانات العامل).
    final productions = report['productions'];
    final pieceRate =
        num.tryParse('${(report['worker'] as Map?)?['pieceRate']}') ?? 0;
    if (productions is List) {
      for (final item in productions) {
        if (item is! Map) continue;
        final pieces = num.tryParse('${item['piecesCount']}') ?? 0;
        rows.add(<String, dynamic>{
          'date': item['date'],
          'label': 'إنتاج يومي',
          'pieces': pieces,
          'amount': (pieces * pieceRate).toStringAsFixed(2),
          'note': '',
          '_d': DateTime.tryParse('${item['date'] ?? ''}')
                  ?.millisecondsSinceEpoch ??
              0,
        });
      }
    }
    rows.sort((a, b) => (b['_d'] as num).compareTo(a['_d'] as num));
    for (final row in rows) {
      row.remove('_d');
    }
    return rows;
  }

  /// يصيّر Widget صفحة واحدة إلى بايتات PNG (تركيب offscreen عبر Overlay).
  Future<Uint8List?> _capturePage(
    OverlayState overlay,
    Widget page,
  ) async {
    final boundaryKey = GlobalKey();
    OverlayEntry? entry;
    try {
      entry = OverlayEntry(
        builder: (_) => Positioned(
          // خارج الشاشة: يُبنى ويُخطَّط دون أن يراه المستخدم.
          left: -10000,
          top: 0,
          child: RepaintBoundary(
            key: boundaryKey,
            child: Material(child: page),
          ),
        ),
      );
      overlay.insert(entry);
      // انتظر إطارين: تثبيت التخطيط + اكتمال الصور/الخطوط.
      await _pumpFrames(2);
      final boundaryObject = boundaryKey.currentContext?.findRenderObject();
      if (boundaryObject is! RenderRepaintBoundary) return null;
      final image = await boundaryObject.toImage(pixelRatio: 2.0);
      final byteData = await image.toByteData(
        format: ui.ImageByteFormat.png,
      );
      return byteData?.buffer.asUint8List();
    } catch (_) {
      return null;
    } finally {
      entry?.remove();
    }
  }

  /// ينتظر عدد إطارات جدولة فعلية (يبني ويعرض خارج شاشة مرئية).
  Future<void> _pumpFrames(int count) async {
    for (var i = 0; i < count; i++) {
      await SchedulerBinding.instance.endOfFrame;
    }
  }
}
