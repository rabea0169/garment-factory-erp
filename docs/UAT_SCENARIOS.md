# UAT_SCENARIOS — دليل سيناريوهات اختبار القبول (16 سيناريو)

> **الغرض:** اختبار قبول المستخدم (User Acceptance Test) للمسارات الذهبية لدورة مصنع الملابس كاملة: كتالوج ← شراء ← إنتاج ← جودة ← بيع ← تحصيل ← شحن ← مرتجعات ← HR/رواتب ← محاسبة، إضافة إلى مسارات الأمان (RBAC / Idempotency / إبطال الجلسة).
>
> **العلاقة بالبوابات:** يُغلق هذا الدليل بند «UAT على 16 سيناريو القبول» من بوابة **G9→G10** في `docs/RELEASE_GATES.md` (المرحلة: Pilot). المرجع العقدي للمسارات والأدوار: `docs/API_CONTRACT.md`.
>
> **المرجع التقني:** HEAD `e72ee94` (موجة UAT 6) · **Backend:** NestJS 11 + PostgreSQL 16 · **Mobile:** Flutter (Android).

---

## 1. قواعد التنفيذ (ملزمة)

1. **البيئة:** staging معزولة ببيانات تجريبية — لا يُنفَّذ أي سيناريو على قاعدة الإنتاج (`fulfilling-serenity` — راجع `docs/RELEASE_READINESS_2026-08-27.md`).
2. **التنفيذ على جهاز Android فعلي** عبر تطبيق Flutter أينما توافر المسار في التطبيق؛ ما لا يوجد في التطبيق يُنفَّذ مباشرة على الـ API (curl/Postman) ويُشار إلى ذلك في خانة «ملاحظات» بجدول النتائج.
3. **الترتيب:** السيناريوهات 1→16 مصممة كسلسلة (مخرجات سيناريو = مدخلات التالي حيث ذُكر). عند الفشل: صلّح، أعد السيناريو نفسه ثم ما بعده.
4. **التحقق المحاسبي:** لا يوجد مسار API لعرض القيود؛ التحقق من القيود (`journal_entries` / `journal_lines`) يتم من psql على قاعدة staging — يُدرج نص الاستعلام في السيناريو المعني.
5. **لا قيم هوية في الـ body:** `userId/createdById/creatorId/actorId` تُرفض بـ 400 — الهوية من الجلسة (اختبار ضمني في كل سيناريو كتابة).
6. كل سيناريو يُوثَّق في جدول النتائج (§6) فور تنفيذه: رقم/المنفّذ/التاريخ/النتيجة (Pass/Fail)/ملاحظات.

## 2. بيئة التنفيذ والأدوار

- **Base URL:** `http://<STAGING_HOST>:<STAGING_PORT>` (مثال DEV: `3005`) — استخدم placeholder ولا تضع عنوانًا حقيقيًا في هذا المستند.
- **المصادقة:** `Authorization: Bearer <access_token>` من `POST /auth/login`. الاستجابة: `{ access_token, refresh_token, user }`.
- **مستودعات seed:** `WH-RAW` (خامات) و`WH-FG` (منتج تام). **خامات seed:** `RM-001` (قماش قطني، METER)، `RM-002` (خيط، ROLL). **عمال seed:** `WK-001` (SEWING، pieceRate 5.5)، `WK-002` (CUTTING، pieceRate 3.0).

| الدور | مستخدم UAT مقترح | ملاحظات الإنشاء |
|---|---|---|
| SUPER_ADMIN | `admin@factory.com` | من seed (كلمة المرور = `SEED_ADMIN_PASSWORD`) |
| GENERAL_MANAGER | `uat.gm@factory.com` | §3.1 |
| PRODUCTION_MANAGER | `uat.production@factory.com` | §3.1 |
| INVENTORY_MANAGER | `uat.inventory@factory.com` | §3.1 |
| HR_MANAGER | `uat.hr@factory.com` | §3.1 |
| ACCOUNTANT | `uat.accountant@factory.com` | §3.1 |
| CASHIER | `uat.cashier@factory.com` | §3.1 |
| VIEWER | `uat.viewer@factory.com` | §3.1 |

## 3. إعداد البيانات قبل البدء (Pre-flight)

> سجّل **وقت بدء UAT** (`<UAT_START_TS>` بصيغة ISO) — يُستخدم في استعلامات التحقق المحاسبي.
> لا يوجد مسار API لإنشاء مستخدمين أو خزائن بعد (إدارة المستخدمين خارج نطاق الـ MVP) — الإنشاء مباشر في قاعدة staging.

### 3.1 مستخدمو الأدوار (SQL على staging)

```bash
# 1) ولّد hash بكلمة مرور UAT (لا تستخدم كلمات مرور حقيقية):
cd "<REPO_PATH>/backend"
node -e "require('bcrypt').hash(process.argv[1],10).then(h=>console.log(h))" '<UAT_PASSWORD>'
```

```sql
-- 2) أنشئ مستخدمي الأدوار (كرر لكل دور، عوّض <BCRYPT_HASH>):
INSERT INTO "users" ("id","name","email","password","role","isActive","jwt_version","createdAt","updatedAt")
VALUES (
  gen_random_uuid()::text, 'مدير عام (UAT)', 'uat.gm@factory.com', '<BCRYPT_HASH>',
  'GENERAL_MANAGER', true, 0, now(), now()
);
-- كرر: PRODUCTION_MANAGER / INVENTORY_MANAGER / HR_MANAGER / ACCOUNTANT / CASHIER / VIEWER
-- بـ uat.production@factory.com … uat.viewer@factory.com على النمط نفسه.

-- 3) تحقق:
SELECT "email","role" FROM "users" WHERE "email" LIKE 'uat.%@factory.com' ORDER BY "email";  -- المتوقع: 7 صفوف
```

### 3.2 خزينة نشطة (SQL — تلزم لسيناريوهات 9/12/13/14)

```sql
INSERT INTO "treasuries" ("id","name","type","balance","isActive","createdAt")
VALUES (gen_random_uuid()::text, 'خزينة UAT الرئيسية', 'CASH', 100000.00, true, now());

SELECT "name","balance","isActive" FROM "treasuries" WHERE "isActive" = true;  -- المتوقع: خزينة UAT برصيد 100000.00
```

