# HANDOFF — التدقيق الشامل ثلاثي المحاور + إصلاحات P0/P1 (audit-full)

> **التاريخ:** 2026-09-12 · **الفرع:** `fix/audit-full-p0` · **القاعدة:** `main@7de1666` (CI أخضر)
> **النمط:** تدقيق قراءة كامل عبر 3 وكلاء متوازين (خلفية/جوال/قاعدة بيانات) + إصلاح فوري لكل ما هو P0/P1 + تحقق مركزي بالبوابات.

---

## 1. الاكتشاف بالأدلة

### منهجية التدقيق

- **الخلفية:** قراءة كل المتحكمات/الخدمات/الاختبارات (13 موديولًا، 73+ مسارًا) ومقارنتها بعقد API_CONTRACT.md وبتغطية GL لكل تدفق أعمال.
- **الجوال:** قراءة الموجّه والـ 14 ميزة (17 مسارًا، 8 أدوار) ومطابقة كل endpoint مستدعى مقابل المتحكمات، وفحص صلاحيات المنصات (AndroidManifest/Info.plist)، وتغطية الحالات والاختبارات.
- **قاعدة البيانات:** قراءة schema.prisma (1,403 سطرًا) وكل الـ 39 هجرة، ثم **تحقق حي**: تطبيق كل الهجرات على PostgreSQL نظيفة وتشغيل بوابة CI نفسها `prisma migrate diff --from-config-datasource --to-schema` → **"No difference detected"** (صفر انحراف).

### الجدول التشخيصي (قبل الإصلاح)

| # | الخطأ | المحور | الخطورة | الدليل |
|---|---|---|---|---|
| 1 | AndroidManifest الرئيسي بلا `INTERNET` — release بلا شبكة إطلاقًا | جوال | **P0 قاتل** | الصلاحية موجودة فقط في debug/profile manifests |
| 2 | `add-stock` بلا قيد GL — ميزان المراجعة ينحرف عن قيمة المخزون | خلفية | **P0** | inventory.service.ts:842-861 يستدعي receive بلا postGl |
| 3 | إلغاء WO نشط يترك WIP/خامات بلا عكس | خلفية | P1 عالٍ | production.service.ts:156-235 يقبل CANCELLED من أي حالة |
| 4 | 19 معامل مسار UUID بلا ParseUUIDPipe → 500 بدل 400 | خلفية | P1 | sales/hr/shipping/purchasing/suppliers/users/accounting |
| 5 | iOS بلا NSCameraUsageDescription/NFCReaderUsageDescription | جوال | P1 | Info.plist |
| 6 | أي موثّق يصل /users و/accounting عبر deep-link | جوال | P1 | router redirect يتحقق من المصادقة فقط |
| 7 | فهرس purchase_orders(status,createdAt) مفقود + 7 فهارس أنماط فعلية | قاعدة | P1 | مقارنة فهارس الهجرات بأنماط الخدمات |
| 8 | بلا قيد افتتاحي في البذرة — الدفتر يبدأ صفرًا والمخزون 7,005 | خلفية | P1 | seed.ts |
| 9 | API_CONTRACT متأخر: ~27 مسارًا غير موثق + 4 انحرافات سلوكية | توثيق | P1 | مقارنة العقد بالمتحكمات |

### ما كان سليمًا (تحقق إيجابي مهم)

- **قاعدة البيانات ممتازة:** صفر انحراف (بوابة CI نفسها)، 93 FK كلها بإجراءات صحيحة، فيلا دفاعية (trigger توازن القيود + CHECKs)، بذرة idempotent، شجرة حسابات متطابقة بين seed وchart-of-accounts.ts.
- **الخلفية متينة بنيويًا:** fail-closed guards عالمية، SoD في الشراء/البيع/الرواتب، idempotency شامل (45 مسار كتابة)، CAS/FOR UPDATE ضد السباقات، توازن القيود إجباري بمحرك Decimal.
- **تغطية GL شاملة:** كل تدفق مالي يرحّل (استلام/مرتجع شراء، حركات المخزون اليدوية، استهلاك/إكمال إنتاج، هدر جودة، تأكيد/إبطال/مرتجع بيع، تحصيل، سلف/رواتب، سندات، شحن) — الاستثناءان الوحيدان (add-stock ومرتجع داخلي ADR-0020 مقصود) أُصلح الأول منهما.
- **الجوال جيد الهندسة:** retry + refresh mutex + offline outbox (HR) + كاش Hive (4 ميزات) + عربية RTL سليمة + barcode/NFC/جهات الاتصال موصولة فعليًا.

