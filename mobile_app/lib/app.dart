import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/offline_banner.dart';
import 'features/auth/presentation/cubit/auth_cubit.dart';

class GarmentFactoryApp extends StatelessWidget {
  const GarmentFactoryApp({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AuthCubit()..checkAuthStatus(),
      child: MaterialApp.router(
        title: 'إدارة المصنع',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.lightTheme,
        routerConfig: AppRouter.router,
        // MOB-6: اللغة المدعومة هي العربية فقط (ar_EG) — التطبيق كله
        // نصوص عربية مباشرة بلا طبقة ترجمة، فلا معنى لإعلان en_US ضمن
        // supportedLocales (كان يوحي بثنائية لغة غير موجودة).
        // إضافة لغة لاحقًا تتطلب ARB + flutter gen-l10n (l10n.yaml)
        // وترجمة كل النصوص الثابتة — قرار مؤجل عمدًا في هذه المرحلة.
        locale: const Locale('ar', 'EG'),
        supportedLocales: const [
          Locale('ar', 'EG'),
        ],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        // GF-REMAINING-008: شريط "غير متصل" يظهر فوق كل الشاشات عند
        // فقد الاتصال (يتغير تلقائيًا عند عودته) دون تعديل كل شاشة.
        builder: (context, child) =>
            OfflineBanner(child: child ?? const SizedBox.shrink()),
      ),
    );
  }
}