### 3.3 تحقق أن البيئة سليمة قبل البدء

```bash
curl -s -o /dev/null -w '%{http_code}\n' "http://<STAGING_HOST>:<STAGING_PORT>/health/ready"   # المتوقع: 200
curl -s -X POST "http://<STAGING_HOST>:<STAGING_PORT>/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@factory.com","password":"<SEED_ADMIN_PASSWORD>"}'                       # المتوقع: 200 + access_token
```

---

## 4. السيناريوهات (16)

> اختصارات: `<TOKEN>` = access token للمستخدم المذكور في السيناريو · `PP` = POSTMAN/curl · كل الأكواد HTTP المرجعية من `docs/API_CONTRACT.md`.

### السيناريو 01 — تسجيل دخول وخروج وإبطال الجلسة (SEC-F04)

| البند | القيمة |
|---|---|
| **الرقم** | 01 |
| **العنوان** | تسجيل دخول + خروج + إبطال access token بعد الخروج |
| **الدور المستخدم** | SUPER_ADMIN (`admin@factory.com`) |

**الشرط المسبق:** §3.3 ناجح (بيئة عاملة وكلمة مرور الأدمن معلومة من `SEED_ADMIN_PASSWORD`).

**الخطوات:**
1. `POST /auth/login` بـ `{"email":"admin@factory.com","password":"<SEED_ADMIN_PASSWORD>"}`.
2. `GET /auth/me` مع `Authorization: Bearer <TOKEN>`.
3. `POST /auth/logout` بـ body `{"refresh_token":"<REFRESH_TOKEN>"}` (من خطوة 1).
4. `GET /auth/me` مجددًا **بنفس** `<TOKEN>` القديم.
5. `POST /auth/refresh` بـ `{"refresh_token":"<REFRESH_TOKEN>"}` (الملغى).

**النتيجة المتوقعة بدقة:**
- خطوة 1: **200** وجسم يحوي `access_token` و`refresh_token` و`user` (بلا حقل `password`).
- خطوة 2: **200** مع بيانات المستخدم.
- خطوة 3: **200** مع `{ "revoked": true, "reason": "revoked" }`.
- خطوة 4: **401** — الخروج رفع `jwt_version` فأصبح الـ access token القديم مرفوضًا.
- خطوة 5: **401** — refresh token ملغى (إعادة استخدامه تُعد مؤشر سرقة).

**معيار النجاح:** **Pass** فقط إذا تحققت الأكواد الخمسة أعلاه بالترتيب. **Fail** إن وُجد أي 2xx على خطوة 4 أو 5.

---

### السيناريو 02 — إنشاء منتج كامل + متغير + BOM

| البند | القيمة |
|---|---|
| **الرقم** | 02 |
| **العنوان** | إنشاء منتج ثم إضافة متغير (مقاس/لون) وبند BOM — أو المسار الكامل بمعاملة واحدة |
| **الدور المستخدم** | PRODUCTION_MANAGER |

**الشرط المسبق:** مستخدم PRODUCTION_MANAGER (§3.1) + خامة `RM-001` من seed.

**الخطوات:**
1. سجّل الدخول بـ PRODUCTION_MANAGER.
2. `POST /products` بـ `{"code":"PRD-UAT-01","name":"تيشيرت UAT","category":"تيشيرت","retailPrice":250,"wholesalePrice":180}`.
3. `POST /products/<PRODUCT_ID>/variants` بـ `{"size":"M","color":"أبيض"}`.
4. `POST /products/<PRODUCT_ID>/bom` بـ `{"rawMaterialId":"<RM-001_ID>","quantity":1.2,"unit":"METER"}`.
5. `GET /products/<PRODUCT_ID>` للتحقق.
6. (بديل مجرَّب أيضًا) `POST /products/full` بمنتج ثانٍ `PRD-UAT-02` مع `variants:[{"size":"L","color":"أسود"}]` و`bomItems:[{"rawMaterialId":"<RM-001_ID>","quantity":1.2,"unit":"METER"}]` داخل معاملة واحدة.
7. (تحقق أمني) حاول `POST /products` وأنت VIEWER.

**النتيجة المتوقعة بدقة:**
- خطوات 2–4 و6: **201** لكل منها؛ المتغير يظهر ضمن `variants` والـ BOM ضمن بنود المنتج في خطوة 5 (**200**).
- خطوة 6: إما المنتج مع متغيراته وBOM معًا أو فشل كامل — لا إنشاء جزئي (معاملة واحدة).
- خطوة 7: **403** (VIEWER خارج الأدوار المسموحة).

**معيار النجاح:** **Pass** إذا أُنشئ المنتجان ومتغيراتهما وBOM كاملًا، ورُفض VIEWER بـ 403. **Fail** إن ظهر منتج بلا متغير/BOM بعد نجاح 201، أو قُبل VIEWER.

---

### السيناريو 03 — شراء: أمر شراء ← استلام (GRN) ← مخزون + قيد AP

| البند | القيمة |
|---|---|
| **الرقم** | 03 |
| **العنوان** | دورة الشراء: PO ← استلام جزئي/كامل وترحيل المخزون والقيد وذمم المورد |
| **الدور المستخدم** | INVENTORY_MANAGER (الإنشاء والاستلام) + ACCOUNTANT (التحقق المحاسبي) |

**الشرط المسبق:** مستخدما INVENTORY_MANAGER وACCOUNTANT (§3.1)؛ خامة `RM-001` موجودة.

