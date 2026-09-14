import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// تنبيه ذكي واحد (نفس SmartAlert في المرجع — ألوان ودرجات الخطورة).
class SmartAlert {
  const SmartAlert({
    required this.id,
    required this.type,
    required this.title,
    required this.message,
    required this.icon,
    this.actionLabel,
    this.actionRoute,
  });

  factory SmartAlert.fromJson(Map<String, dynamic> json) => SmartAlert(
        id: ApiParsing.requiredString(json, 'id', context: 'التنبيهات'),
        type: json['type']?.toString() ?? 'info',
        title: json['title']?.toString() ?? '',
        message: json['message']?.toString() ?? '',
        icon: json['icon']?.toString() ?? '🔔',
        actionLabel: json['actionLabel']?.toString(),
        actionRoute: json['actionRoute']?.toString(),
      );

  final String id;
  final String type;
  final String title;
  final String message;
  final String icon;
  final String? actionLabel;
  final String? actionRoute;

  /// درجة الخطورة (warning/info/danger/success — نفس قيم المرجع).
  AlertSeverity get severity {
    switch (type) {
      case 'danger':
        return AlertSeverity.danger;
      case 'success':
        return AlertSeverity.success;
      case 'info':
        return AlertSeverity.info;
      default:
        return AlertSeverity.warning;
    }
  }
}

enum AlertSeverity { warning, info, danger, success }

/// حالات لوحة التنبيهات.
abstract class AlertsState {}

class AlertsInitial extends AlertsState {}

class AlertsLoading extends AlertsState {}

class AlertsLoaded extends AlertsState {
  AlertsLoaded(this.alerts, {this.refreshedAt});

  final List<SmartAlert> alerts;
  final DateTime? refreshedAt;

  int get count => alerts.length;
}

class AlertsError extends AlertsState {
  AlertsError(this.message);

  final String message;
}

/// SELIM-ERP W3 — cubit التنبيهات الذكية (GET /system/alerts).
///
/// جرس التطبيق يستمع للحالة: العدد فوق الأيقونة + اللوحة السفلية عند
/// الضغط (نفس AlertsPanel + جرس Header في المرجع).
class AlertsCubit extends Cubit<AlertsState> {
  AlertsCubit({Dio? dio}) : _injectedDio = dio, super(AlertsInitial());

  final Dio? _injectedDio;

  /// يُحل عند أول نداء — بيئات الاختبار قد لا تهيئ ApiClient
  /// (نمط OutboxService/BackupCubit في الموجة الثانية).
  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  Future<void> load() async {
    emit(AlertsLoading());
    try {
      final response = await _dio.get<dynamic>('/system/alerts');
      final data = response.data;
      final alerts = <SmartAlert>[];
      if (data is Map && data['alerts'] is List) {
        for (final row in data['alerts'] as List) {
          if (row is Map) {
            alerts.add(SmartAlert.fromJson(
              ApiParsing.map(row, context: 'التنبيهات'),
            ));
          }
        }
      } else if (data is List) {
        for (final row in data) {
          if (row is Map) {
            alerts
                .add(SmartAlert.fromJson(ApiParsing.map(row, context: 'التنبيهات')));
          }
        }
      }
      emit(AlertsLoaded(alerts, refreshedAt: DateTime.now()));
    } catch (error) {
      emit(AlertsError(ApiClient.instance.messageFor(error)));
    }
  }
}
