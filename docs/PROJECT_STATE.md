# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## تنفيذ ما بعد v1.6.0 — بروفة النسخ/الاستعادة + إصلاح عيبين قاتلين في DR (2026-09-14)

**القرار:** تنفيذ كل المتبقي عدا UAT الميداني (بطلب المالك) — بروفة النسخ
الاحتياطي/الاستعادة الموثقة (بند بوابة G9→G10) + الفحوصات المحاسبية
(Reconciliation) + تصفير الوثائق المتقادمة.

**البروفة (على نسخة إنتاج حقيقية):** تنزيل `GET /system/backup` (162 صفًا)
→ قاعدة نظيفة PostgreSQL 16.15 بـ 43/43 هجرة → استعادة → **اكتشاف
عيبين قاتلين** في مسار الاستعادة → إصلاحهما → استعادة ناجحة 28 جدولًا/
162 صفًا مطابقة → **تسجيل دخول فعلي ببيانات مدير الإنتاج على النسخة
المستعادة** → مطابقة لوحة المؤشرات بين الإنتاج والنسخة المستعادة.

**العيبان المكتشفان والمُصلحان (فرع `fix/backup-restore-dr-gate`):**
1. **ترتيب الإدراج يكسر FK:** `FiscalPeriod.createdById → User` كانت
   تُدرج قبل User (فشل فعلي بالبروفة) + `Voucher` قبل `JournalEntry` +
   `Quotation` قبل `SalesOrder` (كامنان) + `RefreshToken`/`JournalEntry`
   مراجع ذاتية بلا فرز. الحل: إعادة ترتيب `BACKUP_ORDER` + فرز createdAt
   للمراجع الذاتية + **حارس اختباري يقرأ schema.prisma ويتحقق من كل
   علاقات FK ضد الترتيب** (يمنع تكرار الصنف عند أي إضافة مستقبلية).
2. **سجل تدقيق الاستعادة يستخدم معرف المنفذ المحذوف:** TRUNCATE يستبدل
   المستخدمين، فكان `SYSTEM_RESTORED` يشير لمعرف المنفِّذ المحلي ⇒ P2003
   ⇒ **الاستعادة على نظام جديد (سيناريو DR حرفيًا) كانت مستحيلة**. الحل:
   نسبة السجل لمستخدم موجود في البيانات المستعادة (المنفذ إن وُجد ثم
   مُصدِّر النسخة ثم أول مستخدم) + توثيق المنفذ الفعلي نصًّا في التفاصيل.

**الاختبارات:** 74/74 suites و**1064/1064** unit (منها 3 جديدة) + 9/9
في وحدة النسخ الاحتياطي + typecheck/lint/format خضراء. التفصيل الكامل
للبروفة والفحوصات: `docs/runbooks/BACKUP_RESTORE.md` (سجل بروفة مستوى
التطبيق 2026-09-14).

**اكتشاف محاسبي (يُبلَّغ للمالك — لم يُنفَّذ بقرار «الأخطاء تُبلَّغ»):**
الإنتاج يحمل مخزونًا بقيمة 7,005 EGP ومنتج تام (50+30) **بلا قيد
افتتاحي** (قيود اليومية = 0، كل الأرصدة = 0.00) — بذرة الإنتاج القديمة
لا تنشئ القيد بينما البذرة الحالية تفعله. المطلوب: قيد افتتاحي في
الإنتاج أو إعادة بذر نظيفة (قرار المالك).

**توثيق الوضع الحالي (تصفير التقادم):** GF-IMP-W2/W3 في MASTER_BACKLOG
كانتا متقادمتين («تنتظر PR/CI») وهما مدموجتان فعليًا عبر #80/#81 منذ
2026-09-06 (تحقق مباشر: هجراتهما داخل main) — صُحّحت الحالة. جدول
«الحالة الحالية» أدناه كان متوقفًا عند `ca067da` (2026-09-05) — حُدّث
إلى `4debaac`.

---

## الإصدار v1.6.0 — نسخة Selim ERP، الموجة الخامسة (2026-09-14)

**القرار:** إغلاق آخر فجوة اكتشفتها المقارنة الشاملة للمرجع — **تقرير
العامل المجمّع** (WorkerReportModal + `/api/worker-report/[id]`):
حركات العامل الخمسة (سلف/سندات قبض/حضور/إنتاج/رواتب) في نطاق تاريخ +
الملخصات والرصيد الافتتاحي/الختامي + تصدير PDF عربي. استمرار استثناء
التكاملات الخارجية (ETA/واتساب/إيميل/بنوك) وعدم بناء APK (قرار المالك).
المرجع الكامل: `docs/SELIM_REPLICATION.md` (قسم الموجة الخامسة).

**التنفيذ (فرع `feature/selim-wave5`):**
- الباكند: `GET /hr/workers/:id/report?from=&to=` (HR/GM + SA) — تحقق
  صارم للنطاق (رسائل 400 العربية نفسها)، قوائم الفترة بسقف 500، الرصيدان
  **بدلالات هذا المشروع** (سند القبض عندنا استرداد من العامل — معكوس عن
  المرجع: net = سلف غير مسوية − سندات − رواتب APPROVED غير مدفوعة)،
  الرواتب تُنسب لنهاية فترتها، وحقول الهوية HR فقط (HR-8). 7 اختبارات.
- الجوال: شاشة `/hr/workers/report/:workerId` داخل BackGuard (تفتح بـ
  push من نشاط العامل فيعود الرجوع إليها) — منتقي نطاق (افتراضي بداية
  الشهر حتى اليوم) + بطاقتا رصيد ملونتان بالاتجاه + 5 تبويبات + تصدير
  PDF بنفس نهج كشوف W3 (صفحات A4 مصيَّرة كـ Widget). 6 اختبارات cubit.
- الإصدار: `1.6.0+9`. بلا هجرات، بلا تغيير على APIs قائمة.

**أخطاء مرجعية وُجدت فلم تُنسخ** (تُبلَّغ فقط — راجع قسم الموجة الخامسة):
unpaid بحالة الرواتب الحالية فقط (كشف دُفع لاحقًا يظل «مستحقًا» في تقرير
ماضٍ)؛ ترشيح رواتب المرجع بحقل تاريخ النقد قد يقسم كشفًا إلى نصفين.

**الحالة:** باكند 74 suite / **1061 اختبارًا** أخضر محليًا (typecheck/
lint/build أيضًا)؛ الجوال يُتحقق منه عبر CI. **APK بُني بطلب المالك**:
tag `v1.6.0-uat` (189.8MB، arm64-v8a، توقيع debug) — Release مرفق مع
ملاحظات إصدار تغطي الموجات كلها.

---

## الإصدار v1.5.0 — نسخة Selim ERP، الموجة الرابعة (2026-09-14)

**القرار:** متابعة تقليد المرجع — طبقة «الإدارة الموسّعة»: فروع الشركة
(SPRINT 89/93/94)، الصلاحيات التفصيلية للمستخدم (SPRINT 81)، بطاقة الطرف
بسداد سريع (P2-7)، وحلّ تعارضات المزامنة (APP-1/APP-2). استمرار استثناء
التكاملات الخارجية (ETA/واتساب/إيميل/بنوك) وعدم بناء APK (قرار المالك).
المرجع الكامل: `docs/SELIM_REPLICATION.md` (قسم الموجة الرابعة).

**سلسلة الدمج (فرع `feature/selim-wave4`):**
- الباكند (68be770): `permissions.domain` (أفعال/موارد/افتراضيات أدوار/
  حساب فعلي) + عمود `users.permissions` JSONB + GET/PUT
  `/users/:id/permissions` (409 لحبس النفس) + RolesGuard طبقة ثانية
  (منح صريحة تفتح بعد فشل الدور) + effectivePermissions في
  login/refresh/me + وحدة `branches` (CRUD بـ SA+GM) + `branchId`
  اختياري على أوامر البيع/الشراء والمنتجات (تحقق صارم 400) + هجرة
  `20260914010000_selim_erp_wave4_branches_permissions` + BACKUP_ORDER
  موسّع (بوابة التغطية خضراء).
