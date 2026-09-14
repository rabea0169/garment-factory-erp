import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// جهاز مسجل واحد (من GET /system/devices).
class DeviceEntry {
  const DeviceEntry({
    required this.deviceId,
    required this.platform,
    required this.isMobile,
    required this.appVersion,
    required this.userName,
    required this.lastSeenAt,
  });

  factory DeviceEntry.fromJson(Map<String, dynamic> json) => DeviceEntry(
        deviceId: json['deviceId']?.toString() ?? '',
        platform: json['platform']?.toString(),
        isMobile: json['isMobile'] == true,
        appVersion: json['appVersion']?.toString(),
        userName: json['user'] is Map
            ? (json['user'] as Map)['name']?.toString() ?? '—'
            : '—',
        lastSeenAt:
            DateTime.tryParse(json['lastSeenAt']?.toString() ?? '') ??
                DateTime.now(),
      );

  final String deviceId;
  final String? platform;
  final bool isMobile;
  final String? appVersion;
  final String userName;
  final DateTime lastSeenAt;

  /// هل كان ظهور الجهاز خلال آخر 15 دقيقة؟ (نشِط الآن).
  bool get isRecentlyActive =>
      DateTime.now().difference(lastSeenAt).inMinutes <= 15;
}

abstract class DevicesState {}

class DevicesInitial extends DevicesState {}

class DevicesLoading extends DevicesState {}

class DevicesLoaded extends DevicesState {
  DevicesLoaded(this.devices);

  final List<DeviceEntry> devices;
}

class DevicesError extends DevicesState {
  DevicesError(this.message);

  final String message;
}

/// SELIM-ERP W3 — cubit الأجهزة (GET /system/devices — قائمة ADMIN+).
class DevicesCubit extends Cubit<DevicesState> {
  DevicesCubit({Dio? dio}) : _injectedDio = dio, super(DevicesInitial());

  final Dio? _injectedDio;

  /// يُحل عند أول نداء — بيئات الاختبار قد لا تهيئ ApiClient.
  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  Future<void> load() async {
    emit(DevicesLoading());
    try {
      final response = await _dio.get<dynamic>('/system/devices');
      final devices = <DeviceEntry>[];
      if (response.data is List) {
        for (final row in response.data as List) {
          if (row is Map) {
            devices.add(
              DeviceEntry.fromJson(
                ApiParsing.map(row, context: 'الأجهزة'),
              ),
            );
          }
        }
      }
      emit(DevicesLoaded(devices));
    } catch (error) {
      emit(DevicesError(ApiClient.instance.messageFor(error)));
    }
  }
}
