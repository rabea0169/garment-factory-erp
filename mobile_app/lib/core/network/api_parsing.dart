/// Helpers for validating and normalizing JSON responses at the API boundary.
///
/// Keeping these checks in one place prevents screens from crashing on malformed
/// or partially populated responses and gives the UI a consistent error type.
class ApiParsing {
  const ApiParsing._();

  static Map<String, dynamic> map(Object? value, {required String context}) {
    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }
    throw FormatException('استجابة $context غير صالحة');
  }

  static List<Map<String, dynamic>> mapList(
    Object? value, {
    required String context,
  }) {
    if (value is! List) {
      throw FormatException('قائمة $context غير صالحة');
    }
    return value
        .map((item) => map(item, context: context))
        .toList(growable: false);
  }

  static List<Map<String, dynamic>> paginatedMaps(
    Object? payload, {
    required String context,
  }) {
    final data = payload is Map ? payload['data'] : payload;
    return mapList(data, context: context);
  }

  static String requiredString(
    Map<String, dynamic> json,
    String key, {
    required String context,
  }) {
    final value = json[key];
    if (value is String && value.trim().isNotEmpty) return value.trim();
    throw FormatException('الحقل $key في $context مفقود أو غير صالح');
  }

  static String? nullableString(Map<String, dynamic> json, String key) {
    final value = json[key];
    if (value == null) return null;
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }
    throw FormatException('الحقل $key غير صالح');
  }

  static double number(
    Map<String, dynamic> json,
    String key, {
    required String context,
    double? fallback,
  }) {
    final value = json[key];
    if (value is num) return value.toDouble();
    if (value is String) {
      final parsed = double.tryParse(value.trim());
      if (parsed != null) return parsed;
    }
    if (fallback != null && value == null) return fallback;
    throw FormatException('الحقل $key في $context غير رقمي');
  }

  static int integer(
    Map<String, dynamic> json,
    String key, {
    required String context,
    int? fallback,
  }) {
    final value = json[key];
    if (value is int) return value;
    if (value is num && value == value.roundToDouble()) return value.toInt();
    if (value is String) {
      final parsed = int.tryParse(value.trim());
      if (parsed != null) return parsed;
    }
    if (fallback != null && value == null) return fallback;
    throw FormatException('الحقل $key في $context ليس عددًا صحيحًا');
  }
}