- الجوال (6dc7f46): `effective_permissions.dart` (مرآة hasPermission) +
  `resourceOfRoute`/`canAccessWithUser` (الهيكل والدرج بالمستخدم الكامل) +
  شاشة الفروع + منتقي الفرع في فواتير البيع/الشراء + بطاقة الطرف
  (`party_details_sheet` بسداد سريع للعملاء) + محلّ التعارضات في طابور
  المزامنة (حالة conflict بلا إعادة تلقائية + retryWithFreshKey +
  اعتماد الخادم) + حوار مصفوفة الصلاحيات في شاشة المستخدمين + الإصدار
  `1.5.0+8`.
- إصلاح CI (ea6ca39): مسارات استيراد صحيحة (parties/auth بثلاث مستويات
  صعودًا) + توجيه library أولًا + محاكاة الفروع في اختبارات الشاشتين +
  استبدال `: never` في e2e-spec.

**أخطاء مرجعية وُجدت فلم تُنسخ** (تُبلَّغ فقط — راجع قسم الموجة الرابعة):
تجاهل صامت لـ branchId غير الصالح؛ أسماء موارد متعددة لنفس الأصل سببت
403 شاملة في المرجع (SPRINT 83/87)؛ أعلام canViewAll/canEditOwn بلا
دلالة موحدة.

**الحالة:** باكند أخضر محليًا (typecheck/lint/build + 74 suite/1054
اختبارًا + 76 e2e). CI يُتحقق من الجوال (analyze/test). بلا tag ولا APK
(قرار المالك مستمر — آخر بناء v1.3.0-uat). الإصدار: `1.5.0+8`.

---

## الإصدار v1.4.0 — نسخة Selim ERP، الموجة الثالثة (2026-09-14)

**القرار:** متابعة تقليد المرجع (القراءة ثم المحاكاة) — طبقة «النظام
الموسّع»: بحث عربي مُطبَّع، إعدادات المصنع، تنبيهات ذكية، سجل تدقيق،
أجهزة، كشوف حساب أطراف بتصدير PDF عربي، تصدير Excel/Word لثمانية كيانات،
مراكز تكلفة، مصاريف اللوحة، وقالب الاستيراد. استمرار استثناء التكاملات
الخارجية (ETA/واتساب/إيميل/بنوك). المرجع الكامل: `docs/SELIM_REPLICATION.md`
(قسم الموجة الثالثة).

**سلسلة الدمج (فرع `feature/selim-wave3`):**
- الباكند (c8f7884): وحدة exports (Excel/Word) + arabic-search.util مدمج
  في `/search` + factory-settings/alerts/audit-logs/devices + كشوف حساب
  customer/supplier + CRUD مراكز التكلفة + expensesByCategory + قالب
  الاستيراد + هجرتان (factory_settings, devices) + prisma-mock موسّع.
- QR/الإعدادات (6abe8c5): QR TLV يقرأ بيانات السجل من إعدادات المصنع
  (الأسبقية على env) + خدمات جوال: FactorySettingsCache /
  DeviceRegistrationService / FileDownloadService / outbox موسّع +
  arabic_text + اختباراتها.
- الجوال (شاشات الموجة): 7 شاشات جديدة داخل BackGuard (إعدادات المصنع
  بوضع عرض فقط لغير SUPER_ADMIN، سجل التدقيق بترقيم مصحوح، الأجهزة،
  طابور المزامنة، مراكز التكلفة، كشوف حساب عميل/مورد) + جرس AlertsBell
  في الهيكلين + أزرار تصدير EntityExportButtons في 8 شاشات قوائم +
  رسم دائري للمصاريف في اللوحة + تنزيل القالب من المعالج + ترويسة
  إيصار POS من إعدادات المصنع.
- إصلاحات أثناء المراجعة (لم تُنسخ من المرجع): hasMore للترقيم يقارن
  الصفحة×الحجم لا طول الصفحة؛ Form مفقود كان سيكسر حفظ الإعدادات؛
  مسار تنبيه النسخ `/system` غير موجود في الموجّه → `/backup`؛
  `AppColors.danger` غير معرف → `error`؛ شعار فارغ يُطبَّع null.

**الحالة:** 302+ اختبار وحدة باكند أخضر (1012 بمجموع suites الجوال
الجديدة عبر CI)؛ CI أخضر؛ **بلا tag ولا APK** (قرار المالك مستمر —
آخر بناء v1.3.0-uat). الإصدار: `1.4.0+7`.

---

## الإصدار v1.3.1 — إصلاح زر الرجوع الموحد (2026-09-14)

**القرار:** طلب المالك الصريح «لا تنسَ زر الرجوع في التطبيق» + **عدم بناء APK
الآن** (لا tag ولا Release لهذا الإصدار — يُبنى عند طلب المالك بـ tag
`v1.3.1-uat`).

**المشكلة المُصلَحة:** التنقل بين الأقسام (الشريط السفلي/درج «المزيد») عبر
`context.go` يستبدل مكدس go_router — فكانت شاشات الأقسام قاع المكدس، وزر
الرجوع الفيزيائي (Android) يخرج من التطبيق فورًا من أي قسم، و18 شاشة قديمة
(المبيعات/الكتالوج/المخزون/المشتريات/الرواتب/النماذج...) بلا زر رجوع ظاهر
في الـ AppBar أصلًا.

**التنفيذ (فرع `fix/back-navigation-ux`):**
- `core/navigation/back_navigation.dart` (جديد): `BackGuard` (اعتراض الرجوع
  الفيزيائي: العودة إلى لوحة التحكم من شاشة `go`، وتمرير حر لشاشة `push`
  عبر `canPop` ديناميكية) + `GfBackButton` (زر ظاهر RTL-aware) +
  `smartBack`.
- الروتر: لف **28 مسارًا** بـ `BackGuard` (استثناء مقصود: login — الرجوع
  فيه يترك التطبيق؛ dashboard — له حارس الضغطتين القائم).
- الهيكل التكيفي (جوالي + ديسكتوب): زر رجوع ظاهر في الـ AppBar يختفي في
  لوحة التحكم. لوحة التحكم تحتفظ بسلوك «ضغطتان للخروج» بلا تغيير.
- 18 شاشة قديمة/نماذج: `leading: GfBackButton`.
- اختبارات جديدة: `test/core/navigation/back_navigation_test.dart` — 6
  اختبارات (رجوع go→dashboard، تمرير push، سلوك الزر، اتجاه السهم RTL/LTR).
- الإصدار: `1.3.1+6`. بلا تغييرات باكند، بلا هجرات، بلا مساس بالـ APIs.

**التالي:** عند طلب المالك — tag `v1.3.1-uat` فيبني release.yml الـ APK
تلقائيًا؛ وإلى ذلك الحين يظل آخر APK متاحًا هو v1.3.0-uat (بلا إصلاح زر
الرجوع).

---
## الإصدار v1.3.0-uat — نسخة Selim ERP، الموجة الثانية (2026-09-14)

**القرار:** تنفيذ كامل بنود الموجة الثانية من نسخ Selim ERP **ما عدا التكاملات الخارجية** (ETA eInvoice/واتساب/إيميل/بنوك — استثناها المالك صراحة). المرجع الكامل: `docs/SELIM_REPLICATION.md`.

**سلسلة الدمج (فرع `feat/selim-erp-replication-wave2`):**
- `36dbef5` feat(api): أربع وحدات باكند — `search` (بحث شامل عابر للأقسام بتصفية أدوار) + `pos` (بيع سريع ذري + باركود + كتالوج) + `data-import` (معاينة/تنفيذ CSV/XLSX عبر exceljs) + `system` (نسخ احتياطي JSON بترتيب FK واستعادة بعبارة تأكيد) + `qr-tlv.util.ts` (ترميز ETA المحلي بلا تكامل خارجي).
- `55e4f06` feat(app): نقطة البيع كاملة (شبكة/سلة/مسح باركود/مستويات سعر/بيع offline عبر الطابور بنفس مفتاح idempotency) + `ThermalPrinterService` (flutter_thermal_printer — BLE/USB/شبكة، طباعة Widget عربية) + QR TLV محلي + معالج الاستيراد + شاشة النسخ الاحتياطي + لوحة الأوامر Ctrl+K مربوطة بالهيكلين.

