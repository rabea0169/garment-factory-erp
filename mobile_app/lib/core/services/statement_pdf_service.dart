import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../../features/financial_reports/presentation/cubit/party_statement_cubit.dart';
import '../../../features/financial_reports/presentation/widgets/statement_page_widget.dart';
import '../services/factory_settings_cache.dart';
import '../utils/file_name_sanitizer.dart';

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

    final document = pw.Document(
      title: statement.isCustomer
          ? 'كشف حساب ${statement.name}'
          : 'كشف حساب ${statement.name}',
      author: settings.factoryName,
    );

    for (var index = 0; index < pages.length; index++) {
      final image = await _capturePage(
        context,
        StatementPageWidget(
          statement: statement,
          rows: pages[index],
          pageNumber: index + 1,
          totalPages: totalPages,
          factoryName: settings.factoryName,
        ),
      );
      if (image == null) return null;
      document.addPage(
        pw.Page(
          pageFormat: PdfPageFormat.a4,
          margin: pw.EdgeInsets.zero,
          build: (pageContext) => pw.Center(
            child: pw.Image(
              pw.ImageImage(image),
              fit: pw.BoxFit.contain,
            ),
          ),
        ),
      );
    }

    final bytes = await document.save();
    final file = await File(
      '${Directory.systemTemp.path}/${sanitizeFileName(
        statement.isCustomer ? 'customer' : 'supplier',
      )}_statement_${statement.code}.pdf',
    ).writeAsBytes(bytes);
    await Printing.sharePdf(bytes: bytes, filename: file.path.split('/').last);
    return file.path;
  }

  /// يصيّر Widget صفحة واحدة إلى ui.Image (تركيب offscreen عبر Overlay).
  Future<ui.Image?> _capturePage(BuildContext context, Widget page) async {
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
      final overlay = Overlay.maybeOf(context, rootOverlay: true);
      if (overlay == null) return null;
      overlay.insert(entry);
      // انتظر إطارين: تثبيت التخطيط + اكتمال الصور/الخطوط.
      await _pumpFrames(2);
      final boundaryObject = boundaryKey.currentContext?.findRenderObject();
      if (boundaryObject is! RenderRepaintBoundary) return null;
      return boundaryObject.toImage(pixelRatio: 2.0);
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
