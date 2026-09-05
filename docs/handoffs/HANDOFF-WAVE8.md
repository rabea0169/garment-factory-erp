# Handoff — Wave 8 (دمج الموجة 7 + الإنتاج المباشر على Railway + GF-REMAINING-008)

## Status

- Branch: `main` (commit واحد مباشر لهذه الموجة بعد الدمج — لا فرع مستقل لأن الموجة 7 دُمجت عبر PR #77)
- Commit: `main@ca067da` (revert الـ seed المؤقت)؛ تعديلات الموجة 8 في working tree عند إعداد البطاقة — الـ commit مسؤولية الوكيل الرئيسي وفق قيود التنسيق
- Phase: ما بعد الإصلاح — التحقق من الإنتاج + تنفيذ GF-REMAINING-008
- Task ID: 4 (مسار الإصلاح والإنتاج) + 5 (GF-REMAINING-008)
- Date: 2026-09-05/06

## Completed

**أولًا — إغلاق مسار الإصلاح (تتمة الموجة 7):**

- تأكيد دمج PR #77 في `main@d6ad465` (فرع `fix/uat-remediation-wave7-p0` بكل commitsه الأربعة بما فيها `d052042` — إصلاح 33 اختبار تكامل كامنة).
- التحقق عبر GitHub Actions API: تشغيل `33963217026` على `d6ad465` نجح بوظائفه الأربع (Flutter / Performance بخطوة Seed / Backend كامل / Secret Scan) — أول CI أخضر على main منذ 2026-08-28.
- فحص Railway (المشروع `fulfilling-serenity`): آخر نشر ناجح `14c219e8` من `main@d6ad465` بتاريخ 2026-09-05T11:23 — الخدمة أقلعت بـ 73 مسارًا و`NODE_ENV=production` مع `preDeployCommand: prisma migrate deploy`.
- اكتشاف فجوة إقلاع: قاعدة الإنتاج بلا بيانات (لا `SEED_ADMIN_PASSWORD` على الخدمة ولا خطوة seed في النشر — والنشرات السابقة كلها فاشلة منذ 2026-08-26) — أي لا مستخدم يمكنه الدخول.
- بذر الإنتاج: `SEED_ADMIN_PASSWORD` عُيّن كمتغير بيئة على الخدمة عبر Railway API (لا يُخزن في Git)، ثم نُفّذ seed واحد عبر commit مؤقت `b2fcea2` (يضيف `npx prisma db seed` إلى preDeploy في `railway.json`) ثم رُدّ فورًا بـ `ca067da` لأن الـ seed غير idempotent. سجل النشر `90f36ef8` يوثق نجاح الـ seed كاملًا (مخازن/خامات/منتجات+BOM/أمر عمل/عمال/19 حسابًا/عملتان).
- التحقق المباشر من الإنتاج على `https://garment-factory-erp-production.up.railway.app` (سكربت `prod_verify`): `/health` 200، `/health/ready` database:ok، login ببيانات admin المُبذرة 200 مع tokens، `/dashboard/stats` 200 ببيانات فعلية، ودورة SEC-F04 كاملة (refresh rotation 200 → logout 200 → access القديم والمدوّر 401 → إعادة استخدام refresh القديم والمدوّر 401).

**ثانيًا — تنفيذ GF-REMAINING-008 (offline + barcode في Flutter):**

- الواقع قبل التنفيذ: `BarcodeScannerScreen` (mobile_scanner ^7.4.0) موجودة لكن **غير موصولة بأي شاشة**، لا حزمة connectivity في pubspec، والمخزون يعرض انقطاع الشبكة كخطأ عام عبر `messageFor`.
- `mobile_app/lib/core/services/connectivity_service.dart` (جديد): `ConnectivityService` فوق `connectivity_plus` ^6.1.4 — بثّ broadcast لحالة الاتصال مع تدهور آمن (فشل قراءة المنصة ⇒ افتراض متصل؛ التصنيف النهائي يبقى مسؤولية `ApiClient.isNetworkError`).
- `mobile_app/lib/core/widgets/offline_banner.dart` (جديد): `OfflineBanner` يلتفّ عبر `MaterialApp.builder` في `app.dart` فيظهر فوق كل الشاشات عند فقد الاتصال ويختفي تلقائيًا؛ قابل للحقن في الاختبارات عبر `service`.
- `mobile_app/lib/core/network/api_client.dart`: `static bool isNetworkError(Object)` — تصنيف مشترك (connectionError/connectionTimeout/sendTimeout/receiveTimeout) يميّزها عن 4xx/5xx؛ يوحّد منطق `ProductionNetworkFailure` السابق دون تكراره.
- `mobile_app/lib/core/widgets/app_feedback.dart`: `AppOfflineView` جديدة (wifi_off + رسالة + إعادة محاولة) منفصلة عن `AppErrorView`.
- `mobile_app/lib/core/services/barcode_scanner_launcher.dart` (جديد): `BarcodeScannerLauncher` يفتح `BarcodeScannerScreen` الحقيقي ويرجع الكود — قابل للحقن في الاختبارات بديلاً عن الكاميرا.
- `inventory_state.dart`: حالة `InventoryOffline` جديدة. `inventory_cubit.dart`: تصنيف انقطاع الشبكة إلى `InventoryOffline` + حقن `Dio` اختياري للاختبارات. `inventory_screen.dart`: شاشة offline مخصصة + زر مسح (`qr_code_scanner`) بجانب البحث يفتح الماسح ويرجع الـ SKU فيملأ البحث ويصفّي القائمة (الإلغاء لا يغيّر شيئًا) + حقن `cubit`/`scannerLauncher` وفق نمط شاشة المبيعات.
- الاختبارات (22 جديدًا، السuite 55/55): مصنّف `isNetworkError` (4 مجموعات)، الشريط (ظهور/اختفاء/تدهور)، cubit بحقن Dio يحلّ/يرفض (loaded/offline/error/تعافٍ بعد offline)، الشاشة بكل الحالات + سلك الماسح وحالة الإلغاء. `flutter analyze` نظيف و`flutter test` 55/55 محليًا على Flutter 3.47.2 (نفس قناة stable التي يستخدمها CI).

## Files Changed

- `mobile_app/pubspec.yaml` — إضافة `connectivity_plus: ^6.1.4`
- `mobile_app/lib/core/services/connectivity_service.dart` — جديد
- `mobile_app/lib/core/widgets/offline_banner.dart` — جديد
- `mobile_app/lib/core/services/barcode_scanner_launcher.dart` — جديد
- `mobile_app/lib/core/network/api_client.dart` — `isNetworkError`
- `mobile_app/lib/core/widgets/app_feedback.dart` — `AppOfflineView`
- `mobile_app/lib/app.dart` — `OfflineBanner` عبر `MaterialApp.builder`
- `mobile_app/lib/features/inventory/presentation/cubit/inventory_state.dart` — `InventoryOffline`
- `mobile_app/lib/features/inventory/presentation/cubit/inventory_cubit.dart` — تصنيف offline + حقن Dio
- `mobile_app/lib/features/inventory/presentation/screens/inventory_screen.dart` — شاشة offline + زر المسح + حقن
- `mobile_app/linux|windows/flutter/generated_plugin_registrant.*` و`mobile_app/macos/Flutter/GeneratedPluginRegistrant.swift` — تسجيل plugin مولّد تلقائيًا (connectivity_plus وتحديث متقادم لflutter_secure_storage)
- `mobile_app/test/core/network/api_client_network_error_test.dart` — جديد
- `mobile_app/test/core/widgets/offline_banner_test.dart` — جديد
- `mobile_app/test/features/inventory/presentation/inventory_cubit_test.dart` — جديد
- `mobile_app/test/features/inventory/presentation/inventory_screen_test.dart` — جديد
- `docs/PROJECT_STATE.md` — قسم الموجة 8 + تحديث جدول الحالة
- `docs/MASTER_BACKLOG.md` — إغلاق GF-REMAINING-010 وGF-REMAINING-007 واستعادة GF-REMAINING-008
- `docs/handoffs/HANDOFF-WAVE8.md` — هذه البطاقة
- على `main` مباشرة (قبل بطاقة الكود): `b2fcea2` (commit الـ seed المؤقت) و`ca067da` (رده) — نشران ناجحان على Railway بتوثيق كامل أعلاه

## Database/API Impact

- لا migration ولا تغيير بنية قاعدة في هذه الموجة. قاعدة الإنتاج (Railway PostgreSQL) اكتملت بـ 36 migration + بيانات الـ seed (idempotent-safe لأن الـ seed لن يُعاد تشغيله — أُزيل من preDeploy بعد التنفيذ الواحد).
- لا تغيير في عقد API. التغييرات محصورة في عميل Flutter (حزمات/شاشات/اختبارات) ووثائق.
- بيانات دخول admin للإنتاج: `admin@factory.com` مع كلمة المرور المحفوظة في متغير `SEED_ADMIN_PASSWORD` على خدمة Railway (غير منشورة في أي ملف — تُسلّم للمالك عبر قناة آمنة).

## Checks

- محليًا (Flutter 3.47.2 stable): `flutter pub get` نجح، `flutter analyze` — لا مشاكل، `flutter test` — **55/55 ناجحة** (منها 22 جديدة لهذه الموجة).
- البوابات الخلفية (backend) لم تُلمس في هذه الموجة؛ آخر حالة لها أخضر من تشغيل CI `33963217026` على `d6ad465`.
- الإنتاج: النشر `75ca77c7` (رد الـ seed) نجح؛ `/health` و`/health/ready` وlogin ودورة SEC-F04 كلها مُتحقق منها بعد كل من النشرين.
- بوابة CI النهائية لهذه الموجة: تشغيل CI على push هذا الـ commit نفسه — لم تكتمل عند إعداد البطاقة (مسؤولية الوكيل الرئيسي بعد الرفع).

## Known Issues

- `analysis_options.yaml` أُعيد إصدارًا تلقائيًا من أداة Flutter أثناء `pub get` (إضافة استثناءات مجلدات المنصة) — أُعيد إلى نسخة المستودع عمدًا للحفاظ على diff نظيف.
- اختبار الشريط (banner) حساس لتوقيت microtasks في بثّ broadcast؛ حُلّ بـ `pumpAndSettle` بعد تغييرات الحالة — نمط idiomatric وليس workaround هشًا.
- `connectivity_plus` 6.x يرجع `List<ConnectivityResult>` (واجهة 6.x) — إن رُقّي الحزمة لسلسلة 7.x مستقبلًا فستحتاج مراجعة طفيفة ل`_onResults`.

## Not Done

- **UAT فعلي على جهاز Android حقيقي** (G9→G10): سيناريوهات `docs/UAT_SCENARIOS.md` الـ 16 لم تُنفّذ بعد — الإنتاج جاهز لها الآن.
- **APK موقّع** (release build): لم يُبنَ — يحتاج قرار keystore من المالك.
- **بروفة backup/restore موثقة على الإنتاج**: أوامر الـ runbook جُرّبت محليًا؛ البروفة على قاعدة Railway نفسها تحتاج نافذة اتصال/أدوات (انظر BACKUP_RESTORE.md قسم Railway).
- ثغرتا سلسلة mysql2 داخل Prisma: مؤجلتان بقرار MASTER_BACKLOG (الإصلاح الكاسر يثبّت Prisma 6).
- دمج أوسع للحالة offline في بقية الشاشات (مبيعات/مشتريات/...): نطاق GF-REMAINING-008 اقتصر على المخزون + core وفق الخطة؛ البقية تتبع النمط نفسه عند الطلب.

## Next Exact Task

1. الوكيل الرئيسي يرفع تعديلات الموجة 8 إلى `main` (أو عبر PR حسب تفضيل المالك) ويراقب CI حتى الأخضر — خصوصًا وظيفة Flutter على GitHub runners.
2. تنفيذ UAT الفعلي وفق `docs/UAT_SCENARIOS.md` على جهاز Android موصول بقاعدة الإنتاج (`--dart-define=API_BASE_URL=https://garment-factory-erp-production.up.railway.app`) مع تعبئة جدول النتائج — قرار Go/No-Go لا يُتخذ قبل 16/16.
3. بالتوازي حسب قرار المالك: إنشاء keystore وبناء APK موقّع، وبروفة backup/restore على الإنتاج.

## Rollback

- كود Flutter: `git revert` لـ commit الموجة 8 يعيد كل شيء (التعديلات additive — لا حذف سلوك قائم إلا استبدال الخطأ العام بشاشة offline في المخزون، والـ revert يعيده).
- الإنتاج: لا أثر لهذه الموجة على النشر الحالي (لا تغييرات backend)؛ رد `b2fcea2` تم أصلًا بـ `ca067da`.
- قاعدة الإنتاج: بيانات الـ seed تبقى؛ لا تراجع مطلوب إلا بقرار المالك (حذف يدوي عبر SQL).
