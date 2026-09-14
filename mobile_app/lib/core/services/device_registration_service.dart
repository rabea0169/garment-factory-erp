import 'dart:ui';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:hive/hive.dart';
import 'package:uuid/uuid.dart';

import '../network/api_client.dart';

/// SELIM-ERP W3 — تسجيل الجهاز ونبضاته (نقل APP-1 من /api/devices في
/// Selim ERP: register/heartbeat + قائمة للأدارية من شاشة الأجهزة).
///
/// - deviceId مستقر يُولَّد مرة ويُحفظ في Hive (gf_settings).
/// - [registerOnce] يُستدعى بعد دخول لوحة التحكم (فشل صامت — التتبع
///   تحسين لا يعيق الاستخدام).
/// - [heartbeat] تحديث آخر ظهور (مع آخر نسخة إصدار التطبيق).
class DeviceRegistrationService {
  DeviceRegistrationService({HiveInterface? hive, Dio? dio, Uuid? uuid})
      : _hive = hive ?? Hive,
        _dio = dio ?? ApiClient.instance.dio,
        _uuid = uuid ?? const Uuid();

  static final DeviceRegistrationService instance =
      DeviceRegistrationService();

  static const String settingsBox = 'gf_settings';
  static const String deviceIdKey = 'device_id';

  final HiveInterface _hive;
  final Dio _dio;
  final Uuid _uuid;

  String? _cachedDeviceId;
  bool _registered = false;

  /// معرف الجهاز المستقر (يُنشأ مرة واحدة ويُحفظ).
  Future<String> deviceId() async {
    if (_cachedDeviceId != null) return _cachedDeviceId!;
    final box = await _openSettings();
    try {
      var existing = box?.get(deviceIdKey) as String?;
      if (existing == null || existing.isEmpty) {
        existing = _uuid.v4();
        await box?.put(deviceIdKey, existing);
      }
      _cachedDeviceId = existing;
      return existing;
    } catch (_) {
      // Hive معطل — معرف جلسة مؤقت (بلا حفظ).
      _cachedDeviceId ??= _uuid.v4();
      return _cachedDeviceId!;
    }
  }

  /// يفتح صندوق الإعدادات بأمان (null عند تعطل التخزين).
  Future<Box?> _openSettings() async {
    try {
      if (_hive.isBoxOpen(settingsBox)) return _hive.box(settingsBox);
      return await _hive.openBox(settingsBox);
    } catch (_) {
      return null;
    }
  }

  /// يسجّل الجهاز مرة واحدة لكل تشغيل (POST /system/devices/register).
  Future<bool> registerOnce({
    String? appVersion,
    String? language,
  }) async {
    if (_registered) return true;
    try {
      final id = await deviceId();
      await _dio.post<void>(
        '/system/devices/register',
        data: <String, dynamic>{
          'deviceId': id,
          'userAgent': 'Flutter/${defaultTargetPlatform.name}',
          'platform': defaultTargetPlatform.name,
          'language': language ?? PlatformDispatcher.instance.locale.languageCode,
          'screenWidth': PlatformDispatcher.instance.views.first.physicalSize.width
                  .toInt() >
              0
              ? (PlatformDispatcher.instance.views.first.physicalSize.width /
                      PlatformDispatcher.instance.views.first.devicePixelRatio)
                  .round()
              : null,
          'screenHeight': PlatformDispatcher.instance.views.first.physicalSize.height
                  .toInt() >
              0
              ? (PlatformDispatcher.instance.views.first.physicalSize.height /
                      PlatformDispatcher.instance.views.first.devicePixelRatio)
                  .round()
              : null,
          'isMobile': !kIsWeb &&
              (defaultTargetPlatform == TargetPlatform.android ||
                  defaultTargetPlatform == TargetPlatform.iOS),
          if (appVersion != null) 'appVersion': appVersion,
        },
      );
      _registered = true;
      return true;
    } catch (_) {
      // فشل صامت — التتبع تحسين تشغيلي لا وظيفة.
      return false;
    }
  }

  /// نبضة — تحديث آخر ظهور (POST /system/devices/heartbeat).
  Future<void> heartbeat() async {
    if (!_registered) return;
    try {
      final id = await deviceId();
      await _dio.post<void>(
        '/system/devices/heartbeat',
        data: <String, dynamic>{'deviceId': id},
      );
    } catch (_) {
      // فشل صامت.
    }
  }

  /// إعادة الضبط للاختبارات.
  @visibleForTesting
  void resetForTest() {
    _registered = false;
  }
}