**الخطوات:**
1. سجّل الدخول بـ INVENTORY_MANAGER.
2. `POST /suppliers` بـ `{"name":"مورد UAT للنسيج","phone":"01000000001"}` ← سجّل `<SUPPLIER_ID>`.
3. سجّل رصيد الخامة قبل الاستلام: `GET /inventory/raw-materials/<RM-001_ID>/balance-by-warehouse` ← `qty_before` في `WH-RAW`.
4. `POST /purchasing` بـ `{"supplierId":"<SUPPLIER_ID>","paymentType":"CREDIT","items":[{"rawMaterialId":"<RM-001_ID>","quantity":50,"unitCost":45.5}]}` ← سجّل `<PO_ID>` و`<PO_ITEM_ID>`.
5. `POST /purchasing/<PO_ID>/receipts` بـ `{"items":[{"purchaseOrderItemId":"<PO_ITEM_ID>","quantity":50}],"notes":"استلام UAT كامل"}`.
6. أعد `GET /inventory/raw-materials/<RM-001_ID>/balance-by-warehouse`.
7. (تحقق محاسبي — ACCOUNTANT عبر psql على staging):
   ```sql
   SELECT je."code", je."debitTotal", je."creditTotal", je."metadata"
   FROM "journal_entries" je
   WHERE je."createdAt" >= '<UAT_START_TS>' AND je."isAuto" = true
   ORDER BY je."createdAt" DESC LIMIT 5;
   -- المتوقع: قيد آلي للمصدر purchasing.receipt بقيمة 50×45.5 = 2275.00
   -- (مدين INVENTORY 1300 / دائن ACCOUNTS_PAYABLE 2200) و debitTotal = creditTotal
   ```
8. (سلوك حدودي) حاول استلامًا بكمية أكبر من المتبقي: `quantity: 100` بند جديد.

**النتيجة المتوقعة بدقة:**
- خطوة 2: **201** بكود `SUP-…`.
- خطوة 4: **201** بأمر شراء بكود `PO-…` وحالة `PENDING`/`ORDERED`.
- خطوة 5: **201** باستلام (receipt) وحركات `RECEIVE` في الـ ledger، ورصيد الخامة في `WH-RAW` زاد بـ 50 (خطوة 6: `qty_after = qty_before + 50`)، ورصيد المورد زاد بـ 2275.00.
- خطوة 7: قيد متوازن واحد للمصدر (لا قيود مكررة).
- خطوة 8: **400** — الكمية المتبقية غير كافية.

**معيار النجاح:** **Pass** إذا تحقق زيادة المخزون بالقيمة والكمية وتوازن القيد معًا ورُفض التجاوز. **Fail** إن زاد المخزون دون قيد (أو العكس) أو قُبل تجاوز الكمية.

---

### السيناريو 04 — مرتجع مورد جزئي وتأثيره على المخزون

| البند | القيمة |
|---|---|
| **الرقم** | 04 |
| **العنوان** | إرجاع جزء من الكمية المستلمة إلى المورد وعكس المخزون والقيد والذمم |
| **الدور المستخدم** | INVENTORY_MANAGER |

**الشرط المسبق:** السيناريو 03 منجز (استلام 50 وحدة من `RM-001` من `<SUPPLIER_ID>`).

**الخطوات:**
1. سجّل رصيد `RM-001` في `WH-RAW` قبل المرتجع (`qty_before_return`).
2. `POST /purchasing/<PO_ID>/return` بـ `{"purchaseOrderItemId":"<PO_ITEM_ID>","quantity":10,"notes":"مرتجع UAT جزئي"}`.
3. أعد `GET /inventory/raw-materials/<RM-001_ID>/balance-by-warehouse`.
4. تحقق محاسبي (psql): قيد عكسي للمصدر purchasing.return داخل نطاق `<UAT_START_TS>`.
5. (حدودي) أعد المرتجع بـ `quantity: 100` (يتجاوز المتبقي المستلم).

**النتيجة المتوقعة بدقة:**
- خطوة 2: **201** بسجل مرتجع؛ المخزون نقص 10 (`qty_after_return = qty_before_return − 10`)؛ رصيد المورد نقص 10×45.5 = 455.00.
- خطوة 4: قيد عكسي متوازن (دائن المخزون/مدين الذمم) مرتبط بالمصدر داخل معاملة واحدة.
- خطوة 5: **400** — منع سباق مرتجعين يتجاوزان المستلم.

**معيار النجاح:** **Pass** إذا نقص المخزون والذمم بالقيم الدقيقة ورُفض التجاوز. **Fail** لأي انحراف عددي أو قبول تجاوز.

---

### السيناريو 05 — أمر تشغيل من الإنشاء حتى منتج تام في WH-FG

| البند | القيمة |
|---|---|
| **الرقم** | 05 |
| **العنوان** | WO كامل: إنشاء ← مراحل (قص/خياطة/كي/تغليف) ← صرف خامات ← إنتاج تام في WH-FG |
| **الدور المستخدم** | PRODUCTION_MANAGER |

**الشرط المسبق:** السيناريو 02 منجز (`<VARIANT_ID>` لـ `PRD-UAT-01` + BOM)؛ خامة `RM-001` متاحة في `WH-RAW` (السيناريو 03)؛ سجّل رصيد الخامة ورصيد المتغير في `WH-FG` قبل البدء (`qty_rm_before`, `qty_fg_before` عبر `GET /inventory/finished-goods`).

**الخطوات:**
1. `POST /production/work-orders` بـ `{"productVariantId":"<VARIANT_ID>","bomVersionId":"<BOM_VERSION_ID>","quantity":100}` ← `<WO_ID>` (كود `WO-…`).
2. `POST /production/work-orders/<WO_ID>/stage-transitions` (Header: `Idempotency-Key: uat5-trans-cutting`) بـ `{"toStage":"CUTTING","reason":"بدء القص"}`.
3. `POST /production/work-orders/<WO_ID>/material-consumptions` (Header: `Idempotency-Key: uat5-cons-1`) بـ `{"stageRunId":"<CUTTING_RUN_ID>","rawMaterialId":"<RM-001_ID>","warehouseId":"<WH-RAW_ID>","plannedQuantity":120,"actualQuantity":118,"wasteQuantity":2,"unit":"METER","wasteReason":"CUTTING_LOSS"}`.
   > `<CUTTING_RUN_ID>`: من استجابة الانتقال في خطوة 2 أو `GET /production/work-orders` (سجلات المراحل).