**التكييفات الجوهرية الموثقة (راجع SELIM_REPLICATION.md):**
1. **POS يتجاوز فصل واجبات SAL-4** — أمر CONFIRMED مباشرة: البيع النقدي الفوري لا يمر بخطوة اعتماد أصلًا (لا اعتماد ذاتي)، مع نفس قيود GL/المخزون/سند القبض آليًا.
2. **بلا هجرات جديدة** — كل الموجة فوق الجداول القائمة (صفر خطر انحراف drift).
3. **بوابة تغطية النسخ الاحتياطي**: اختبار يطابق BACKUP_ORDER (73 جدولًا) مع schema.prisma — موديل جديد بلا تسجيل يُفشل CI.

**الأرقام:** backend **949/949** (66 suites، +25) · جوال **421/421** (+41) · flutter analyze صفر · tsc/lint/prettier/build/e2e 64/64 خضراء.

---
## الإصدار v1.2.0-uat — نسخة Selim ERP، الموجة الأولى (2026-09-13)

**القرار:** تقليد مشروع Selim ERP المرجعي (ويب Next.js) داخل هذا المشروع **بنفس المكدس** (Flutter موبايل+ديسكتوب + NestJS/Prisma) — بلا تغيير طريقة العمل القائمة، وبقاء كل الميزات السابقة. المرجع الكامل: `docs/SELIM_REPLICATION.md`.

**سلسلة الدمج:**
- **#86** `feat/selim-erp-replication-wave1` → main `ddbc755` (ثلاثية: schema + باكند + فلتر)
  - `ffeb431` feat(schema): 23 جدولًا جديدًا + هجرة `20260913000000_selim_erp_wave1_replication`
  - `13a3c84` feat(api): 12 وحدة باكند (quotations/purchase-returns/inventory-adjustments/expenses/treasury-transactions/shifts/worker-receipts/payroll-statements/cutting+packing/printing/journal-templates/financial-reports) + `SequenceService` ذرية (QUO/PRR/ADJ/TRT/SHF/WRC/PSM/CUT/PACK-0001)
  - `63ac70e` feat(app): هيكل تكيفي Selim (شريط سفلي+درج المزيد / NavigationRail ≥1000px) + 11 شاشة + مكتبة سليم + لوحة تحكم بإجراءات سريعة
  - `fa9ce30` fix(lint): مواءمة المواصفات مع createPrismaMock الموحد (133→0)
