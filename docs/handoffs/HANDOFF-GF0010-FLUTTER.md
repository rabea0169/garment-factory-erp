# Handoff — GF-0010 Flutter Secure Integration

## الحالة

- **Task ID:** GF-0010
- **Branch:** `phase2/gf-0010-flutter`
- **Commits:** `a2b234c` → `afe5559` → `4b4aa52` → `907764d`
- **Latest commit:** `907764d fix(gf-0010): align Flutter plugin APIs`
- **Base:** آخر `phase2/domain-foundation` عند GF-0008
- **Status:** تنفيذ العميل مكتمل، وCI أخضر؛ يحتاج مراجعة/دمج بشري
- **لا يتضمن:** تعديلات schema أو ملفات Purchasing/GF-0009

## ما تم تنفيذه

تم استبدال تخزين JWT في `SharedPreferences` بتخزين مشفر عبر `flutter_secure_storage` من خلال الملف الجديد:

```text
mobile_app/lib/core/storage/auth_storage.dart
```

تمت إعادة بناء `ApiClient` ليقرأ التوكن من Keychain/Keystore قبل الطلب، ويضيف `Authorization: Bearer <token>` تلقائيًا، ويمسح الجلسة عند HTTP 401، ويستدعي callback يعيد المستخدم إلى login. كما أصبح عنوان API قابلًا للضبط عبر:

```text
--dart-define=API_BASE_URL=https://erp.example.com
```

تم ربط `AuthCubit` بالتخزين الآمن، والتحقق من وجود الجلسة عند بدء التطبيق، وتوحيد رسائل أخطاء الشبكة. أصبح `AuthCubit` على مستوى التطبيق، وأصبح logout في Dashboard يمسح الجلسة قبل التوجيه إلى login.

تمت إضافة حماية تنقل في `AppRouter`: لا تُفتح المسارات المحمية دون توكن، والجلسة المحفوظة تجعل المسار الأول dashboard. عند انتهاء الجلسة يعيد interceptor المستخدم إلى login.

تمت إزالة mock fallback من `ReportsCubit`. إذا كان `/dashboard/stats` غير موجود أو أعاد بيانات ناقصة، تظهر حالة خطأ مع زر إعادة المحاولة بدل عرض أرقام وهمية. هذا مقصود لأن endpoint التقارير الخلفي غير منفذ بعد.

تم تفعيل job Flutter في `.github/workflows/ci.yml` ليشغل:

```bash
flutter pub get
flutter analyze
flutter test
```

وتحديث `mobile_app/README.md` لتوثيق التشغيل وعنوان API وسلوك الجلسة.

## الملفات المعدلة

```text
.github/workflows/ci.yml
mobile_app/pubspec.yaml
mobile_app/README.md
mobile_app/lib/app.dart
mobile_app/lib/main.dart
mobile_app/lib/core/network/api_client.dart
mobile_app/lib/core/router/app_router.dart
mobile_app/lib/core/storage/auth_storage.dart
mobile_app/lib/features/auth/presentation/cubit/auth_cubit.dart
mobile_app/lib/features/auth/presentation/screens/login_screen.dart
mobile_app/lib/features/dashboard/presentation/screens/dashboard_screen.dart
mobile_app/lib/features/reports/presentation/cubit/reports_cubit.dart
mobile_app/lib/features/reports/presentation/cubit/reports_state.dart
mobile_app/lib/features/reports/presentation/screens/reports_screen.dart
```

## التحقق

تم تنفيذ CI على GitHub للـ commit `907764d` عبر Run `32853456521`، وكانت الوظائف الثلاث ناجحة:

```text
Flutter — Analyze / Test       PASS
Secret Scan                    PASS
Backend — Prisma/Lint/Build/Tests PASS
```

نتائج Flutter تضمنت `flutter pub get` و`flutter analyze` و`flutter test` بنجاح.

تم تنفيذ فحوصات Backend على نفس قاعدة GF-0008 دون تغيير، وكانت النتائج:

```text
prisma generate        PASS
prisma validate        PASS
npm run lint           PASS
npm run build          PASS
unit tests             22 suites / 115 tests PASS
e2e tests              2 suites / 36 tests PASS
tsc --noEmit           PASS
```

في بيئة التنفيذ المحلية لم يكن Flutter SDK مثبتًا، لذلك تم اعتماد GitHub Actions للتحقق التنفيذي من Flutter، ونجحت البوابة فعليًا.

## تعليمات الدمج بعد GF-0009

بما أن نموذجًا آخر ينفذ GF-0009 على مسار المشتريات، يجب دمج هذا الفرع بعد اكتمال GF-0009 أو إعادة تطبيق commits GF-0010 فوق فرع GF-0009.
 لا توجد تعارضات متوقعة في schema أو Purchasing، لكن `.github/workflows/ci.yml` وREADME قد يحتاجان حلًا يدويًا إذا عدلهما النموذج الآخر.

بعد الدمج يجب التحقق من أن `flutter_secure_storage` موجود في `pubspec.yaml` وأن Flutter CI أخضر. كما يجب اختبار 401 على جهاز/محاكي حقيقي، لأن اختبار unit المحلي غير متاح بدون Flutter SDK.

## المخاطر المتبقية

تخزين وجود JWT لا يثبت صلاحية التوكن عند بدء التشغيل؛ إذا كان التوكن منتهيًا فسيظهر dashboard مؤقتًا ثم يعالج أول طلب 401 ويعيد المستخدم إلى login. يمكن إضافة `/auth/me` لاحقًا إذا وفر Backend هذا endpoint.

Endpoint `/dashboard/stats` غير موجود في Backend الحالي؛ لذلك Reports الآن صريح في عرض الخطأ بدل إخفاء غياب endpoint ببيانات mock. يجب تنفيذ Reports backend قبل اعتماد شاشة التقارير مؤسسيًا.