4. `POST /production/work-orders/<WO_ID>/stage-output` بـ `{"stage":"CUTTING","inputQty":100,"acceptedQty":95,"rejectedQty":3,"wasteQty":2}`.
5. كرر الانتقال والمخرجات للمراحل التالية بالترتيب: `SEWING` (input=95) ثم `IRONING` ثم `PACKING` (سجّل مخرجات كل مرحلة بحيث `inputQty = acceptedQty + rejectedQty + wasteQty`).
6. تحقق من المخزون: `GET /inventory/finished-goods` و`GET /inventory/raw-materials/<RM-001_ID>/balance-by-warehouse`.
7. (حدودي) حاول تسجيل مخرج لمرحلة `PACKING` وهي ليست المرحلة الحالية (أو قفزة `PLANNED→PACKING` مباشرة بأمر جديد).

**النتيجة المتوقعة بدقة:**
- خطوة 1: **201** بحالة `PLANNED`.
- خطوات 2–5: **201** لكل؛ الرفض القاطع للقفز بين المراحل؛ الخامة نقصت بـ 118 مترًا في `WH-RAW` (خطوة 6: `qty_rm_after = qty_rm_before − 118`).
- بعد إغلاق `PACKING`: أمر التشغيل **COMPLETED**، والمتغير في `WH-FG` زاد بـ **acceptedQty للمرحلة الأخيرة** (مثال: لو آخر مخرج 90 فيصبح `qty_fg_after = qty_fg_before + 90`).
- قيد آلي متوازن عند إكمال `PACKING` (مدين `FINISHED_GOOD_STOCK` 1310 / دائن `WIP` 1320) — تحقق psql كما في السيناريو 03.
- خطوة 7: **400** — لا تسجيل مخرج لمرحلة غير `currentStage`.

**معيار النجاح:** **Pass** إذا اكتمل الأمر ووصل المنتج التام إلى `WH-FG` بالكمية المقبولة مع نقص الخامة المصرُوف وقيود متوازنة. **Fail** إن وصل أمر لحالة نهائية دون أثر مخزون أو قيد.

---

### السيناريو 06 — فحص جودة بقاعدة conservation

| البند | القيمة |
|---|---|
| **الرقم** | 06 |
| **العنوان** | فحص جودة على stageRun: checked = passed + rejected + waste |
| **الدور المستخدم** | PRODUCTION_MANAGER |

**الشرط المسبق:** أمر تشغيل جارٍ من السيناريو 05 مع مرحلة مكتملة (مثل `CUTTING` بـ stageRun معروف `<STAGE_RUN_ID>`) — أو أمر مستقل وصل مرحلة مكتملة.

**الخطوات:**
1. `POST /quality` بـ `{"workOrderId":"<WO_ID>","stageRunId":"<STAGE_RUN_ID>","stage":"CUTTING","checkedQty":95,"passedQty":90,"rejectedQty":3,"wasteQty":2,"rejectionReason":"SEWING_DEFECT","wasteReason":"CUTTING_LOSS"}` (استخدم أسبابًا صالحة من enum `RejectionReason`/`wasteReason` المطابقين).
2. (حدودي — كسر conservation) `POST /quality` بأمر ثانٍ/stageRun مختلف بـ `{"checkedQty":100,"passedQty":90,"rejectedQty":5,"wasteQty":2}` (المجموع 97 ≠ 100).
3. (حدودي — تكرار) أعد نفس طلب خطوة 1 حرفيًا (نفس `stageRunId`).
4. `GET /quality/kpis?workOrderId=<WO_ID>`.

**النتيجة المتوقعة بدقة:**
- خطوة 1: **201** بفحص مكتمل؛ `unitCost` و`wasteCost` محسوبان على الخادم (لا يقبلان من body).
- خطوة 2: **400** — لا يقبل الخادم كسر قاعدة conservation، ويلزم `rejectionReason` عند وجود رفض و`wasteReason` عند وجود هالك.
- خطوة 3: **409** — فحص ثانٍ لنفس `stageRunId` مرفوض.
- خطوة 4: **200** و`totals.checkedQty` يضم فحص خطوة 1 (95) و`rates.passRate/rejectionRate/wasteRate` بمجموع 100% (منزلتان عشريتان).

**معيار النجاح:** **Pass** إذا قُبل الفحص الصحيح ورُفض الكسر والتكرار بالأكواد المحددة. **Fail** إن قُبل مجموع ≠ checked أو سُمح بفحصين لنفس المرحلة.

---

### السيناريو 07 — أمر بيع نقدي (CASH): إنشاء ← تأكيد ← صرف المخزون + COGS

| البند | القيمة |
|---|---|
| **الرقم** | 07 |
| **العنوان** | فاتورة نقدية: إنشاء ← تأكيد يخصم المنتج التام ويرحّل COGS |
| **الدور المستخدم** | CASHIER |

**الشرط المسبق:** مخزون متاح للمتغير في `WH-FG` (من السيناريو 05)؛ مستخدم CASHIER (§3.1).

**الخطوات:**
1. سجّل الدخول بـ CASHIER، وأنشئ عميلًا: `POST /sales/customers` بـ `{"name":"عميل UAT نقدي","phone":"01000000002"}` ← `<CUSTOMER_ID>` (كود `CUST-…`).
2. سجّل رصيد المتغير في `WH-FG` قبل البيع (`qty_fg_before`).
3. `POST /sales/orders` بـ `{"customerId":"<CUSTOMER_ID>","paymentType":"CASH","discount":0,"items":[{"productVariantId":"<VARIANT_ID>","quantity":10}]}` ← `<SO_ID>` (كود `SO-…`, حالة مسودة).
4. `POST /sales/orders/<SO_ID>/confirm` (Header: `Idempotency-Key: uat7-confirm`).
5. تحقق من المخزون: `GET /inventory/finished-goods`.
6. تحقق محاسبي (psql): قيود آلية مرتبطة بالمصدر `sales.confirm` — إيراد + VAT (14% على الوعاء الخاضع) + COGS متوازنة.
7. (حدودي) حاول تأكيد نفس الأمر مرة ثانية بمفتاح **مختلف**.

