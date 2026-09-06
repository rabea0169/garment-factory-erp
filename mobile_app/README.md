# Garment Factory ERP — Flutter Mobile App

تطبيق Flutter الميداني لنظام Garment Factory ERP. يعتمد التطبيق على JWT صادر من Backend، ويخزن التوكن في **Keychain/Keystore** عبر `flutter_secure_storage`، ولا يستخدم `SharedPreferences` لتخزين بيانات الجلسة.

## التشغيل المحلي

بعد تثبيت Flutter SDK، شغّل الأوامر التالية من مجلد `mobile_app`:

```bash
flutter pub get
flutter analyze
flutter test
flutter run
```

عنوان الخادم الافتراضي (MOB-5) هو الإنتاج عبر HTTPS:
`https://garment-factory-erp-production.up.railway.app` — لا HTTP مكشوف في أي افتراضي.

للتطوير المحلي فقط، تجاوز العنوان وقت البناء/التشغيل عبر `--dart-define` (بدون تعديل الكود):

```bash
# Android Emulator (10.0.2.2 = مضيف جهازك من داخل المحاكي)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3005

# iOS / macOS / Web / سطح المكتب
flutter run --dart-define=API_BASE_URL=http://localhost:3005

# جهاز فيزيائي على نفس الشبكة
flutter run --dart-define=API_BASE_URL=http://192.168.1.10:3005
```

ملاحظة: HTTP غير المشفر لا يعمل على Android إلا للعناوين التي تمررها صراحة
بهذه الطريقة وقت التطوير؛ عنوان الإنتاج الافتراضي HTTPS دائمًا، و`AndroidManifest`
لا يحتوي أي علامة `usesCleartextTraffic`.

## المصادقة وانتهاء الجلسة

يضيف `ApiClient` التوكن تلقائيًا إلى كل طلب محمي (MOB-1). عند استلام HTTP 401 من
مسار غير مسارات المصادقة نفسها، يجرّب `AuthRefreshInterceptor` تجديد الجلسة عبر
`POST /auth/refresh` بآخر `refresh_token` محفوظ (تحديث واحد فقط مهما تعددت
الطلبات المتزامنة)، ثم يعيد الطلب الأصلي مرة واحدة؛ إن فشل التجديد (رمز تحديث
ملغى/منتهٍ) تُمسح الجلسة المشفرة بالكامل ويُعاد المستخدم إلى شاشة تسجيل الدخول.
عند الخروج (MOB-2) يُبلَّغ الخادم `POST /auth/logout` بأفضل جهد قبل مسح التخزين
المحلي. كما يمنع الراوتر فتح الشاشات المحمية دون توكن محفوظ.

بيانات التقارير لا تستخدم fallback وهميًا. إذا كان endpoint `/dashboard/stats` غير متوفر أو أعاد payload غير مكتمل، يعرض التطبيق رسالة خطأ وزر إعادة محاولة بدل عرض أرقام قد تبدو حقيقية.

## بوابة الجودة

يجب أن تمر الأوامر التالية قبل الدمج:

```bash
flutter analyze
flutter test
```

وتُشغّل GitHub Actions job باسم `Flutter — Analyze / Test` هذه الفحوصات تلقائيًا على Pull Requests والتغييرات في الفروع.
