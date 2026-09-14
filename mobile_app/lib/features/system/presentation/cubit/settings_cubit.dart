import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// إعدادات المصنع (نفس FactorySettings في المرجع — حقول الهوية/الطباعة).
String? _nonEmpty(String? value) =>
    (value == null || value.isEmpty) ? null : value;

class FactorySettingsModel {
  const FactorySettingsModel({
    required this.factoryName,
    this.factoryNameEn = '',
    this.slogan = '',
    this.phone = '',
    this.whatsapp = '',
    this.email = '',
    this.address = '',
    this.taxNumber = '',
    this.commercialRegister = '',
    this.logo,
    this.currency = 'ج.م',
    this.invoicePrefix = 'INV-',
    this.invoiceFooter = '',
    this.defaultPaperSize = 'A4',
    this.enableInvoiceQr = true,
    this.taxRate = 0,
    this.lastBackupAt,
  });

  factory FactorySettingsModel.fromJson(Map<String, dynamic> json) =>
      FactorySettingsModel(
        factoryName: ApiParsing.requiredString(json, 'factoryName',
            context: 'إعدادات المصنع'),
        factoryNameEn: json['factoryNameEn']?.toString() ?? '',
        slogan: json['slogan']?.toString() ?? '',
        phone: json['phone']?.toString() ?? '',
        whatsapp: json['whatsapp']?.toString() ?? '',
        email: json['email']?.toString() ?? '',
        address: json['address']?.toString() ?? '',
        taxNumber: json['taxNumber']?.toString() ?? '',
        commercialRegister: json['commercialRegister']?.toString() ?? '',
        // '' تُعامل كعدم وجود شعار (الخادم يخزّن null عند الحذف —
        // التطبيع يمنع تمرير سلسلة فارغة لعرض الصورة).
        logo: _nonEmpty(json['logo']?.toString()),
        currency: json['currency']?.toString() ?? 'ج.م',
        invoicePrefix: json['invoicePrefix']?.toString() ?? 'INV-',
        invoiceFooter: json['invoiceFooter']?.toString() ?? '',
        defaultPaperSize: json['defaultPaperSize']?.toString() ?? 'A4',
        enableInvoiceQr: json['enableInvoiceQr'] != false,
        taxRate: ApiParsing.number(json, 'taxRate',
            context: 'إعدادات المصنع', fallback: 0),
        lastBackupAt: null,
      );

  final String factoryName;
  final String factoryNameEn;
  final String slogan;
  final String phone;
  final String whatsapp;
  final String email;
  final String address;
  final String taxNumber;
  final String commercialRegister;
  final String? logo;
  final String currency;
  final String invoicePrefix;
  final String invoiceFooter;
  final String defaultPaperSize;
  final bool enableInvoiceQr;
  final double taxRate;
  final DateTime? lastBackupAt;

  /// نسخة بصلاحيات التعديل (null = لا تغيير).
  Map<String, dynamic> toUpdateJson({
    String? factoryName,
    String? factoryNameEn,
    String? slogan,
    String? phone,
    String? whatsapp,
    String? email,
    String? address,
    String? taxNumber,
    String? commercialRegister,
    String? logo,
    bool clearLogo = false,
    String? currency,
    String? invoicePrefix,
    String? invoiceFooter,
    String? defaultPaperSize,
    bool? enableInvoiceQr,
    double? taxRate,
  }) =>
      <String, dynamic>{
        if (factoryName != null) 'factoryName': factoryName,
        if (factoryNameEn != null) 'factoryNameEn': factoryNameEn,
        if (slogan != null) 'slogan': slogan,
        if (phone != null) 'phone': phone,
        if (whatsapp != null) 'whatsapp': whatsapp,
        if (email != null) 'email': email,
        if (address != null) 'address': address,
        if (taxNumber != null) 'taxNumber': taxNumber,
        if (commercialRegister != null)
          'commercialRegister': commercialRegister,
        if (clearLogo) 'logo': '',
        if (!clearLogo && logo != null) 'logo': logo,
        if (currency != null) 'currency': currency,
        if (invoicePrefix != null) 'invoicePrefix': invoicePrefix,
        if (invoiceFooter != null) 'invoiceFooter': invoiceFooter,
        if (defaultPaperSize != null) 'defaultPaperSize': defaultPaperSize,
        if (enableInvoiceQr != null) 'enableInvoiceQr': enableInvoiceQr,
        if (taxRate != null) 'taxRate': taxRate,
      };
}

/// حالات شاشة الإعدادات.
abstract class SettingsState {}

class SettingsInitial extends SettingsState {}

class SettingsLoading extends SettingsState {}

class SettingsLoaded extends SettingsState {
  SettingsLoaded(this.settings);

  final FactorySettingsModel settings;
}

class SettingsSaving extends SettingsState {
  SettingsSaving(this.settings);

  final FactorySettingsModel settings;
}

class SettingsSaved extends SettingsState {
  SettingsSaved(this.settings);

  final FactorySettingsModel settings;
}

class SettingsError extends SettingsState {
  SettingsError(this.message);

  final String message;
}

/// SELIM-ERP W3 — cubit إعدادات المصنع (GET/POST /system/factory-settings).
class SettingsCubit extends Cubit<SettingsState> {
  SettingsCubit({Dio? dio}) : super(SettingsInitial()) {
    _dio = dio ?? ApiClient.instance.dio;
  }

  late final Dio _dio;

  Future<void> load() async {
    emit(SettingsLoading());
    try {
      final response = await _dio.get<dynamic>('/system/factory-settings');
      final data = response.data;
      if (data is! Map) {
        throw Exception('استجابة إعدادات غير صالحة');
      }
      emit(
        SettingsLoaded(
          FactorySettingsModel.fromJson(
            ApiParsing.map(data, context: 'إعدادات المصنع'),
          ),
        ),
      );
    } catch (error) {
      emit(SettingsError(ApiClient.instance.messageFor(error)));
    }
  }

  /// حفظ الحقول المعدلة فقط (PATCH semantics عبر POST الجزئي).
  Future<void> save(Map<String, dynamic> changes) async {
    final current = state;
    final settings =
        current is SettingsLoaded ? current.settings : null;
    if (settings == null) return;
    if (changes.isEmpty) {
      emit(SettingsSaved(settings));
      return;
    }
    emit(SettingsSaving(settings));
    try {
      final response = await _dio.post<dynamic>(
        '/system/factory-settings',
        data: changes,
      );
      final data = response.data;
      final updated = data is Map
          ? FactorySettingsModel.fromJson(
              ApiParsing.map(data, context: 'إعدادات المصنع'),
            )
          : settings;
      emit(SettingsSaved(updated));
    } catch (error) {
      emit(SettingsError(ApiClient.instance.messageFor(error)));
    }
  }
}