**النتيجة المتوقعة بدقة:**
- خطوة 3: **201** — السعر من الخادم (سعر التجزئة/الجملة للمنتج)، لا يُرسل سعر البند من العميل؛ الإجمالي محسوب خادميًا.
- خطوة 4: **201** — الحالة تصبح `CONFIRMED`، والمخزون في `WH-FG` نقص 10 (`qty_fg_after = qty_fg_before − 10`)، والصرف حدث عند **التأكيد** (لا عند الإنشاء).
- خطوة 6: قيود متوازنة: `Dr CASH / Cr SALES_REVENUE + VAT_PAYABLE` و`Dr COST_OF_GOODS_SOLD / Cr FINISHED_GOOD_STOCK`.
- خطوة 7: يُرفض التأكيد الثاني (لا صرف مزدوج) — الحالة انتقالية مشروطة.

**معيار النجاح:** **Pass** إذا تحقق خصم المخزون مرة واحدة عند التأكيد فقط + قيود متوازنة. **Fail** إن خصم عند الإنشاء أو تكرر الخصم أو اختل التوازن.

---

### السيناريو 08 — أمر بيع آجل (CREDIT) وحد ائتماني (COMM-F07)

| البند | القيمة |
|---|---|
| **الرقم** | 08 |
| **العنوان** | ضبط حد ائتماني ثم رفض تجاوزه على أمر آجل |
| **الدور المستخدم** | GENERAL_MANAGER (ضبط الحد) + CASHIER (الأمر) |

**الشرط المسبق:** عميل جديد `عميل UAT آجل` (أنشئه كما في السيناريو 07 خطوة 1) ← `<CREDIT_CUSTOMER_ID>`؛ مخزون متاح في `WH-FG`.

**الخطوات:**
1. سجّل الدخول بـ GENERAL_MANAGER: `PATCH /sales/customers/<CREDIT_CUSTOMER_ID>/credit` بـ `{"creditLimit":5000,"creditTermsDays":30}`.
2. سجّل الدخول بـ CASHIER وأنشئ أمر CREDIT **داخل** الحد: `POST /sales/orders` بـ `paymentType: "CREDIT"` وكمية صغيرة (إجمالي ≤ 5000).
3. أنشئ أمر CREDIT **يتجاوز** الحد (رصيد العميل الحالي + الإجمالي الجديد > 5000).
4. (حدودي) بعد GENERAL_MANAGER: `PATCH …/credit` بـ `{"creditLimit":0}` ثم CASHIER يحاول أي أمر CREDIT صغير.

**النتيجة المتوقعة بدقة:**
- خطوة 1: **200** — حُفظ `creditLimit` و`creditTermsDays` (تحقق: استجابة العميل تعكس القيم).
- خطوة 2: **201** — أمر آجل داخل الحد مقبول.
- خطوة 3: **400** برسالة عربية تتضمن «تجاوز الحد الائتماني للعميل» مع الرصيد الحالي والحد — **لا يُنشأ الأمر**.
- خطوة 4: **400** — الحد 0 يعني منع الآجل كليًا لهذا العميل؛ (وأوامر CASH لا تتأثر بالحد).

**معيار النجاح:** **Pass** إذا قُبل الآجل داخل الحد ورُفض خارجَه برسالة واضحة دون إنشاء، والحد 0 يمنع الآجل فقط. **Fail** إن قُبل تجاوز الحد أو مُنع CASH بسببه.

---

### السيناريو 09 — تحصيل دفعة عميل عبر خزينة نشطة + سند قبض

| البند | القيمة |
|---|---|
| **الرقم** | 09 |
| **العنوان** | تحصيل دفعة من العميل: سند + قيد Dr CASH / Cr AR + خفض الذمم |
| **الدور المستخدم** | CASHIER |

**الشرط المسبق:** أمر CREDIT مؤكد من السيناريو 08 بخطوة 2 (برصيد غير مسدد)؛ خزينة UAT النشطة (§3.2) برصيد معروف `treasury_before`.

**الخطوات:**
1. سجّل رصيد العميل قبل التحصيل (من استجابة الأمر/القاعدة: `paidAmount` و`balance`).
2. `POST /sales/customer-payments` (Header: `Idempotency-Key: uat9-pay-1`) بـ `{"customerId":"<CREDIT_CUSTOMER_ID>","amount":1000,"salesOrderId":"<SO_CREDIT_ID>","notes":"دفعة UAT"}`.
3. `GET /accounting/treasuries` (بحساب ACCOUNTANT أو CASHIER — مسموح لأي منهما حسب العقد: ACCOUNTANT/GENERAL_MANAGER فقط لقائمة الخزائن؛ استخدم حساب ACCOUNTANT للتحقق).
4. تحقق محاسبي (psql): قيد `Dr CASH (1100-01) / Cr ACCOUNTS_RECEIVABLE (1200)` بمبلغ 1000 متوازن مرتبط بالمصدر.
5. (حدودي) حاول دفعة بمبلغ يتجاوز الرصيد المتبقي للأمر.

**النتيجة المتوقعة بدقة:**
- خطوة 2: **201** — سجل `CustomerPayment`، و`SalesOrder.paidAmount` زاد بـ 1000، ورصيد العميل نقص 1000.
- خطوة 3: رصيد الخزينة = `treasury_before + 1000.00`.
- خطوة 4: قيد واحد متوازن بهوية الفاعل من JWT.
- خطوة 5: **400** — لا دفعة زائدة ولا دفع لأمر غير مؤكد.

**معيار النجاح:** **Pass** إذا تحقق أثر الخزينة والذمم والقيد معًا ورُفض الزائد. **Fail** لأي عدم تطابق عددي.

---

### السيناريو 10 — شحن أمر مؤكد ← POD ← DELIVERED

| البند | القيمة |
|---|---|
| **الرقم** | 10 |
| **العنوان** | دورة الشحن: PREPARING ← SHIPPED ← IN_TRANSIT ← DELIVERED بشرط POD |
| **الدور المستخدم** | CASHIER |

**الشرط المسبق:** أمر بيع **مؤكد** (من السيناريو 07) — الشحن يُنشأ لأمر مؤكد فقط، وصرف المخزون تم عند التأكيد (لا يُصرف ثانية عند الشحن).

