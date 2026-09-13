library;

/// أدوات التنسيق العربي الموحدة — نسخة دارت من format.ts في Selim ERP.
///
/// القواعد (مطابقة لسلوك Selim):
/// - أرقام لاتينية (ar-EG-u-nu-latn) مع فواصل الآلاف.
/// - العملة: "1,234.50 ج.م" — لاحقة الجنيه بعد الرقم.
/// - الكميات: بلا فواصل آلاف وحد أقصى 3 منازل عشرية (يُقص الصفر الزائد).
/// - التواريخ ميلادية بالصيغة dd/mm/yyyy.

/// `1,234.50 ج.م` — مبلغ مالي بمنزلتين ولواحق الجنيه المصري.
String money(num value, {String suffix = 'ج.م'}) {
  final fixed = value.toStringAsFixed(2);
  final parts = fixed.split('.');
  final integer = parts[0];
  final grouped = _groupThousands(integer);
  return '$grouped.${parts[1]} $suffix';
}

/// `1,234.5` → كمية بحد أقصى 3 منازل (يقص الأصفار الزائدة).
/// الجزء الصحيح فقط يُفصل بفواصل الآلاف — الجزء العشري يبقى سليمًا
/// (`98.5` تبقى `98.5` لا `9,8.5`).
String qty(num value) {
  final fixed = value.toStringAsFixed(3);
  final parts = fixed.split('.');
  final trimmedDecimals = parts[1].replaceAll(RegExp(r'0+$'), '');
  final integer = _groupThousands(parts[0]);
  if (trimmedDecimals.isEmpty) return integer;
  return '$integer.$trimmedDecimals';
}

/// `1,234` — عدد صحيح بفواصل آلاف.
String count(num value) => _groupThousands(value.round().toString());

/// `13/09/2026` — تاريخ ميلادي معروض.
String date(Object? value) {
  if (value == null) return '—';
  final dt = value is DateTime ? value : DateTime.tryParse(value.toString());
  if (dt == null) return '—';
  final day = dt.day.toString().padLeft(2, '0');
  final month = dt.month.toString().padLeft(2, '0');
  return '$day/$month/${dt.year}';
}

/// `13/09/2026 02:30 م` — تاريخ ووقت.
String dateTime(Object? value) {
  if (value == null) return '—';
  final dt = value is DateTime ? value : DateTime.tryParse(value.toString());
  if (dt == null) return '—';
  final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  final minute = dt.minute.toString().padLeft(2, '0');
  final period = dt.hour >= 12 ? 'م' : 'ص';
  return '${date(dt)} · $hour:$minute $period';
}

String _groupThousands(String digits) {
  final negative = digits.startsWith('-');
  final clean = negative ? digits.substring(1) : digits;
  final buffer = StringBuffer();
  for (var i = 0; i < clean.length; i++) {
    buffer.write(clean[i]);
    final remaining = clean.length - i - 1;
    if (remaining > 0 && remaining % 3 == 0) buffer.write(',');
  }
  return '${negative ? '-' : ''}${buffer.toString()}';
}

/// قراءة رقم آمنة من خريطة JSON (Decimal يصل كنص من الخادم).
num asNum(Object? value, [num fallback = 0]) {
  if (value == null) return fallback;
  if (value is num) return value;
  return num.tryParse(value.toString()) ?? fallback;
}
