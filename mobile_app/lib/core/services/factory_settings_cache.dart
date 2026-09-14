import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../network/api_client.dart';

/// SELIM-ERP W3 — إعدادات المصنع على الجهاز (نقل getFactorySettings من
/// المرجع): تُجلب مرة وتُخزَّن في الذاكرة — تستهلكها الطباعة (ترويسة
/// الإيصار + QR TLV ببيانات السجل الضريبي) وواجهة كشف الحساب.
///
/// الأسبقية: إعدادات الخادم (GET /system/factory-settings) ثم متغيرات
/// البيئة (COMPANY_NAME/COMPANY_VAT_NUMBER) — نفس أسبقية المرجع
/// (إعدادات الداتابيس ثم .env).
@immutable
class FactorySettings {
  const FactorySettings({
    required this.factoryName,
    this.factoryNameEn,
    this.phone,
    this.whatsapp,
    this.address,
    this.taxNumber,
    this.currency = 'ج.م',
    this.invoiceFooter,
    this.enableInvoiceQr = true,
    this.logo,
  });

  factory FactorySettings.fromJson(Map<String, dynamic> json) =>
      FactorySettings(
        factoryName: (json['factoryName'] as String?)?.trim().isNotEmpty == true
            ? json['factoryName'] as String
            : _envCompany(),
        factoryNameEn: json['factoryNameEn'] as String?,
        phone: json['phone'] as String?,
        whatsapp: json['whatsapp'] as String?,
        address: json['address'] as String?,
        taxNumber: _taxNumberOrNull(json['taxNumber']),
        currency: (json['currency'] as String?) ?? 'ج.م',
        invoiceFooter: json['invoiceFooter'] as String?,
        enableInvoiceQr: json['enableInvoiceQr'] != false,
        logo: json['logo'] as String?,
      );

  /// الاسم من متغير البيئة أو الافتراضي.
  static String _envCompany() =>
      const String.fromEnvironment('COMPANY_NAME', defaultValue: 'مصنع الملابس');

  /// رقم السجل الضريبي الصالح (أرقام وشرطات فقط — يغذي QR TLV).
  static String? _taxNumberOrNull(Object? raw) {
    final value = raw?.toString().trim() ?? '';
    if (value.isEmpty) {
      return const String.fromEnvironment('COMPANY_VAT_NUMBER')
              .trim()
              .isEmpty
          ? null
          : const String.fromEnvironment('COMPANY_VAT_NUMBER').trim();
    }
    return value;
  }

  final String factoryName;
  final String? factoryNameEn;
  final String? phone;
  final String? whatsapp;
  final String? address;
  final String? taxNumber;
  final String currency;
  final String? invoiceFooter;
  final bool enableInvoiceQr;
  final String? logo;

  /// سطر العنوان المدمج (هاتف · عنوان) للترويسات.
  String get contactLine {
    final parts = <String>[
      if (phone != null && phone!.isNotEmpty) phone!,
      if (address != null && address!.isNotEmpty) address!,
    ];
    return parts.join(' · ');
  }
}

/// مخزن مؤقت للإعدادات — جلب مرة واحدة لكل جلسة (فشل صامت: قيم env).
class FactorySettingsCache {
  FactorySettingsCache({Dio? dio}) : _injectedDio = dio;

  static final FactorySettingsCache instance = FactorySettingsCache();

  final Dio? _injectedDio;

  /// يُحل عند أول نداء — بيئات الاختبار قد لا تهيئ ApiClient.
  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  FactorySettings? _cached;
  Future<FactorySettings>? _inFlight;

  /// الإعدادات الحالية (من الشبكة أول مرة، ثم الذاكرة).
  Future<FactorySettings> load({bool forceRefresh = false}) async {
    if (!forceRefresh && _cached != null) return _cached!;
    if (!forceRefresh && _inFlight != null) return _inFlight!;
    _inFlight = _fetch();
    try {
      _cached = await _inFlight!;
      return _cached!;
    } finally {
      _inFlight = null;
    }
  }

  /// القيمة المخزنة حاليًا (بلا شبكة) — null إن لم تُجلب بعد.
  FactorySettings? get current => _cached;

  Future<FactorySettings> _fetch() async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/system/factory-settings',
      );
      final data = response.data;
      if (data == null) return _fromEnv();
      return FactorySettings.fromJson(data);
    } catch (_) {
      return _fromEnv();
    }
  }

  FactorySettings _fromEnv() => FactorySettings.fromJson(const {});

  /// إعادة الضبط للاختبارات.
  @visibleForTesting
  void resetForTest() {
    _cached = null;
    _inFlight = null;
  }
}