**الخطوات:**
1. `POST /shipping` (Header: `Idempotency-Key: uat10-ship`) بـ `{"salesOrderId":"<SO_CONFIRMED_ID>","shippingCost":75,"trackingNumber":"UAT-TRK-001"}` ← `<SHIPMENT_ID>`.
2. `PATCH /shipping/<SHIPMENT_ID>/status` بـ `{"status":"SHIPPED"}`.
3. `PATCH /shipping/<SHIPMENT_ID>/status` بـ `{"status":"IN_TRANSIT"}`.
4. `PATCH /shipping/<SHIPMENT_ID>/status` بـ `{"status":"DELIVERED"}` **بلا** `proofOfDelivery`.
5. `PATCH /shipping/<SHIPMENT_ID>/status` بـ `{"status":"DELIVERED","proofOfDelivery":"POD-UAT-0001.jpg"}`.
6. (حدودي) أنشئ شحنة ثانية وحاول `{"status":"DELIVERED"}` من `PREPARING` مباشرة (قفزة).

**النتيجة المتوقعة بدقة:**
- خطوة 1: **201** — شحنة بحالة `PREPARING` (كود `SHP-…`)، وتكلفة الشحن مسجلة.
- خطوتا 2–3: **200** لكل انتقال مشروع.
- خطوة 4: **400** — `DELIVERED` يتطلب `proofOfDelivery` غير فارغ.
- خطوة 5: **200** — الحالة `DELIVERED` مع `deliveredById` من الجلسة و`deliveredAt` من الخادم، وسجل في ActivityLog.
- خطوة 6: **400** — لا انتقال غير متسلسل (الانتقال الذري مشروط بالحالة السابقة يمنع سباق الانتقالات).
- المخزون لم يتغير إطلاقًا خلال 1–6 (الصرف حدث عند تأكيد البيع).

**معيار النجاح:** **Pass** إذا سُلسلت الحالات بالترتيب، ورُفض DELIVERED بلا POD، ورُفضت القفزة، وبقي المخزون ثابتًا. **Fail** لأي قبول انتقال غير مشروع.

---

### السيناريو 11 — مرتجع بيع: إعادة المنتج للمخزون + قيد عكسي

| البند | القيمة |
|---|---|
| **الرقم** | 11 |
| **العنوان** | مرتجع جزئي لأمر مؤكد/مشحون مع عكس القيود ورد المدفوع أو خفض الذمم |
| **الدور المستخدم** | CASHIER |

**الشرط المسبق:** أمر بيع مؤكد من السيناريو 07 به بنود مسجلة (`<SO_ITEM_ID>`)؛ سجّل رصيد المتغير في `WH-FG` قبل المرتجع.

**الخطوات:**
1. `POST /sales/orders/<SO_CONFIRMED_ID>/return` (Header: `Idempotency-Key: uat11-return-1`) بـ `{"items":[{"salesOrderItemId":"<SO_ITEM_ID>","quantity":2}],"reason":"مرتجع UAT"}`.
2. تحقق من المخزون: `GET /inventory/finished-goods`.
3. تحقق محاسبي (psql): قيد عكسي يرجّع الإيراد/VAT/COGS لنفس المصدر ويرد المدفوع نقدًا (أمر CASH) أو يخفض الذمم (أمر CREDIT).
4. (حدودي) مرتجع بكمية تتجاوز غير المرتجَع سابقًا: `quantity: 99`.
5. أعد نفس طلب خطوة 1 حرفيًا (نفس مفتاح Idempotency).

**النتيجة المتوقعة بدقة:**
- خطوة 1: **201** — `SalesReturn` + بنوده؛ المتغير في `WH-FG` زاد 2 (`+2` عبر InventoryService).
- خطوة 3: قيد عكسي واحد متوازن مرتبط بالأمر (داخل معاملة واحدة مع بنود المرتجع).
- خطوة 4: **400** — الكمية تتجاوز غير المرتجَع.
- خطوة 5: نفس استجابة خطوة 1 دون إنشاء مرتجع جديد أو زيادة مخزون إضافية.

**معيار النجاح:** **Pass** إذا عادت الكمية للمخزون مرة واحدة وظهر قيد عكسي متوازن ورُفض تجاوز الكمية. **Fail** إن تكرر الأثر عند replay.

---

### السيناريو 12 — سلفة عامل من خزينة + قيد GL (COMM-F05)

| البند | القيمة |
|---|---|
| **الرقم** | 12 |
| **العنوان** | سلفة عامل من الخزينة: Dr سلف العمال / Cr النقدية |
| **الدور المستخدم** | HR_MANAGER |

**الشرط المسبق:** عامل seed `WK-001` (<WORKER_ID>)؛ خزينة UAT نشطة برصيد معروف `treasury_before`.

**الخطوات:**
1. سجّل الدخول بـ HR_MANAGER.
2. `POST /hr/advances` بـ `{"workerId":"<WORKER_ID>","amount":200,"notes":"سلفة UAT","treasuryId":"<TREASURY_ID>"}`.
3. `GET /accounting/treasuries` (بحساب ACCOUNTANT) — تحقق من الرصيد.
4. تحقق محاسبي (psql): قيد `Dr WORKER_ADVANCES (1330) / Cr CASH (1100-01)` بمبلغ 200 متوازن مرتبط بالمصدر.
5. (سلوك بديل) أنشئ سلفة ثانية صغيرة **بلا** `treasuryId` ثم تحقق psql: لا قيد GL جديد لها.

**النتيجة المتوقعة بدقة:**
- خطوة 2: **201** بسجل سلفة مرتبط بالعامل والمستخدم.
- خطوة 3: رصيد الخزينة = `treasury_before − 200.00`.
- خطوة 4: قيد واحد متوازن بالمبلغ الدقيق داخل معاملة واحدة مع السلفة.
- خطوة 5: سلفة بلا خزينة تُنشأ بلا أي قيد GL (الخصم المالي يتطلب خزينة).

**معيار النجاح:** **Pass** إذا خصم المبلغ من الخزينة وقُيّد بالاتجاه الصحيح مرة واحدة. **Fail** إن سُحب المبلغ بلا قيد أو قُيّد دون خصم.

