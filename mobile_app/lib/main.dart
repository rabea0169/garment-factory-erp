import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'app.dart';
import 'core/network/api_client.dart';
import 'core/router/app_router.dart';
import 'core/services/cache_service.dart';
import 'core/services/connectivity_service.dart';
import 'core/services/outbox_service.dart';
import 'core/storage/auth_storage.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // MOBILE-F03: تهيئة بيانات صيغ التاريخ العربية لـ intl (DateFormat.yMMMd('ar')).
  await initializeDateFormatting('ar', null);

  // MOB-3: تهيئة Hive (ذاكرة القراءة + طابور الإرسال) قبل الإقلاع —
  // فشل التهيئة يعطّل القدرة اللا-اتصالية بصمت ولا يمنع تشغيل التطبيق.
  try {
    await Hive.initFlutter();
    await CacheService.instance.init();
    await OutboxService.instance.init();
  } catch (_) {
    // أفضل-جهد: التطبيق يعمل متصلًا كالمعتاد دون كاش/طابور.
  }

  // تهيئة عميل API
  ApiClient.instance.init(onUnauthorized: AppRouter.goToLogin);

  // MOB-3: عند عودة الاتصال تُرسل العمليات المعلّقة (FIFO، نفس مفتاح
  // الاندماجية) تلقائيًا؛ وعند الإقلاع وهي متصلة أيضًا.
  OutboxService.instance.bindConnectivity(
    sharedConnectivityService.onlineStream,
    isOnlineNow: sharedConnectivityService.isOnline,
  );
  String? token;
  Map<String, dynamic>? user;
  try {
    final storage = AuthStorage();
    token = await storage.readAccessToken();
    user = await storage.readUser();
  } catch (_) {
    // فشل قراءة التخزين لا يجب أن يمنع تشغيل التطبيق؛ يبدأ المستخدم بدون جلسة.
    token = null;
    user = null;
  }
  AppRouter.configureInitialLocation(
    isAuthenticated: token?.isNotEmpty == true && user?['id'] != null,
  );

  // إجبار الاتجاه العمودي فقط
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // تخصيص شريط الحالة
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ),
  );

  runApp(const GarmentFactoryApp());
}
