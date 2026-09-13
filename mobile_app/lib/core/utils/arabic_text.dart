/// SELIM-ERP W3 — أدوات النص العربي (نقل Dart لمحرك lib/arabic-search.ts
/// في Selim ERP — نفس قواعد التطبيع).
///
/// الغرض: مطابقة عربية متسامحة في ترشيح القوائم على الجهاز (قبل طلب
/// الخادم): «احمد» تطابق «أحمد»، و«٠١٢» تطابق «012»، والتشكيل/التطويل
/// يُتجاهل. البحث الخادم يستخدم المكتبة النظيرة في الباكند
/// (backend/src/common/utils/arabic-search.util.ts) — نفس السلوك.
library;

/// تطبيع كامل: تشكيل + همزات + ى/ة/ؤ + أرقام هندية/فارسية + فراغات.
String normalizeArabicText(String? input) {
  if (input == null) return '';
  var s = input.toLowerCase();
  // تشكيل + شدة + سكون + تطويل (ـ) + سواكن صغيرة.
  s = s.replaceAll(
    RegExp('[\u064B-\u0655\u0670\u0640]'),
    '',
  );
  // أرقام هندية ٠-٩ → 0-9.
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  s = s.replaceAllMapped(
    RegExp('[٠-٩]'),
    (m) => '${arabicDigits.indexOf(m.group(0)!)}',
  );
  // أرقام فارسية ۰-۹ → 0-9.
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  s = s.replaceAllMapped(
    RegExp('[۰-۹]'),
    (m) => '${persianDigits.indexOf(m.group(0)!)}',
  );
  // توحيد الهمزات والنقاط.
  s = s.replaceAll(RegExp('[أإآٱ]'), 'ا');
  s = s.replaceAll(RegExp('[ىئ]'), 'ي');
  s = s.replaceAll('ة', 'ه');
  s = s.replaceAll('ؤ', 'و');
  return s.replaceAll(RegExp(r'\s+'), ' ').trim();
}

/// هل يبدأ النص (بعد التطبيع) بالاستعلام؟
bool startsWithAr(String query, String? text) {
  final q = normalizeArabicText(query);
  if (q.isEmpty) return true;
  return normalizeArabicText(text).startsWith(q);
}

/// بداية النص أو بداية أي كلمة فيه: «احمد» تطابق «محمد احمد» و«محمد-احمد».
///
/// حدود الكلمة = أي رمز ليس حرفًا ولا رقمًا (فراغ، «/»، «-»، قوس…).
bool wordStartsAr(String query, String? text) {
  final q = normalizeArabicText(query);
  if (q.isEmpty) return true;
  final t = normalizeArabicText(text);
  if (t.startsWith(q)) return true;
  final escaped = RegExp.escape(q);
  return RegExp('(^|[^\\p{L}\\p{N}])$escaped', unicode: true).hasMatch(t);
}

/// يحتوي (بعد التطبيع) — للأرقام/الهواتف/الباركود.
bool containsAr(String query, String? text) {
  final q = normalizeArabicText(query);
  if (q.isEmpty) return true;
  return normalizeArabicText(text).contains(q);
}