---

### السيناريو 13 — مسير رواتب: مسودة ← اعتماد (SoD) ← دفع (PAID)

| البند | القيمة |
|---|---|
| **الرقم** | 13 |
| **العنوان** | دورة كشف الراتب مع فصل الواجبات COMM-F02 والدفع من الخزينة |
| **الدور المستخدم** | HR_MANAGER (إنشاء) + GENERAL_MANAGER (اعتماد — مستخدم مختلف) + HR_MANAGER أو GENERAL_MANAGER (الدفع) |

**الشرط المسبق:** عامل `WK-001` له إنتاج يومي في الفترة: سجّل الدخول بـ HR_MANAGER ونفّذ `POST /hr/production` بـ `{"workerId":"<WORKER_ID>","date":"<ISO_DATE ضمن الفترة>","piecesCount":100}` (أو PRODUCTION_MANAGER)؛ خزينة UAT نشطة برصيد معروف. سلفة السيناريو 12 (لو بنفس الفترة) ستُخصم من الكشف — سجّل قيمها.

**الخطوات:**
1. HR_MANAGER: `POST /hr/payrolls` بـ `{"workerId":"<WORKER_ID>","periodStart":"<PERIOD_START>","periodEnd":"<PERIOD_END>","notes":"UAT"}` ← `<PAYROLL_ID>` (فترة شاملة فترة الإنتاج أعلاه).
2. HR_MANAGER **نفسه** يحاول: `POST /hr/payrolls/<PAYROLL_ID>/approve` (Header: `Idempotency-Key: uat13-approve`).
3. GENERAL_MANAGER: `POST /hr/payrolls/<PAYROLL_ID>/approve` (نفس المفتاح).
4. GENERAL_MANAGER: `POST /hr/payrolls/<PAYROLL_ID>/pay` (Header: `Idempotency-Key: uat13-pay`) بـ `{"treasuryId":"<TREASURY_ID>","paymentDate":"<ISO_DATE>","notes":"دفع UAT"}`.
5. `GET /accounting/treasuries` (ACCOUNTANT) + تحقق psql: قيد `Dr GENERAL_EXPENSE (5000) / Cr CASH (1100-01)` بمبلغ `netAmount`.
6. أعد طلب الدفع خطوة 4 حرفيًا (نفس المفتاح).

**النتيجة المتوقعة بدقة:**
- خطوة 1: **201** — كشف `DRAFT` بقيم **محسوبة خادميًا**: `grossAmount = Σ(piecesCount × pieceRate)` للفترة (مثال: 100 قطعة × 5.5 = 550.00)، `advanceDeduct` = سلف الفترة (مثلاً 200 إن كانت سلفة 12 بنفس الفترة وبحد أقصى gross)، `absenceDeduct = 0` (ADR-0015)، `netAmount = gross − advanceDeduct`؛ لا يقبل العميل أيًا من هذه القيم (400 لو أُرسلت).
- خطوة 2: **409** برسالة «لا يمكن لمنشئ كشف الراتب اعتماده بنفسه (فصل الواجبات)» — SoD مطبق داخل المعاملة.
- خطوة 3: **200/201** — `APPROVED` مع `approvedById` (المدير العام) و`approvedAt`، دون دفع أو ترحيل.
- خطوة 4: **200/201** — `PAID`؛ رصيد الخزينة نقص بـ `netAmount` (مثال: 550−200=350.00 لو طبقت السلفة).
- خطوة 5: قيد مزدوج متوازن داخل معاملة واحدة مع الدفع.
- خطوة 6: نفس الاستجابة دون خصم ثانٍ ولا قيد ثانٍ (replay)؛ والدفع لكشف غير APPROVED يُرفض.

**معيار النجاح:** **Pass** إذا رُفض اعتماد المنشئ بـ 409 واكتمل الدفع بالقيم المحسوبة خادميًا مع قيد متوازن وreplay بلا أثر. **Fail** إن اعتمد المنشئ كشفه أو دُفع مبلغ غير netAmount.

---

### السيناريو 14 — سند صرف/قبض محاسبي + رصيد الخزينة

| البند | القيمة |
|---|---|
| **الرقم** | 14 |
| **العنوان** | إنشاء سند قبض وسند صرف على خزينة والتحقق من الرصيد والقيود |
| **الدور المستخدم** | ACCOUNTANT |

**الشرط المسبق:** خزينة UAT نشطة برصيد معروف `treasury_before`.

**الخطوات:**
1. سجّل الدخول بـ ACCOUNTANT.
2. `POST /accounting/vouchers` بـ `{"type":"RECEIPT","amount":5000,"description":"قبض UAT","treasuryId":"<TREASURY_ID>"}`.
3. `POST /accounting/vouchers` (Header: `Idempotency-Key: uat14-pay`) بـ `{"type":"PAYMENT","amount":1000,"description":"صرف نثريات UAT","treasuryId":"<TREASURY_ID>"}`.
4. `GET /accounting/treasuries` و`GET /accounting/vouchers`.
5. (حدودي) `POST /accounting/vouchers` بـ `{"type":"PAYMENT","amount":<أكثر من الرصيد>,"description":"تجاوز","treasuryId":"<TREASURY_ID>"}`.
6. تحقق محاسبي (psql): لكل سند قيد متوازن مرتبط به (تحقق `journal_entries.vouchers` و`debitTotal = creditTotal`).

**النتيجة المتوقعة بدقة:**
- خطوتا 2–3: **201** لكل — أكواد `VCH-…`، والرصيد في خطوة 4 = `treasury_before + 5000 − 1000`، والسندان ظاهران في القائمة.
- خطوة 5: **400** — لا يسمح برصيد خزينة سالب (قيد DB + تحقق خدمة).
- خطوة 6: لكل سند قيد واحد متوازن داخل معاملة واحدة، وهوية الفاعل من JWT.

**معيار النجاح:** **Pass** إذا تطور الرصيد بالقيم الثلاث بدقة ورُفض السالب وظهرت القيود المتوازنة. **Fail** لأي انحراف في الرصيد أو قبول سالب.

---

