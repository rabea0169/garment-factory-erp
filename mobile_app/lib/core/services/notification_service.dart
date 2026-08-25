import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  static final FlutterLocalNotificationsPlugin _notificationsPlugin =
      FlutterLocalNotificationsPlugin();
  static bool _initialized = false;

  static Future<void> init() async {
    if (_initialized) return;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const settings = InitializationSettings(android: androidSettings);
    final initialized = await _notificationsPlugin.initialize(settings: settings);
    _initialized = initialized ?? false;
  }

  static Future<void> showNotification({
    required String title,
    required String body,
  }) async {
    await init();
    if (!_initialized) return;

    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'general',
        'General notifications',
        channelDescription: 'تنبيهات نظام إدارة المصنع',
        importance: Importance.defaultImportance,
        priority: Priority.defaultPriority,
      ),
    );
    final notificationId = DateTime.now().millisecondsSinceEpoch.remainder(1 << 31);
    await _notificationsPlugin.show(
      id: notificationId,
      title: title,
      body: body,
      notificationDetails: details,
    );
  }
}
