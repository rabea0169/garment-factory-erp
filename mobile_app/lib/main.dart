import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'app.dart';
import 'core/network/api_client.dart';
import 'core/router/app_router.dart';
import 'core/storage/auth_storage.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // MOBILE-F03: تهيئة بيانات صيغ التاريخ العربية لـ intl (DateFormat.yMMMd('ar')).
  await initializeDateFormatting('ar', null);

  // تهيئة عميل API
  ApiClient.instance.init(onUnauthorized: AppRouter.goToLogin);
  String? token;
  try {
    token = await AuthStorage().readAccessToken();
  } catch (_) {
    // فشل قراءة التخزين لا يجب أن يمنع تشغيل التطبيق؛ يبدأ المستخدم بدون جلسة.
    token = null;
  }
  AppRouter.configureInitialLocation(isAuthenticated: token?.isNotEmpty == true);

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