### السيناريو 15 — RBAC: VIEWER ممنوع من الكتابة (403) وبلا توكن (401)

| البند | القيمة |
|---|---|
| **الرقم** | 15 |
| **العنوان** | فصل الصلاحيات: قراءة مسموحة، كتابة ممنوعة، وعدم التوثيق مرفوض |
| **الدور المستخدم** | VIEWER + (بلا توكن) |

**الشرط المسبق:** مستخدم VIEWER (§3.1) — بيانات دخول صالحة.

**الخطوات:**
1. سجّل الدخول بـ VIEWER واحتفظ بـ `<VIEWER_TOKEN>`.
2. `GET /sales/orders?page=1&limit=20` مع `<VIEWER_TOKEN>`.
3. `POST /sales/orders` مع `<VIEWER_TOKEN>` بـ payload صحيح كامل (عميل + بند).
4. `POST /sales/orders` **بلا** رأس `Authorization` إطلاقًا بنفس الـ payload.
5. (تعميق) كرر خطوة 3 على مسار كتابة آخر: `POST /purchasing` بـ VIEWER.

**النتيجة المتوقعة بدقة:**
- خطوة 2: **200** — القراءة متاحة لأي مستخدم موثّق (عقد pagination الموحد: `data` + `meta`).
- خطوة 3: **403** — VIEWER خارج أدوار CASHIER/GENERAL_MANAGER لمسار الإنشاء.
- خطوة 4: **401** — لا توكن = مرفوض (حارس عالمي fail-closed).
- خطوة 5: **403** كذلك (السلوك عام لا خاص بمسار واحد).

**معيار النجاح:** **Pass** إذا كانت الأكواد 200/403/401/403 بالترتيب. **Fail** إن قُبلت كتابة VIEWER أو طلب بلا توكن.

---

### السيناريو 16 — Idempotency: تكرار الاستلام بنفس المفتاح بلا أثر مزدوج

| البند | القيمة |
|---|---|
| **الرقم** | 16 |
| **العنوان** | نفس Idempotency-Key + نفس الطلب = نفس النتيجة؛ ومفتاح بمحتوى مختلف = 409 |
| **الدور المستخدم** | INVENTORY_MANAGER |

**الشرط المسبق:** أمر شراء جديد بحالة مفتوحة وبند كمية 20 وحدة من `RM-002` (أنشئه كما في السيناريو 03 خطوات 2–4) ← `<PO2_ID>` و`<PO2_ITEM_ID>`؛ سجّل رصيد الخامة قبل الاستلام `qty2_before`.

**الخطوات:**
1. `POST /purchasing/<PO2_ID>/receipts` (Header: `Idempotency-Key: uat16-receipt-1`) بـ `{"items":[{"purchaseOrderItemId":"<PO2_ITEM_ID>","quantity":20}]}` — سجّل الاستجابة الكاملة (معرف receipt والكميات).
2. أعد **نفس** الطلب حرفيًا (نفس المفتاح + نفس الـ body).
3. تحقق من المخزون: `GET /inventory/raw-materials/<RM-002_ID>/balance-by-warehouse` + تحقق psql من عدد حركات `RECEIVE` والقيود المرتبطة:
   ```sql
   SELECT COUNT(*) FROM "stock_ledger_entries"
   WHERE "createdAt" >= '<UAT_START_TS>' AND "rawMaterialId" = '<RM-002_ID>';
   ```
4. (تعارض) أرسل طلبًا **بنفس المفتاح** `uat16-receipt-1` لكن بـ body **مختلف** (quantity: 5).

**النتيجة المتوقعة بدقة:**
- خطوة 1: **201** — استلام واحد بكمية 20.
- خطوة 2: **نفس الاستجابة المخزنة** (نفس معرف الـ receipt والقيم) — لا receipt جديد ولا ledger ولا قيد إضافي.
- خطوة 3: رصيد الخامة = `qty2_before + 20` (زاد مرة واحدة فقط)؛ عدد حركات RECEIVE الجديدة للخامة = 1؛ قيد AP واحد.
- خطوة 4: **409** — إعادة استخدام المفتاح بمحتوى مختلف مرفوضة.

**معيار النجاح:** **Pass** فقط إذا لم يتغير أي رقم بين خطوة 1 وخطوة 2 (مخزون/ledger/قيد/ذمم) ورفض 409 للتعارض. **Fail** إن ظهر أي أثر مزدوج.

---

## 5. جدول نتائج التنفيذ (يُملأ فور تنفيذ كل سيناريو)

| رقم السيناريو | المنفّذ | التاريخ | النتيجة (Pass/Fail) | ملاحظات (طريقة التنفيذ: Android/Postman — والأخطاء) |
|---:|---|---|---|---|
| 01 | | | | |
| 02 | | | | |
| 03 | | | | |
| 04 | | | | |
| 05 | | | | |
| 06 | | | | |
| 07 | | | | |
| 08 | | | | |
| 09 | | | | |
| 10 | | | | |
| 11 | | | | |
| 12 | | | | |
| 13 | | | | |
| 14 | | | | |
| 15 | | | | |
| 16 | | | | |

---

## 6. قاعدة Go/No-Go (ملزمة لبوابة G9→G10)

> **لا يُمضى قرار Go/No-Go للانتقال إلى مرحلة Pilot (بوابة G9→G10) قبل نجاح 16/16 سيناريو من الجدول أعلاه، وبشرط أن تكون السيناريوهات ذات مسار مستخدم (01–11 على الأقل) قد نُفِّذت على جهاز Android فعلي** (وليس المحاكي فقط) — اتساقًا مع قيد «قبول ميداني على هاتف فعلي» الموثق في `docs/RELEASE_READINESS_2026-08-27.md`.
>
> - أي سيناريو Fail يعاد تنفيذه بعد الإصلاح ويُحدَّث صفه (يُذكر رقم محاولة إعادة التنفيذ في الملاحظات).
> - يُرفق هذا الجدول المكتمل بـ handoff إغلاق GF-REMAINING-009 مع نتيجة بروفة الاستعادة من `docs/runbooks/BACKUP_RESTORE.md` (البند الثاني للبوابة نفسها).
