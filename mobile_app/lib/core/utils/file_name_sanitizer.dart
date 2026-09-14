/// SELIM-ERP W3 — تنقية أسماء الملفات من رموز نظام الملفات والمسارات.
///
/// يزيل الشرائط والأحرف المحظورة على منصات التطبيق (Android/Windows)
/// ويقصّ الطول — كود المرجع فيه safeReceiptFilename لنفس الغرض.
String sanitizeFileName(String input) {
  final cleaned = input
      .replaceAll(RegExp(r'[\\/:*?"<>|]'), '')
      .replaceAll(RegExp(r'\s+'), '_')
      .trim();
  final safe = cleaned.isEmpty ? 'file' : cleaned;
  return safe.length > 60 ? safe.substring(0, 60) : safe;
}