---

## 2. الإصلاحات المنفذة (كلها على الفرع، بوابات خضراء)

| # | الإصلاح | الملفات |
|---|---|---|
| 1 | INTERNET + CAMERA + NFC في main manifest + أوصاف iOS | `AndroidManifest.xml`, `Info.plist` |
| 2 | `postGl: true` في addRawMaterialStock | `inventory.service.ts` |
| 3 | قاعدة إلغاء WO: PLANNED فقط + فحص دفاعي → 409 + اختباران جديدان | `production.service.ts`, `production.service.spec.ts`, `prisma-mock.ts` |
| 4 | ParseUUIDPipe على 19 معاملًا في 6 متحكمات | controllers ×6 |
| 5 | هجرة `20260909000000_audit_gap_indexes` (8 فهارس) + تصريحها في schema | `migration.sql`, `schema.prisma` |
| 6 | `RouteAccess` مركزية + redirect الموجّه + تصفية الدرج + 10 اختبارات | `route_access.dart` (جديد), `app_router.dart`, `dashboard_screen.dart`, `route_access_test.dart` (جديد) |
| 7 | قيد افتتاحي JE-SEED-OPENING-001 + تمويل خزينة اختياري (SEED_TREASURY_OPENING) | `seed.ts` |
| 8 | مزامنة API_CONTRACT كاملة (27 مسارًا + 4 تصويبات + قاعدة الإلغاء الجديدة) | `API_CONTRACT.md` |

**بوابات التحقق (كلها على الفرع):** tsc 0 أخطاء · lint 0 · format ✓ · 772/772 unit (49 suite) · 64/64 e2e · 45/45 integration على PostgreSQL 16 · flutter analyze: No issues · 276/276 flutter test · prisma migrate diff: No difference · seed idempotent (تشغيل مزدوج متحقق).

---

## 3. تحليل الميزات المفقودة لكل وحدة (الناتج التحليلي)

### 3.1 الخلفية — الفجوات المرتبة

| الأولوية | الفجوة | الوحدة |
|---|---|---|
| P0 | اختبارات integration لوحدة **المبيعات** على PostgreSQL حقيقي (أكبر تدفق مالي: confirm/return/void/credit/payment — تُختبر mock فقط) | sales |
| P1 | مسارات تحديث ناقصة: PATCH /hr/workers/:id (تعديل سعر القطعة)، PATCH /products/:id (تعطيل منتج)، GET /activity-logs (يُكتب بكثافة ولا يُقرأ)، GET /hr/attendance | hr/products/audit |
| P1 | CRUD شركات الشحن (النموذج قائم والـ DTO يقبل shippingCompanyId بلا طريقة لإنشائه) | shipping |
| P2 | أحداث أعمال نصف معطلة: 17 حدثًا معرفًا، يُبث 3 فقط؛ WORK_ORDER_COMPLETED/SALES_ORDER_PAID/SHIPMENT_DELIVERED/PAYROLL_PAID/SALES_ORDER_OVERDUE لا تُطلق | events |
| P2 | 4 نماذج ميتة (SupplierPayment, RawMaterialTransaction, WorkOrderStage, MaterialConsumption legacy) + CostCenter/ShippingCompany بلا CRUD — تنظيف أو تفعيل | schema |
| P2 | توحيد شكل pagination المتعايش (PaginatedResult مقابل ListResponseDto) | common |
| P2 | تقارير مالية إضافية: P&L، ميزانية، أعمار الذمم (AR/AP Aging)، تقييم مخزون | accounting/reports |
| P3 | Idempotency-Key لحذف BOM (وحيد بلا حماية بين 45 مسارًا)؛ purge job لمفاتيح idempotency المنتهية؛ تقسيم الجداول التراكمية (stock_ledger/journal_lines/idempotency_keys) عند النمو |

### 3.2 الجوال — الفجوات المرتبة

