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

عنوان الخادم الافتراضي هو `http://10.0.2.2:3005` على Android Emulator، و`http://localhost:3005` على iOS/Web. يمكن تغيير العنوان دون تعديل الكود:

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.1.10:3005
```

في build الإنتاج يجب تمرير عنوان HTTPS حقيقي، مثل:

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://erp.example.com
```

## المصادقة وانتهاء الجلسة

يضيف `ApiClient` التوكن تلقائيًا إلى كل طلب محمي. عند استلام HTTP 401، يمسح التطبيق الجلسة المشفرة ويعيد المستخدم إلى شاشة تسجيل الدخول. كما يمنع الراوتر فتح الشاشات المحمية دون توكن محفوظ.

بيانات التقارير لا تستخدم fallback وهميًا. إذا كان endpoint `/dashboard/stats` غير متوفر أو أعاد payload غير مكتمل، يعرض التطبيق رسالة خطأ وزر إعادة محاولة بدل عرض أرقام قد تبدو حقيقية.

## بوابة الجودة

يجب أن تمر الأوامر التالية قبل الدمج:

```bash
flutter analyze
flutter test
```

وتُشغّل GitHub Actions job باسم `Flutter — Analyze / Test` هذه الفحوصات تلقائيًا على Pull Requests والتغييرات في الفروع.