- **main CI: success** (backend 924 unit + e2e + integration + drift gate | flutter analyze 0 + 380 tests | perf | secret-scan)
- **الإنتاج (Railway):** أعيد النشر تلقائيًا؛ `/health/ready` = 200؛ نقاط النهاية الجديدة حية ومتحقق منها (`/quotations/stats`, `/financial-reports/income-statement`, `/printing/templates`)؛ **40 قالب طباعة عربي مهيأ تلقائيًا**.
- **GitHub Release:** [`v1.2.0-uat`](https://github.com/rabea0169/garment-factory-erp/releases/tag/v1.2.0-uat) — `garment-erp-1.2.0-uat.apk` (arm64-v8a، 187.1MB)
- **جديد البنية:** سير عمل `.github/workflows/release.yml` يبني APK عند tag `v*` على GitHub Actions (بعد analyze+tests) — يستبدل البناء المحلي المكلف. أول إصدار يُبنى به: v1.2.0-uat نفسه. (يحتاج `permissions: contents: write` — درس وُثق في `bcf1d04`).

**الإصدار:** `1.2.0+4` · **الاختبارات:** backend 924/924 · جوال 380/380 (+104 جديد) · analyze صفر ملاحظات.

**المؤجل للموجة الثانية (مرشح):** تكاملات ETA eInvoice/واتساب/إيميل/بنوك، طباعة حرارية ESC/POS بلوتوث، استيراد Excel/CSV، نسخ احتياطي/استعادة من الواجهة، بيع سريع POS offline، بحث شامل + لوحة أوامر. التفاصيل في نهاية `docs/SELIM_REPLICATION.md`.

---

## الإصدار v1.1.1-uat + استئناف بناء APK بنجاح (2026-09-12 — مساء)

**القرار:** اكتمال التدقيق الشامل ودمجه (#83) → رفع الإصدار إلى **1.1.1+3** (#84) → **تمكين بناء release APK** (#85) → **نشر GitHub Release v1.1.1-uat** بالـ APK.

**سلسلة الدمج (كلها CI أخضر ثم مدمجة):**
- **#83** `fix/audit-full-p0` → main `ae31fbc` (التدقيق الشامل + إصلاحات P0/P1 + فهارس + مزامنة العقد)
- **#84** `chore/apk-v1.1.1` → main `f46d07b` (رفع الإصدار إلى 1.1.1+3)
- **#85** `fix/apk-remove-dead-printer-plugin` → main `c630b95` (تمكين البناء — تفاصيل أدناه)
- **main CI على `c630b95`: success** · **الإنتاج (Railway):** أعيد النشر تلقائيًا بعد الدموج؛ `/health/ready` = 200 (database: ok) — هجرة `audit_gap_indexes` عبر preDeploy.

**حل عوائق بناء release APK (كان مستحيلًا مع AGP 9.0.1):**

1. **`blue_thermal_printer` 1.2.3 بلا namespace** — غير متوافق مع AGP 9 أصلًا. المكوّن **ميت** (مستورد فقط في `printer_service.dart` غير المستخدم — بند P1 من تدقيق audit-full) → **حُذف مع الخدمة الميتة** (276/276 اختبار جوال بعد الحذف).
2. **`path_provider_android` 2.3.x يسحب `jni_flutter` بكود C++ أصلي** → يتطلب NDK كامل (~3.5GB تنزيل + فك) — غير عملي وغير ضروري → **`dependency_overrides: path_provider_android: 2.2.10`** (نفس الواجهة بلا كود أصلي؛ حزمة jni اختفت من pubspec.lock تمامًا).
3. **توزيعة Gradle `-all` (761MB)** → استبدال بـ **`-bin`** (~150MB) في `gradle-wrapper.properties`.
4. **إعدادات ذاكرة 8GB** في `gradle.properties` → **1536m + workers=1 + بلا daemon + kotlin in-process** — البناء يعمل الآن على أجهزة 4GB RAM.
5. **`packaging.jniLibs.keepDebugSymbols`** — كل مكتبات `.so` مسبقة البناء من Flutter/الإضافات فلا حاجة لتجريد NDK.

**البناء المنجز والتحقق:**
- `flutter build apk --release --target-platform android-arm64` → **✓ app-release.apk (185.6MB)**
- **التحقق بالـ aapt2:** `INTERNET` ✅ (إصلاح P0 من #83 — v1.1.0 كان سيفشل في الاتصال!) + `CAMERA` ✅ + `NFC` ✅ · versionName `1.1.1` / versionCode `3` · minSdk 24 / targetSdk 36
- flutter analyze: 0 issues · flutter test: 276/276 · backend CI (على #85): 772 unit + 64 e2e + 45 integration كلها خضراء
- **GitHub Release:** [`v1.1.1-uat`](https://github.com/rabea0169/garment-factory-erp/releases/tag/v1.1.1-uat) — الأصل: `garment-erp-uat-v1.1.1.apk` (arm64-v8a)

**ملاحظات تشغيلية:**
- التوقيع debug keys (بيئة UAT) — مفتاح إنتاج release signing ما زال مطلوبًا قبل المتاجر (بند Backlog).
- ⚠️ **v1.1.0-uat يحمل خلل صلاحية INTERNET** — يجب إبلاغ فريق UAT بالترقية إلى v1.1.1 فورًا.
- بيئة البناء هذه: Flutter 3.47.4 stable + JDK 21 (Temurin محمول — النظام فيه JRE فقط) + Android SDK 37 + NDK **stub** بـ `source.properties` (يمسح flutter المجلد ويمرر installedNdkVersions فتتخطى إضافة Flutter فرض التنزيل).

---

## تحديث التدقيق الشامل ثلاثي المحاور + إصلاحات P0/P1 (2026-09-12) — audit-full

**النطاق:** تدقيق كامل للخلفية (13 موديولًا / 73+ مسارًا) والجوال (14 ميزة / 17 مسارًا / 8 أدوار) وقاعدة البيانات (50 موديلًا / 39 هجرة / 22 enum) عبر 3 وكلاء متوازين + تحقق مركزي بالبوابات. **قاعدة البيانات: صفر انحراف** بين schema.prisma والهجرات (مُثبت بتشغيل بوابة `prisma migrate diff` نفسها على قاعدة نظيفة — "No difference detected").

**الإصلاحات المنفذة (فرع `fix/audit-full-p0`):**

1. **P0 (إصدار الجوال):** AndroidManifest الرئيسي لم يكن يصرّح بـ `INTERNET` — نسخة release كانت ستفشل في الاتصال بالخادم إطلاقًا (الصلاحية كانت في debug/profile فقط). أُضيفت INTERNET + CAMERA + NFC صراحةً في main، وأوصاف الاستخدام الكاميرا/NFC في iOS Info.plist (كانت ستنهار عند التشغيل).
2. **P0 (نزاهة GL):** مسار `add-stock` legacy لم يكن يرحّل قيدًا — الرصيد الدفتري للمخزون كان ينحرف عن ميزان المراجعة. الآن `postGl: true` (Dr INVENTORY / Cr INVENTORY_ADJUSTMENT_INCOME).
3. **P1 (حماية WIP):** إلغاء أمر تشغيل داخل مسار عمل نشط كان يترك قيود WIP/الخامات بلا عكس. الآن `CANCELLED` من PLANNED فقط + فحص دفاعي (سجل مراحل/استهلاك) → 409.
4. **P1 (GF-0004 شامل):** ParseUUIDPipe على **كل** معاملات المسار (19 معاملًا في 6 متحكمات: sales/hr/shipping/purchasing/suppliers/users/accounting) — UUID غير صالح كان يرد 500 عبر PrismaClientValidationError.
5. **P1 (فهارس):** هجرة `20260909000000_audit_gap_indexes`: `purchase_orders(status,createdAt)` (تعادل sales_orders)، `customer_payments(customerId,date)`، `supplier_payments(supplierId,date)`، `bom_lines(rawMaterialId)` (آخر FK غير مفهرس)، `activity_logs(module,createdAt)`، `shipments(status,createdAt)`، `products(createdAt)`، `work_orders(createdAt)` — مصرّح بها كذلك في schema.prisma (بوابة drift خضراء).
6. **P0 (أمان الجوال):** حماية أدوار على مستوى الموجّه — ملف `core/security/route_access.dart` (مرآة سياسات @Roles الخادمية) + redirect للمسارات المقيَّدة + تصفية درج التنقل من مصدر واحد. كان أي مستخدم موثّق يصل `/users` أو `/accounting` عبر deep-link.
7. **P1 (البذرة):** قيد افتتاحي `JE-SEED-OPENING-001` (Dr INVENTORY / Cr OWNERS_EQUITY = 7,005 EGP) — الدفتر كان يبدأ صفرًا بينما المخزون غير صفري. + تمويل خزينة اختياري `SEED_TREASURY_OPENING` (Dr CASH / Cr OWNERS_EQUITY) يحل مشكلة رفض أول صرف (رصيد سالب ممنوع). مُتحقق: تشغيل بذرة مزدوج ناجح والقيد متوازن (7005/7005).
8. **P1 (الوثائق):** API_CONTRACT.md مُزامَن بالكامل: ~27 مسارًا غير موثق أُضيفت + تصحيح 4 انحرافات سلوكية (قيود دفع الرواتب SALARIES_PAYABLE، انتقال PREPARING→CANCELLED، أدوار الجودة QLT-6، أدوار دفع الرواتب مع SoD).

**البوابات (الفرع):** tsc 0 / lint 0 / format ✓ / **772 unit (49 suite)** / 64 e2e / **45 integration على PostgreSQL 16** / **flutter analyze 0 + 276 test** / **prisma migrate diff = No difference** / seed idempotent (تشغيل مزدوج) — كلها خضراء.

**أبرز المتبقي (خارج نطاق هذه الجولة — مرتّب):** (1) اختبارات integration لوحدة المبيعات على PG حقيقي، (2) CRUD شركات الشحن + تنظيف 4 نماذج ميتة، (3) تفعيل أحداث الأعمال الأخرى (WORK_ORDER_COMPLETED/SALES_ORDER_PAID...)، (4) مسارات تحديث ناقصة (PATCH /hr/workers/:id، PATCH /products/:id، قراءة ActivityLog)، (5) توحيد شكل pagination، (6) عكس آثار أخرى موصى بها في تقرير التدقيق، (7) تقارير مالية إضافية (P&L/أعمار الذمم)، (8) الجوال: CRUD الموردين/تحرير العملاء/void البيع، تقارير حقيقية (الشاشة الحالية نسخة من اللوحة)، تمرير الصفحات (limit=100 حاليًا)، طباعة الفواتير (pdf/printing معلنان بلا استخدام).

---

## تحديث خطة التحسينات المعتمدة — الموجة الثالثة GF-IMP-W3 (2026-09-06) — اكتمال الخطة

**الموجة الثالثة GF-IMP-W3 — الميزات والنضج (54 بندًا، منها 50 منفذة بالكود و2 منجزتان مبكرًا):** منفذة على فرع `imp/gf-imp-w3-features-maturity` عبر 5 وكلاء متوازيين + عمل مركزي:

- **السطح المحاسبي (W3-A — 14 بندًا):** ACC-8 (ثلاث نقاط قراءة: قائمة قيود بفلاتر، كشف حساب برصيد تراكمي، **ميزان مراجعة** بتحقق توازن)، ACC-4 (تداخل الفترات داخل المعاملة)، ACC-5 (CASHIER يقرأ السندات)، ACC-6 (فلاتر السندات)، ACC-7 (تحديث أرصدة الحسابات ببيان واحد خام — أصلح عيبًا قاتلًا في SQL المسودة تحقق منه على PG16 فعليًا)، ACC-10 (سقف 500 بند)، HR-4 (تسوية صافي الصفر بلا نقد)، HR-5 (SoD الدفع + CASHIER/ACCOUNTANT)، HR-6 (قراءات الرواتب/السلف/الإنتاج + إبطال المسودة)، HR-7 (Decimal في الإنتاجية)، HR-8 (تحذير حضور + قصر بيانات الهوية)، SAL-5 (فلاتر وإسقاط نحيف)، SAL-7 (**إبطال أمر مؤكد**: عكس قيد التأكيد + إعادة المخزون + CAS)، SAL-8 (تغطية replay).
- **التجارة والقوائم (W3-B — 6):** CC-6 (قالب ListQuery/ListResponse موحد)، SHP-5 (إسقاط الشحنات بلا تسريب عملاء)، SHP-6 (idempotency تحديث حالة الشحنة)، PUR-6 (فلاتر + paidAmount تراكمي)، PUR-7 (موردون: تحديث/تعطيل/تنشيط بـ CAS وتدقيق)، PUR-8 (اختبارات الثقوب الأربعة).
- **الإنتاج والمخزون والجودة (W3-C — 15):** QLT-2 (**هجرة نوع العمود stage إلى ProductionStage** بخريطة ترجمة مختبرة على 9 قيم تراثية حقيقية)، QLT-4/5/6، PRD-6 (تحذير استمرارية الكميات)، PRD-7 (فلاتر أوامر التشغيل)، PRD-8 (دمج دوال replay الثلاث)، PROD-4 (**إصدار BOM جديد عند التعديل الجوهري** — لا تعديل في مكان)، PROD-6 (تدقيق الكتالوج)، PROD-7، INV-6/7، INV-8 (**حركة إرجاع صريحة + هدر بضاعة جاهزة** بقيود GL — ADR-0020)، INV-9/10.
- **المصادقة واللوحة والبنية (W3-D — 10):** AUTH-6 (رفض توكنات بلا v)، AUTH-7 (قناة زمنية مقفلة بتجزئة وهمية)، AUTH-8 (تغطية jwt.strategy)، DSH-3 (اختزال 60 ثانية)، DSH-4 (نهاية اليوم لا تُبتلع)، DSH-5 (netOfTax + خصم المرتجعات + عد مميز)، INF-3 (engines + .nvmrc)، INF-6 (**وصل OriginCheckGuard عالميًا** — يعفي الجوال ويحمي المتصفحات)، INF-7 (**بذرة idempotent كاملة + خزينة افتراضية** — تحقق تشغيل مزدوج ناجح)، CC-7 (مخزن Redis اختياري لحدود المعدل بfallback ذاكرة).
- **الجوال (W3-E — 5):** MOB-3 (**offline فعلي**: كاش Hive قراءة + **طابور كتابة صادر** بمفاتيح idempotency يُرسل تلقائيًا عند عودة الاتصال)، MOB-4 (NFC حقيقي عبر nfc_manager مربوط بشاشة العمال)، MOB-6 (عربية فقط بصدق)، MOB-7 (تغطية المعالجات والـ cubits)، MOB-8 (شاشات الرواتب والسلف والإنتاج للعامل).

**الحالة النهائية للخطة (112 بندًا):** 110 منفذة بالكود (13 P0 + 47 P1 + 50 P2) + بنود منجزة مبكرًا ضمن غيرها (SAL-6 ضمن CC-3 وSHP-7 ضمن INF-8) — **بنود الكود كلها مكتملة**. المتبقي الوحيد: بندي CI يحتاجان نطاق workflow في التوكن (INF-2 + INF-5/CC-10 للتغطية) — محفوظان باتش شامل جاهز للمالك في `download/CI-COMPLETE-PATCH.patch`.

**البوابات (الفرع):** typecheck/lint/build/format + 763 unit (49 suite) + 64 e2e + 45 integration (38 هجرة على PostgreSQL 16) + 167 Flutter — كلها خضراء.

---

## تحديث خطة التحسينات المعتمدة — الموجتان الأولى والثانية GF-IMP-W1/W2 (2026-09-06)

**الاعتماد:** وثيقة «خطة التحسينات الشاملة» (112 بندًا: 13 P0 / 47 P1 / 52 P2 عبر 13 نطاقًا + 10 بنود عابرة) اعتُمدت بالكامل من المالك بتنفيذ مرتب الموجات.

**الموجة الأولى GF-IMP-W1 — تصفير بنود P0 الثلاثة عشر (PR #79):** دُمجت `imp/gf-imp-w1-p0-integrity` (squash `c1995d3`) بـ CI أخضر بالوظائف الأربع. المنفذ: HR-1 (قيد دفع الرواتب Dr SALARIES_PAYABLE/Cr CASH/Cr WORKER_ADVANCES — المستحقات تصفر والمصروف مرة واحدة)، ACC-1 (مصفوفة الحساب المقابل للسندات: WORKER→سلف العمال، نثري→مصروف عام)، SAL-1 (قفل FOR UPDATE لصفوف العملاء في محرك الترحيل)، SHP-1 (قلب أمر البيع إلى SHIPPED داخل معاملة الشحن + فهرس فريد جزئي `shipments_active_per_order_unique` ضد الشحن المزدوج — هجرة `20260906000000`)، PRD-1 (رفض صرف المواد على أوامر COMPLETED/CANCELLED)، PUR-1/PUR-2 (تحقق DTO صارم وكميات استلام كسرية حتى 4 منازل)، QLT-1 (ترحيل هدر الجودة Dr WASTE_EXPENSE/Cr WIP داخل معاملة الفحص)، AUTH-1 (افتراضي JWT 30m بدل 7d)، AUTH-2 (دوران الرمز المنعش ذريًّا بمعاملة واحدة وتحديث شرطي)، INV-1 (أحداث المخزون تُجمع وتُبث بعد commit المعاملة الأم)، PROD-1 (حذف بند BOM→404 + تحويل مركزي P2025→404/P2003→400/P2002→409)، CC-1 (trust proxy=1 + req.ip). **بوابة الموجة:** اختبار تكامل جديد `accounting-integrity.integration-spec` — 5 تحققات توازن على journal_lines بعد دورة رواتب كاملة (المدين=الدائن، SALARIES_PAYABLE تصفر، المصروف بالإجمالي مرة واحدة، السلف تُخفض، الخزينة بالصافي). إصلاح كامن إضافي: recordAdvance ينشئ صف مفتاح idempotency قبل التأثير. البوابات: 364 unit + 64 e2e + 38 integration كلها خضراء.

**الموجة الثانية GF-IMP-W2 — الصلابة والعدالة (44 بند P1):** منفذة على فرع `imp/gf-imp-w2-robustness` عبر 6 وكلاء متوازيين + عمل مركزي. أبرز المنفذ:
- **الجلسات والجوال (W2-1):** AUTH-3 (إبطال عائلة الجلسة عند إعادة استخدام رمز ملغى + رفع jwtVersion + ActivityLog أمني)، AUTH-4 (قفل حساب 5 محاولات/15 دقيقة + تدقيق النجاح والفشل)، AUTH-5 (إعادة محاولة فقط عند P2002 بحد 3)، MOB-1 (تخزين refresh_token + معالج 401 شفاف بmutex ومزامنة التوكنين)، MOB-2 (logout يستدعي إبطال الخادم بأفضل جهد)، MOB-5 (HTTPS افتراضيًا نحو Railway).
- **العدالة المحاسبية (W2-2a):** HR-2 (عمود settled_amount + توزيع خصم FIFO داخل معاملة الدفع — السلفة لا تُخصم مرتين)، HR-3 (رفض تداخل فترات الرواتب 409)، ACC-2 (لقطة تأثيرات جانبية في metadata كل قيد + عكس يعيد أرصدة الخزائن/العملاء/الموردين + حظر عكس قيد بلا أثر موثق)، ACC-3 (الترحيلات الآلية تحل الفترة المفتوحة بتاريخ القيد وتُرفض خارجها — الإقفال أصبح فعليًّا)، CC-5 (قائمة فحص مراجعة PR `docs/REVIEW_CHECKLIST.md`).
- **العدالة التجارية (W2-2b):** SAL-2/3/4 (تدقيق التأكيد/الإلغاء/المرتجع + COGS لكل بند من metadata قيد التأكيد + ضريبة مرتجع بنسبة الخصم + SoD تأكيد + سند قبض آلي للبيع الفوري)، PUR-3/4/5 (idempotency إنشاء أمر الشراء + كود مرتجع مستقر وتدقيق + اعتماد DRAFT→APPROVED بـ SoD وبوابة استلام + مسار إلغاء للمسودات)، SHP-2 (محقق مسبقًا من SHP-1)، SHP-3 (RETURNED يتطلب مرتجعًا مقترنًا + إلغاء PREPARING كامل: عكس قيد التكلفة وإعادة الأمر إلى CONFIRMED)، SHP-4 (توحيد شكل استجابة إعادة التشغيل)، QLT-3 (فلاتر قائمة الفحوص).
- **صحة الإنتاج والمخزون (W2-3/W2-4):** PRD-2 (updateOrderStatus داخل معاملة بـ CAS وتدقيق بالفاعل)، PRD-3 (قفل FOR UPDATE في transitionStage + P2002→409 + فحص replay تحت القفل)، PRD-4 (إكمال صفر-الإنتاجية صراحة — لا أمر يعلق IN_PROGRESS)، PRD-5 (Decimal في سلسلة الترحيل بلا toNumber)، PRD-9 (اختبارات وحدة للمسارات السعيدة لآلة الحالة)، PROD-2/3/5 (تطبيع المدخلات + فحص الموسم + تغطية BOM)، INV-2 (إخفاء التكلفة عن الأدوار غير المالية + قصر الدفتر المالي)، INV-3 (حلقة تسلسلية بدل Promise.all + توحيد أحداث bulk)، INV-4 (حدود الدقة العشرية)، INV-5 (عد النقص من total بلا 10000 صف)، CC-8 (أحداث بعد commit + أول مستمع حقيقي STOCK_LOW يكتب ActivityLog).
- **البنية والأدوات (مركزي + W2-B):** CC-9 (موديول users كامل بـ SUPER_ADMIN: إنشاء/تغيير دور/تعطيل/تنشيط بـ SoD وتدقيق وidempotency — نهاية SQL اليدوي للهويات)، CC-3 (أداة مال موحدة money.util بنصف-لأعلى EPSILON)، CC-4 (فحص تغطية idempotency: 45 مسار كتابة كلها محمية — `npm run check:idempotency`)، DSH-1 (قصر لوحة المؤشرات على الإدارة/المحاسبة)، DSH-2 (فهارس date وworkerId+date)، INF-1 (تقييم مخاطر mysql2 موثق في SECURITY_BASELINE — ثغرة ورقية: المحول PostgreSQL)، INF-8 (مواءمة علاقة تنظيف الشحنات SetNull).

**الهجرة الموحدة `20260906100000_wave2_unified`:** settled_amount للسلف + فهارس التاريخ (سلف/إنتاج/مركب) + APPROVED للشراء + CANCELLED للشحن + SetNull لعلاقة الشحنة — كلها idempotent ومختبرة على قاعدة نظيفة. **البذرة تزرع الآن فترة مالية مفتوحة للسنة الجارية** (شرط ACC-3 — بلاها يُرفض أول ترحيل آلي).

**بنود مؤجلة عمدًا إلى الموجة الثالثة (بقرار الخطة):** MOB-3 (offline كتابة فعلي) وPUR-8 (اختبارات الثقوب بعد سياساتها). **INF-2 معلق على نطاق workflow في PAT:** باتش جاهز في `download/INF-2-ci-triggers.patch` — CI يعمل للفروع عبر مسار pull_request.

**البوابات (الفرع):** typecheck/lint/build/format + 538 unit (44 suite) + 64 e2e + 45 integration (9 suites على PostgreSQL 16) + 75 Flutter — كلها خضراء.

---

## تحديث الموجة 8 — الدمج، الإنتاج المباشر، وoffline (2026-09-05/06)

**إغلاق GF-REMAINING-010 (الموجة 7):** فرع `fix/uat-remediation-wave7-p0` اكتمل بـ commit رابع إضافي (`d052042` — إصلاح 33 اختبار تكامل كانت كامنة: SoD برواتب payroll بنفس الفاعل، واعتماد accounts مُزروعة بمigration في production-workflow) ثم دُمج عبر PR #77 (`d6ad465`). النتيجة على `main`: **CI أخضر** للمرة الأولى منذ 2026-08-28 — تشغيل `33963217026` نجح بوظائفه الأربع (Flutter Analyze/Test، Performance — Dashboard baseline بما فيها خطوة Seed سابقًا الفاشلة، Backend Prisma/Lint/Build/Unit/E2E/Integration، Secret Scan). إصلاح انحراف schema نهائي على main.

**الإنتاج على Railway (أول نشر ناجح):** خدمة `garment-factory-erp` (المشروع `fulfilling-serenity`) نُشرت من `main@d6ad465` بنجاح (deployment `14c219e8`): `preDeployCommand` طبّق migrations، والتطبيق أقلع بـ 73 مسارًا و`NODE_ENV=production`. أُجري seed لمرة واحدة عبر commit مؤقت (`b2fcea2`) يضيف `prisma db seed` إلى preDeploy ثم رُدّ فورًا (`ca067da`) لأن الـ seed غير idempotent — كلمة مرور admin الأولية مضبوطة كمتغير بيئة `SEED_ADMIN_PASSWORD` على الخدمة (لا تُخزن في Git). السجل يوثق اكتمال الـ seed: المخازن، الخامات برصيد ledger، المنتجات وBOM، أمر عمل، العمال، 19 حسابًا محاسبيًا، وعملتين.

**تحقق الإنتاج المباشر (2026-09-05):** على `https://garment-factory-erp-production.up.railway.app`: `/health` و`/health/ready` (database: ok) — 200؛ `POST /auth/login` ببيانات admin المُبذرة — 200 مع tokens؛ `GET /dashboard/stats` — 200 ببيانات فعلية؛ دورة SEC-F04 كاملة: refresh rotation 200، logout 200، الـ access tokens القديمة والمدوّرة كلاهما 401 بعد logout (jwtVersion revocation)، وإعادة استخدام الـ refresh token القديم والمدوّر كلاهما 401. الإنتاج الآن صالح لـ UAT فعلي وفق `docs/UAT_SCENARIOS.md`.

**تنفيذ GF-REMAINING-008 (offline + barcode):** كانت `BarcodeScannerScreen` (mobile_scanner) موجودة لكن غير موصولة بأي شاشة، ولا حزمة connectivity في المشروع، والمخزون يعرض انقطاع الشبكة كخطأ عام. المنفذ:

- `core/services/connectivity_service.dart` (جديد): `ConnectivityService` فوق `connectivity_plus` يبثّ حالة الاتصال مع تدهور آمن (فشل قراءة المنصة ⇒ افتراض متصل، والتصنيف النهائي يبقى لطبقة الشبكة).
- `core/widgets/offline_banner.dart` (جديد): شريط "أنت غير متصل" يلتفّ عبر `MaterialApp.builder` فيظهر على كل الشاشات ويختفي تلقائيًا عند عودة الاتصال — قابل للحقن في الاختبارات.
- `ApiClient.isNetworkError` (جديد): مصنّف مشترك لأخطاء connection/timeout يميّزها عن 4xx/5xx — يطابق تصنيف `ProductionNetworkFailure` ويوحّد المنطق.
- `InventoryOffline` (حالة جديدة) + `AppOfflineView` في `app_feedback.dart`: شاشة "لا يوجد اتصال" مخصصة مع إعادة محاولة، منفصلة عن `AppErrorView`.
- سلك الماسح في شاشة المخزون: زر `qr_code_scanner` بجانب البحث يفتح `BarcodeScannerScreen` الحقيقي عبر `BarcodeScannerLauncher` (قابل للحقن) ويرجع الـ SKU فيملأ البحث ويصفّي القائمة؛ الإلغاء لا يغيّر شيئًا.
- الاختبارات: 22 اختبارًا جديدًا (مصنّف الأخطاء، الشريط بكل انتقالاته، cubit بالمخزون بحقن Dio يحلّ/يرفض، والشاشة بكل حالات loading/loaded/empty/offline/error + سلك الماسح وحالة الإلغاء) — السuite كاملة **55/55 ناجحة** و`flutter analyze` نظيف محليًا على Flutter 3.47.2.

## تحديث الموجة 7 — إصلاح P0 (2026-09-05)

كشف فحص شامل أُجري في 2026-09-05 أن `main` دُمجت فيه موجات UAT كاملة بـ CI أحمر، وأن آخر 8 تشغيلات CI على `main` فاشلة منذ 2026-08-28 (تحقق مباشر عبر GitHub Actions API؛ آخر تشغيل `33214907002` على `main@e72ee94` — فشل). وظيفتا CI الفاشلتان: E2E tests ووظيفة Performance التي تتوقف عند خطوة Seed. الموجات المعنية: موجة 1-3 عبر PR #73، الموجة 4 عبر PR #74، الموجة 5 عبر PR #75، الموجة 6 عبر PR #76.

**السبب الجذري — انحراف schema في الموجة 4 (P0):** migration `20260902000000_wave4_sec_f04_refresh_tokens` أنشأ `users.jwt_version` وجدول `refresh_tokens` بأعمدة snake_case، بينما `schema.prisma` صرّح بـ camelCase بلا `@map`. النتيجة: خطأ Prisma `P2022` على كل استعلام يمس User أو RefreshToken — رسالة الفشل الفعلية المسجلة: `The column users.jwtVersion does not exist in the current database`. الأثر:

- تسجيل الدخول نفسه معطل (500) على أي قاعدة تُبنى من migrations — أُعيد إنتاج الفشل محليًا على PostgreSQL 16 ثم أُعيد التحقق من الإصلاح.
- seed يفشل، ومن ثم تفشل خطوة Seed في وظيفة Performance.
- آلية SEC-F04 (JWT refresh + revoke) غير قابلة للتشغيل على قاعدة حقيقية لأن جدول `refresh_tokens` نفسه غير قابل للاستعلام.

**الاختباران E2E الفاشلان (62/64 قبل الإصلاح):** فشل اختبار auth-guard عند تسجيل سلفة (500) لأن mock الاختبار لم يُحدَّث بنموذج worker الذي أضافته الموجة 5، وفشل اختبار production-workflow عند وسيط idempotency الثالث في finalizeCost لأن assertion ظل على سلوك ما قبل RES-F02. كلاهما عيب في الاختبار لا في المسار التشغيلي.

**الإصلاح المنفذ على فرع `fix/uat-remediation-wave7-p0`** (غير مدمج — ينتظر مراجعة PR وCI):

1. إضافة `@map` في `schema.prisma` لـ `User.jwtVersion` ولكل حقول `RefreshToken` لتطابق بنية القاعدة القائمة. لا migration جديد لأن بنية القاعدة صحيحة أصلًا والخطأ كان في تصريحات النموذج فقط؛ إضافة migration كانت ستفاقم الانحراف.
2. إصلاح اختباري E2E: mock نموذج worker المفقود وتحديث assertion وسيط idempotency وفق RES-F02.
3. تُوثَّق بالتوازي خطة النسخ الاحتياطي وسيناريوهات UAT في `docs/runbooks/BACKUP_RESTORE.md` و`docs/UAT_SCENARIOS.md` (بطاقة الوكيل المعني، لا تُعد مكتملة قبل دمجها).

**نتائج التحقق المحلي على الفرع (2026-09-05):** `typecheck` و`lint` و`build` و`prisma validate` ناجحة؛ unit tests 36 suites / 302 tests ناجحة؛ E2E 3 suites / 64 tests ناجحة؛ `prisma migrate deploy` ثم `prisma db seed` ناجحان على قاعدة PostgreSQL 16 نظيفة (إعادة إنتاج خطوة Seed الفاشلة في CI)؛ و`POST /auth/login` يرجع 200 مع إدراج سجل في `refresh_tokens` على قاعدة مبنية من migrations (قبل الإصلاح: 500/P2022 على نفس القاعدة). لا يثبت ذلك نجاح CI على GitHub — الفحص النهائي مسؤولية تشغيل PR.

يبقى فحص قاعدة Railway الإنتاجية مطلوبًا بعد الدمج لأنها قد تكون متأثرة بنفس الانحراف إذا طُبقت عليها migrations الموجة 4-6.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الأساسي المرجعي | `origin/main` |
| آخر commit على main | `dad5080` — UI-COMPLETE: ترحيل آخر 7 شاشات إلى الهيكل الموحد SelimShellScaffold (#95) بتاريخ 2026-09-14؛ يليه `54f770d` (Merge #94 — توحيد الواجهة) |
| Pull Requests الأخيرة | #79-#81 (GF-IMP W1-W3)، #82-#85 (جاهزية UAT والتدقيق)، #86-#92 (محاكاة Selim الموجات 1-5 + زر الرجوع + توثيق البناء)، **#93 (بروفة الاستعادة + إصلاح عيبَي DR)، #94 (توحيد الواجهة: 12 شاشة + دخول + سكيلتون)، #95 (UI-COMPLETE: آخر 7 شاشات — 41/42 على الهيكل الموحد)** كلها مدمجة بـ CI أخضر؛ لا يُدمج PR جديد قبل CI أخضر وموافقة المالك |
| آخر مرحلة مكتملة بالكامل على main | محاكاة Selim ERP كاملة (5 موجات) + بناء v1.6.0-uat + بروفة الاستعادة مع إصلاح عيبَي DR (2026-09-14) + **اكتمال توحيد الواجهة: 41/42 شاشة على الهيكل الموحد مع دعم bottom (TabBar) وbottomBar (شريط الإجماليات اللزج)** (2026-09-14) |
| حالة CI على main | **خضراء** — متحقق منها مباشرة عبر GitHub API بعد دمج #95 (2026-09-14: Flutter Analyze/Test + Backend + Performance + Secret Scan كلها success) |
| حالة قاعدة البيانات | **43 migration** (بما فيها موجات Selim 1/3/4) تطبق عبر preDeploy؛ الـ seed نُفّذ مرة واحدة (نسخة قديمة — راجع اكتشاف القيد الافتتاحي أعلاه) |
| الإنتاج (Railway) | `garment-factory-erp-production.up.railway.app` — health/ready 200 وlogin 200 متحقق منهما مباشرة 2026-09-14 |
| إصدار API | `1.0`؛ 24+ وحدة (بعد موجات Selim) — 76 جدولًا في القاعدة |
| الإصدار | `pre-release`؛ مطلق لـ UAT/pilot على Railway، غير معتمد لتشغيل مؤسسي رسمي |
| المهمة النشطة | GF-REMAINING-009: المتبقي فقط بروفة pg_dump (تتطلب وصول DB من المالك) + UAT الميداني 16/16 على جهاز Android فعلي + monitoring + قرار Go/No-Go — مهمة «مراجعة وتطوير واجهة المستخدم» اكتملت بالكامل (41/42 شاشة موحدة، 2026-09-14) |
| المرحلة النشطة | ما بعد محاكاة Selim الكاملة وبناء v1.6.0-uat؛ GF-REMAINING-009 (UAT الميداني + pg_dump بروفة + monitoring + Go/No-Go) |
| سبب عدم الإغلاق النهائي | UAT ميداني 16/16 على جهاز Android فعلي، بروفة pg_dump (تحتاج وصول DB من المالك)، توقيع APK إنتاجي (keystore)، القيد الافتتاحي في الإنتاج، وقرار إطلاق المالك (G10/G11) |
| Security blockers | لا أسرار في المستودع (SEED_ADMIN_PASSWORD متغير بيئة على Railway فقط)؛ `npm audit`: أُغلقت ثغرتا qs، والمتبقي سلسلة mysql2 داخل Prisma (مؤجل بقرار MASTER_BACKLOG) |
| Open decisions | قرار ثغرتي mysql2 داخل Prisma؛ نطاق/توقيت UAT الفعلي؛ آلية توقيع APK (keystore) |
| Last handoff | سلسلة موجات Selim موثقة في `docs/SELIM_REPLICATION.md` (الأقسام 1-6)؛ آخر PR توثيقي #92 |
| Next exact action | دمج `fix/backup-restore-dr-gate` (بروفة الاستعادة) ثم: تنفيذ UAT الميداني على جهاز Android فعلي بقاعدة الإنتاج وفق docs/UAT_SCENARIOS.md |

## المهام المكتملة على main

| المهمة | الوصف | الحالة |
|---|---|---|
| GF-0001..GF-0006 | الحوكمة، fail-closed auth، DTOs، الاختبارات، الأسرار وCI | مكتملة وموجودة في التاريخ |
| GF-0007 | Warehouse، Stock Ledger، idempotency، indexes ومنع الرصيد السالب | مكتملة |
| GF-0008 | BOM versioning، ربط WorkOrder بالـSKU، واستهلاك الخامات داخل transaction | مكتملة |
| GF-0009 | Purchasing Module، أوامر الشراء، الاستلام والمرتجعات عبر InventoryService | مكتملة ومُدمجة |
| GF-0010 | Flutter secure storage، Authorization interceptor، 401، logout، إزالة mock، Flutter CI | مكتملة ومُدمجة |
| GF-0011 | المبيعات: منع البيع فوق المتاح وحساب الإجماليات على الخادم وتأمين الخصم | مكتملة |
| GF-0012 | Pagination موحد لكل القوائم مع data/meta وقيود page/limit | مكتملة |
| GF-0013 | مراحل الإنتاج، stage runs، المخرجات، الاستهلاك، التكلفة، وposting المنتج التام | مدمجة على main؛ تحتاج متابعة UI/اختبارات تشغيلية لاحقة |
| GF-0014 | الجودة والهالك وربط stageRun وKPI | مكتملة ومُدمجة عبر PR #25؛ migration وCI PostgreSQL ناجحان |
| GF-0015 | attendance endpoint + payroll | مكتملة ومُدمجة عبر PR #24 و#30؛ CI أخضر |
| GF-0016 | receipt idempotency وربط الاستلام بالـledger | مكتملة ومُدمجة عبر PR #27 و#31؛ CI PostgreSQL أخضر |
| GF-0017 | shipment lifecycle وproof of delivery وactor audit | مكتملة ومُدمجة عبر PR #29 و#33؛ CI PostgreSQL أخضر |
| GF-0018 | fiscal periods وقيود متعددة البنود ومنع الترحيل المغلق | مكتملة ومُدمجة عبر PR #32 و#36؛ CI PostgreSQL أخضر |
| GF-0019 | صرف المنتج التام عند SHIPPED وحماية إنشاء الشحنة من التكرار | مكتملة ومُدمجة عبر PR #35 و#39؛ migration وCI PostgreSQL أخضران |
| GF-0020 | GRN/AP — ترحيل إيصالات الشراء إلى الحسابات الدائنة | مكتملة وموجودة على main عبر PR #55 |

## GF-0014 — الحالة التفصيلية

تضيف المرحلة فحصًا نهائيًا واحدًا مرتبطًا بـ`ProductionStageRun` مكتمل. يفرض الخادم وقاعدة البيانات الكميات غير السالبة وقاعدة `checkedQty = passedQty + rejectedQty + wasteQty`، ويفصل الرفض عن الهالك المصنف، ويحسب `wasteCost` من تكلفة الخادم. تُسجل هوية actor وActivityLog ويدعم المسار `Idempotency-Key`، ولا يوجد تعديل مباشر لفحص مكتمل.

يضيف `GET /quality/kpis` تجميعًا حقيقيًا من `QualityCheck` بحالات `COMPLETED` فقط، مع مرشحات المرحلة وأمر التشغيل والفترة، وإرجاع totals وpass/rejection/waste rates. لا تكتب المرحلة مخزونًا أو قيودًا محاسبية.

السياسة المعتمدة في ADR-0014 هي رفض `PENDING` و`IN_PROGRESS` و`CANCELLED`، وقيد فريد على `stageRunId` غير الفارغ لمنع الفحص المكرر لنفس تنفيذ المرحلة. الصفوف التاريخية legacy تبقى قابلة للقراءة وحقول الربط الجديدة nullable.

## دليل التحقق المحلي لـGF-0014

| الفحص | النتيجة |
|---|---|
| `npx prisma validate` | PASS |
| `npx prisma generate` | PASS — Prisma Client 7.9.1 |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| Unit tests | PASS — 27 suites / 144 tests |
| E2E tests | PASS — 3 suites / 46 tests، وتشمل 401 لمسار KPI |
| Integration محليًا | NOT RUN — 2 suites / 14 tests skipped لغياب `GF_INTEGRATION_DATABASE_URL` وDocker؛ CI PASS في Run `32926745698` |
| Migration deploy محليًا | NOT RUN — CI PASS على PostgreSQL 16 في Run `32926745698` |
| Flutter analyze/test | CI PASS في Run `32926745698`; لم تُشغّل محليًا |
| Secret Scan | PASS — نفس patterns الخاصة بـCI |
| `git diff --check` | PASS قبل توثيق الحالة؛ يجب إعادة تشغيله قبل push |

## الفجوات والقيود المعروفة

1. تم دمج GF-0014 إلى GF-0018 في PRs مستقلة (#25، #30، #31، #33، #36)، ونجح CI النهائي على `main@5dfa0fe` بما في ذلك migrations وPostgreSQL integration.
2. أثبت Run `32926745698` تطبيق migration على PostgreSQL نظيفة وتشغيل integration؛ لا تزال قاعدة بيانات production غير موجودة ضمن المشروع.
3. اختبارات E2E الحالية mock-backed، وتظل اختبارات PostgreSQL التكاملية المرجع لمسار البيانات الحقيقي.
4. لا توجد بعد آلية adjustment/reversal لفحص مكتمل؛ أي تصحيح يجب أن يكون مهمة مستقلة مع audit trail.
5. GF-0015 إلى GF-0018 مكتملة ضمن النطاق المنفذ، لكن ذلك لا يعني الجاهزية المؤسسية: لا تزال UAT، backup/restore، monitoring، Flutter workflows، وربط posting التجاري/الرواتب بالمحاسبة الآلية خارج هذه الشرائح.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة، ولا يُعتبر PR مدمجًا قبل تنفيذ الدمج والتحقق من CI على `main`.

## آخر تحديث توثيقي

**مزامنة 2026-09-15 (فوق `main@dad5080`):** حُدّث جدول «الحالة الحالية» ليعكس دمج PR #93 (بروفة الاستعادة + إصلاح عيبَي DR — موثقة PASS في `docs/runbooks/BACKUP_RESTORE.md` §5) وPR #94 + PR #95 (توحيد واجهة المستخدم كاملًا — 41/42 شاشة على `SelimShellScaffold` مع دعم `bottom`/`bottomBar` في الهيكل، CI أخضر). كما صُحّح بند GF-REMAINING-001 في `MASTER_BACKLOG.md` (كان «تنتظر PR/CI» رغم دمجه عبر PR #48 منذ زمن). لا يزال الإصدار `pre-release`: المتبقي على مسار GF-REMAINING-009 هو بروفة pg_dump (بيد المالك) + UAT الميداني + monitoring + قرار Go/No-Go.

**سجل المزامنة السابقة:** تم تحديث هذا الملف على فرع `docs/post-merge-release-state` فوق `main@e32f745` بعد دمج PR #57 وPR #58. Run `32950963418` أخضر وحقق Backend وPostgreSQL integration وE2E وFlutter وSecret Scan.

## سجل التنفيذ الشامل — 2026-08-27

على فرع `feat/sprint1-navigation-ux` تم تنفيذ شرائح إضافية فوق Sprint 1: Supplier وWorker master-data APIs مع RBAC، ربط Contact Picker بنماذج العميل والمورد والعامل مع شاشة مراجعة، دورة المبيعات والتحصيل والإلغاء والمرتجعات، دورة الشحن، أوامر الشراء والاستلام، فحص الجودة والهالك، الخزائن والسندات المحاسبية، وتوحيد حالات UX وإصلاح الانتظار غير المتزامن في تسجيل إنتاج العامل.

نتائج بوابات التحقق الأخيرة: Flutter analyze و29 اختبار Flutter وAndroid Debug APK ناجحة؛ Backend Prisma generate وformat وtypecheck وbuild ناجحة؛ 35 suite و241 unit tests ناجحة؛ و3 E2E suites و64 اختبارًا ناجحة. توجد 6 تحذيرات lint قديمة فقط في payroll/inventory specs، ولا توجد أخطاء lint. لم تُشغّل PostgreSQL integration محليًا لغياب `GF_INTEGRATION_DATABASE_URL`، ولم يُنفذ قبول على جهاز Android فعلي أو iOS build في بيئة Linux.

لم تُرفع commits ما بعد `b868087` إلى GitHub حتى الآن، ولم يتم دمج أي تعديل في `main`. يبقى الإصدار `pre-release` إلى أن تُغلق مراجعة الأسرار، وUAT، وsigning/release build، وخطة backup/restore وmonitoring، ثم تُرفع النسخة النهائية ويُراجع CI قبل الدمج.