| الأولوية | الفجوة | الوحدة |
|---|---|---|
| P0 | (أُصلح) INTERNET/permissions + حماية أدوار الموجّه | core |
| P1 | CRUD موردين (تعديل/تعطيل) غير موجود رغم توفر الـ API؛ تحرير عميل + ضبط حد ائتماني (GM)؛ void بيع (GM) — الثلاثة متوفرة خادميًا وبلا واجهة | suppliers/sales |
| P1 | شاشة التقارير **نسخة من اللوحة** (نفس endpoint /dashboard/stats): لا تستهلك /quality/kpis أو /inventory/ledger أو كشف الحساب أو تصدير | reports |
| P1 | خدمات ميتة: PrinterService/SpeechService/NotificationService بلا أي استخدام + **17 حزمة معلنة غير مستعملة** (pdf/printing/image_picker/lottie/...) — إما موصولة (طباعة الفواتير) أو تُحذف لتخفيف البناء | core/services, pubspec |
| P1 | offline parity: الكاش والطابور في 4 ميزات فقط (dashboard/HR/production/inventory) — بقية الشاشات error view بلا كاش | features |
| P2 | تمرير صفحات (كل القوائم page=1&limit=100 بلا load-more)؛ مرشحات خادمية (الجودة/البيع/الرواتب تفلتر عميلًا فقط)؛ اختيار شركة شحن بـ UUID يدوي | features |
| P2 | فجوات اختبارات: ميزتا products وreports بلا أي اختبار؛ login screen بلا اختبار widget | test |
| P2 | VIEWER وضع قراءة فقط (إخفاء أزرار الكتابة لكل دور على مستوى الإجراء) — حاليًا الحماية على مستوى الشاشة/المسار والخادم يرفض الكتابة | UX |

### 3.3 قاعدة البيانات — الفجوات المرتبة

| الأولوية | الفجوة |
|---|---|
| P1 | (أُصلح) 8 فهارس لأنماط الاستعلام الفعلية |
| P1 | 6 قيود CHECK بوضع NOT VALID (quality_checks ×4, payrolls ×2) — تحمي الجديد لا القديم؛ تحتاج تسوية بيانات تاريخية ثم VALIDATE |
| P2 | سياسة soft-delete غير موحدة (4/50 موديلًا فقط بـ deletedAt)؛ Treasury.type نص حر (CHECK/enum)؛ تحقق وجود counterpartyId للسند (TODO بالمخطط) |
| P3 | توثيق الفهارس الفريدة الجزئية في تعليقات المخطط؛ سكربت npm لـ migrate:diff؛ التخطيط للنمو (تقسيم/أرشفة)؛ tenantId إن أُريد SaaS مستقبلًا |

---

## 4. ما لم يُصلح في هذه الجولة (ولماذا)

1. **VALIDATE لقيود CHECK الستة:** يتطلب تسوية بيانات تاريخية فعلية على الإنتاج أولًا (صفوف قد تخالف) — هجرة VALIDATE على بيانات مخالفة تفشل وتوقف النشر. تُجدول مع تسوية بيانات مدروسة.
2. **اختبارات تكامل المبيعات:** عمل كبير مستقل (نمط purchasing.integration-spec: TRUNCATE + فترات + دورة كاملة) — أول بند في خطة الموجة القادمة.
3. **تفعيل أحداث الأعمال + تقارير مالية جديدة + CRUD الشركات:** ميزات P2/P1 كاملة الأركان تتطلب قرارات تصميم (مستمعوها؟ شكل التقارير؟) — ليست إصلاحات عيوب.
4. **تنظيف 17 حزمة flutter غير المستخدمة:** يحتاج قرار مواءمة (طباعة الفواتير أولوية المنتج؟) وإعادة pub get + اختبار بناء كامل.
5. **APK build:** موقوف بتعليمات المالك حتى انتهاء التدقيق — جاهز للاستئناف بعد دمج هذا الفرع (ملحوظة: صلاحية INTERNET كانت ستكسر أول release فعليًا).

---

## 5. التسليم التالي (لمن يتسلم)

1. مراجعة PR (هذا الفرع) ثم الدمج عند CI الأخضر — التغييرات كلها مضافة وآمنة (فهارس وصفية + صلاحيات manifest + حماية موجّه + تصحيحات خدمات).
2. بعد الدمج: تشغيل `prisma migrate deploy` على Railway (هجرة الفهارس تمر بثوانٍ، بلا أقفال بنّاءة على جداول صغيرة).
3. استئناف بناء APK release (الصلاحيات الآن سليمة) → `download/` → GitHub Release v1.1.0+3 المقترح.
4. جدولة الموجة القادمة وفق ترتيب القسم 3 (المبيعات integration أولًا).
5. متغير بيئة جديد اختياري `SEED_TREASURY_OPENING` للعبه على بيئات جديدة فقط (لا يمس قاعدة قائمة).
