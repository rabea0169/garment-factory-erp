import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../../features/financial_reports/presentation/cubit/party_statement_cubit.dart';
import '../../../features/financial_reports/presentation/widgets/statement_page_widget.dart';
import 'factory_settings_cache.dart';
import 'file_name_sanitizer.dart';

/// SELIM-ERP W3 — تصدير كشف الحساب إلى PDF بمحرك Flutter نفسه.
///
/// **النهج** (نفس فلسفة المرجع في ضمان العربية): المرجع يصيّر HTML عبر
/// Chromium حقيقي على الخادم لأن html2canvas يكسر تشكيل العربية؛ نحن
/// نصيّر الـ Widget بصفحات A4 عبر RepaintBoundary ثم نضع كل صورة في
/// صفحة PDF — العربية مضمونة 100% (محرك نصوص Flutter هو المُشكِّل)
/// وبلا أي تبعية خادم ثقيلة.
class StatementPdfService {
  StatementPdfService._();

  static final StatementPdfService instance = StatementPdfService._();

  /// يبني ويشارك PDF الكشف (يفتح ورقة المشاركة/الحفظ).
  ///
  /// يرجع مسار الملف المؤقت عند النجاح (null عند الفشل/الإلغاء).
  Future<String?> shareStatementPdf({
    required BuildContext context,
    required PartyStatement statement,
  }) async {
    final settings = await FactorySettingsCache.instance.load();
    final pages = chunkStatementRows(statement.movements);
    final totalPages = pages.length;

    // نلتقط الـ Overlay مرة واحدة قبل أي await — استعمال لاحق آمن.
    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) return null;

    final document = pw.Document(
      title: 'كشف حساب ${statement.name}',
      author: settings.factoryName,
    );

    for (var index = 0; index < pages.length; index++) {
      final bytes = await _capturePage(
        overlay,
        StatementPageWidget(
          statement: statement,
          rows: pages[index],
          pageNumber: index + 1,
          totalPages: totalPages,
          factoryName: settings.factoryName,
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
        statement.isCustomer ? 'customer' : 'supplier',
      )}_statement_${statement.code}.pdf',
    ).writeAsBytes(pdfBytes);
    await Printing.sharePdf(
      bytes: pdfBytes,
      filename: file.path.split('/').last,
    );
    return file.path;
  }

  /// يصيّر Widget صفحة واحدة إلى بايتات PNG (تركيب offscreen عبر Overlay).
  ///
  /// نحوّل الصورة إلى PNG bytes ونمررها لـ pw.MemoryImage — توافق مباشر
  /// مع حزمة pdf بلا تعارض أنواع Image (dart:ui مقابل حزمة image).
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
