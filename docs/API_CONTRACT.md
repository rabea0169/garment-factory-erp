# API_CONTRACT — عقد الـ API

> **تحديث GF-0004:** كل مسارات الكتابة (POST/PATCH) تستقبل الآن DTO مع class-validator: 400 على أي حقل غير معروف (forbidNonWhitelisted)، enum غير صالح، كمية/سعر غير موجب، تاريخ غير صالح، أو UUID غير صالح (مع ParseUUIDPipe على معاملي المسار لمساري الكتابة المعرّفين). حقول الهوية (userId/createdById/creatorId) في body تُرفض بـ 400 — لا تُقبل مطلقًا.

**Base URL:** `http://<host>:3005` (PORT من البيئة — ADR-0004) · **Docs:** `/api/docs` · **Auth:** `Authorization: Bearer <JWT>`

## قواعد التحقق الموحدة (GF-0004)

| القاعدة | أمثلة مرفوضة بـ 400 |
|---|---|
| حقل غير معروف في body | `userId`, `createdById`, `creatorId`, أي حقل خارج الـ DTO |
| enum غير صالح | `paymentType: 'X'`, `type`, `stage`, `status`, `rejectionReason`, `AccountType` |
| كمية/سعر غير موجب | `quantity: -2/0`, `unitPrice: 0`, `amount: -50`, `retailPrice: 0` |
| عدد صحيح مطلوب | `quantity: 1.5` (في الكميات والقطع) |
| UUID غير صالح | `customerId: 'not-a-uuid'` + أي معرف مسار للمنتج أو المتغير أو BOM أو إضافة المخزون/تحديث الحالة |
| تاريخ غير صالح | `date: 'not-a-date'` (ISO 8601) |
| مصفوفة بنود فارغة | `items: []` |

## المصادقة — `/auth`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| POST | `/auth/login` | تسجيل دخول | 🌐 **عام** | — |

## المنتجات — `/products`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/products` | قائمة المنتجات | 🔒 JWT | أي مستخدم موثّق |
| GET | `/products/:id` | منتج واحد | 🔒 JWT | أي مستخدم موثّق |
| GET | `/products/seasons` | المواسم | 🔒 JWT | أي مستخدم موثّق |
| POST | `/products` | إنشاء منتج | 🔒 JWT | GENERAL_MANAGER, PRODUCTION_MANAGER |
| POST | `/products/:id/variants` | إضافة مقاس/لون | 🔒 JWT | GENERAL_MANAGER, PRODUCTION_MANAGER؛ `:id` UUID |
| POST | `/products/:id/bom` | إضافة/تحديث مادة في BOM | 🔒 JWT | GENERAL_MANAGER, PRODUCTION_MANAGER؛ `:id` UUID |
| POST | `/products/bom/:bomId/delete` | حذف مادة من BOM | 🔒 JWT | GENERAL_MANAGER, PRODUCTION_MANAGER؛ `:bomId` UUID |

## المخزون — `/inventory`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/inventory/raw-materials` | الخامات | 🔒 JWT | أي مستخدم موثّق |
| GET | `/inventory/raw-materials/low-stock` | تنبيه النقص | 🔒 JWT | أي مستخدم موثّق |
| POST | `/inventory/raw-materials/:id/add-stock` | إضافة رصيد | 🔒 JWT | INVENTORY_MANAGER |
| GET | `/inventory/raw-materials/:id/balance-by-warehouse` | رصيد الخامة موزعاً على المستودعات | 🔒 JWT | أي مستخدم موثّق؛ `:id` UUID |
| GET | `/inventory/finished-goods` | المنتج التام | 🔒 JWT | أي مستخدم موثّق |
| GET | `/inventory/summary` | ملخص المخزون | 🔒 JWT | أي مستخدم موثّق |

يعيد `/inventory/raw-materials/:id/balance-by-warehouse` رصيد كل مستودع من `SUM(stock_ledger_entries.quantityDelta)`، وليس من آخر `balanceAfter`. وفي استجابة حركات المخزون، يمثل `balanceAfter` الرصيد بعد الحركة داخل `warehouseId` المحدد؛ أما `RawMaterial.currentStock` فيبقى الإجمالي عبر المستودعات. معرف غير صالح يرد `400`.

## Dashboard — `/dashboard`

| Method | Path | الوظيفة | الحماية | المدخلات |
|---|---|---|---|---|
| GET | `/dashboard/stats` | KPIs المبيعات والإنتاج والعمال والمخزون من قاعدة البيانات | 🔒 JWT | `from` و`to` اختياريان بصيغة ISO-8601 |

يعيد المسار `filters`, `generatedAt`, و`sales` كسلسلة شهرية من `SalesOrder.totalAmount` للطلبات غير الملغاة، و`production` كسلسلة يومية من `DailyProduction.piecesCount`، و`topWorkers` لأعلى خمسة عمال في الفترة، و`inventory` من جداول الخامات والمخزون التام. لا توجد بيانات ثابتة أو mock fallback. إذا أُرسلت `from` بعد `to` أو بصيغة غير صالحة يرد الخادم بـ400. كل رقم يرافقه تعريف في `definitions` داخل الاستجابة.

## الإنتاج — `/production`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/production/work-orders` | أوامر التشغيل | 🔒 JWT | أي مستخدم موثّق |
| POST | `/production/work-orders` | إنشاء أمر تشغيل | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |
| PATCH | `/production/work-orders/:id/status` | تحديث الحالة legacy | 🔒 JWT | PRODUCTION_MANAGER |
| POST | `/production/work-orders/:id/stage-transitions` | نقل الأمر إلى المرحلة التالية | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |
| POST | `/production/work-orders/:id/stage-output` | تسجيل مخرجات المرحلة وإغلاقها وتسجيل actor | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER؛ `:id` UUID |
| POST | `/production/work-orders/:id/material-consumptions` | صرف خامة فعلي لمرحلة | 🔒 JWT | PRODUCTION_MANAGER, INVENTORY_MANAGER, GENERAL_MANAGER |
| POST | `/production/work-orders/:id/cost/finalize` | تثبيت لقطة تكلفة المواد | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |

مسارات GF-0013 الجديدة تمرر هوية الفاعل من JWT إلى `ProductionWorkflowService`. يدعم `stage-transitions` و`stage-output` و`material-consumptions` رأس `Idempotency-Key` اختياريًا؛ تكرار المفتاح مع نفس المحتوى يعيد النتيجة دون أثر إضافي، واستخدامه مع payload مختلف أو نطاق مختلف يرد بـ409. يعيد `stage-output` الحقول الحالية `workOrderId`, `stage`, `status` مع `replayed` و`stageRunId`. لا تُرسل `actorId` أو `createdById` في body.

**ملاحظة GF-0002:** `creatorId` لم يعد يُقبل من body — يُستخرج من الجلسة (`@CurrentUser('id')`).

### قواعد مراحل GF-0013

المراحل المسموحة بالترتيب هي `CUTTING`, ثم `SEWING`, ثم `IRONING`, ثم `PACKING`. لا يقبل API القفز بين المراحل، ولا تسجيل مخرج لمرحلة غير `currentStage`. يجب أن تحقق مخرجات المرحلة `inputQty = acceptedQty + rejectedQty + wasteQty` قبل إغلاقها. أما تكلفة الوحدة فتستخدم accepted output لآخر مرحلة مكتملة، وتبقى التكلفة الحالية تكلفة مواد فقط إلى أن تعتمد مكونات العمالة والمصاريف العامة.

## الجودة والهالك — `/quality` (GF-0014)

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/quality` | سجل الفحوصات مع pagination وبيانات المرحلة والفاعل | 🔒 JWT | أي مستخدم موثّق |
| GET | `/quality/kpis` | تجميع كميات ومعدلات الجودة للفحوصات المكتملة | 🔒 JWT | أي مستخدم موثّق |
| POST | `/quality` | تسجيل فحص مكتمل مرتبط بـWorkOrder وProductionStageRun | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |

يجب أن يحتوي POST على `workOrderId`, `stageRunId`, `stage`, `checkedQty`, `passedQty`, `rejectedQty`, و`wasteQty`. يفرض الخادم وقاعدة البيانات أن تكون الكميات أعدادًا صحيحة غير سالبة وأن تحقق `checkedQty = passedQty + rejectedQty + wasteQty`. يلزم `rejectionReason` عند وجود رفض، و`wasteReason` عند وجود هالك. تُحسب `unitCost` و`wasteCost` على الخادم، ويمرر actor من JWT؛ لا تُرسل هوية الفاعل أو التكلفة في body.

يدعم POST رأس `Idempotency-Key` اختياريًا. تكرار المفتاح مع نفس المحتوى يعيد نفس الفحص دون إنشاء أثر جديد، أما استخدامه مع محتوى مختلف فيُرفض بـ409. لا يمكن تسجيل فحص لمرحلة غير مطابقة لـ`stageRun` أو لمرحلة غير مكتملة، ولا تُعدل نتيجة مكتملة مباشرة. يرفض النظام فحصًا ثانيًا لنفس `stageRunId` بـ409.

يدعم GET `/quality/kpis` المرشحات الاختيارية `stage`, `workOrderId`, `from`, و`to`. يعيد `totals` لـ`checkedQty`, `passedQty`, `rejectedQty`, `wasteQty`, و`wasteCost`، إضافة إلى `rates` كنسب مئوية ذات منزلتين: `passRate`, `rejectionRate`, و`wasteRate`. تعتمد النتائج على السجلات ذات `status = COMPLETED` فقط، ويُرفض نطاق تاريخ يبدأ بعد نهايته بـ400.

## الموارد البشرية — `/hr`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/hr/workers` | العمال | 🔒 JWT | أي مستخدم موثّق |
| GET | `/hr/workers/:id` | عامل واحد | 🔒 JWT | أي مستخدم موثّق |
| POST | `/hr/production` | تسجيل إنتاج يومي | 🔒 JWT | PRODUCTION_MANAGER, HR_MANAGER, GENERAL_MANAGER |
| POST | `/hr/advances` | صرف سلفة | 🔒 JWT | HR_MANAGER |
| POST | `/hr/payrolls` | إنشاء كشف راتب DRAFT محسوب خادميًا | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |
| POST | `/hr/payrolls/:id/approve` | اعتماد كشف راتب دون دفع أو ترحيل | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |

`POST /hr/payrolls` يستقبل `workerId`, `periodStart`, `periodEnd`, و`notes` فقط. يحسب الخادم `grossAmount` من مجموع `DailyProduction.totalAmount` داخل الفترة، ويحسب `advanceDeduct` من السلف داخل الفترة بحد أقصى gross، ويجعل `absenceDeduct = 0` في MVP وفق ADR-0015. لا يقبل `grossAmount` أو `netAmount` أو الخصومات من العميل، و`netAmount = grossAmount - advanceDeduct - absenceDeduct`. الفترة شاملة لطرفيها، وسجل العامل والفترة فريد.

يدعم الإنشاء والاعتماد رأس `Idempotency-Key` اختياريًا. نفس المفتاح ونفس المحتوى يعيدان الاستجابة المخزنة دون أثر ثانٍ، والمحتوى المختلف أو التكرار المتزامن يُرفض بـ409. الإنشاء يسجل `createdById` والاعتماد يسجل `approvedById` و`approvedAt` من JWT. لا يسمح اعتماد سجل معتمد ولا يغيّر `isPaid`; الدفع والقيد المالي مؤجلان إلى GF-0018.

## المشتريات — `/purchasing`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/purchasing/orders` | أوامر الشراء مع pagination | 🔒 JWT | أي مستخدم موثّق |
| POST | `/purchasing` | إنشاء أمر شراء | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER |
| POST | `/purchasing/:id/receipts` | استلام جزئي أو كامل إلى مخزن الخامات | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER |
| PUT | `/purchasing/:id/receive` | استلام legacy كامل | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER |
| POST | `/purchasing/:id/return` | مرتجع إلى المورد | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER |

يتطلب `POST /purchasing/:id/receipts` قائمة غير فارغة بلا تكرار لبند أمر الشراء. يتحقق الخادم من الكمية المتبقية، وينشئ receipt وحركات `RECEIVE` في `StockLedgerEntry`، ويرحل قيداً آلياً متوازناً (مدين مخزون / دائن حسابات دائنة) ويحدّث رصيد المورد وحالة الأمر داخل transaction واحدة؛ لا تُؤخذ الكمية أو التكلفة من حقيقة يرسلها العميل خارج عناصر أمر الشراء. يدعم الرأس الاختياري `Idempotency-Key`، وتكرار المفتاح مع نفس المحتوى يعيد الاستجابة دون receipt أو ledger أو قيد إضافي، بينما المحتوى المختلف يُرفض بـ409. مسار المرتجع يعكس المخزون والقيد والذمم داخل transaction واحدة، ويمنع سباق مرتجعين يتجاوزان الكمية المستلمة. يجب إثبات اختبارات PostgreSQL على CI قبل التشغيل المشترك.

## المبيعات — `/sales`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/sales/customers` | العملاء | 🔒 JWT | أي مستخدم موثّق |
| POST | `/sales/customers` | عميل جديد | 🔒 JWT | CASHIER, GENERAL_MANAGER |
| GET | `/sales/orders` | أوامر البيع | 🔒 JWT | أي مستخدم موثّق |
| POST | `/sales/orders` | إنشاء أمر بيع | 🔒 JWT | CASHIER, GENERAL_MANAGER |

يدعم `POST /sales/orders` رأس `Idempotency-Key` اختياريًا. نفس المفتاح ونفس payload يعيدان أمر البيع نفسه، وإعادة استخدام المفتاح بمحتوى مختلف تُرفض بـ409.

**ملاحظة GF-0002:** `userId` لم يعد يُقبل من body — من الجلسة.

## الشحن — `/shipping`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/shipping` | الشحنات مع pagination | 🔒 JWT | أي مستخدم موثّق |
| POST | `/shipping` | إنشاء شحنة | 🔒 JWT | CASHIER, GENERAL_MANAGER |
| PATCH | `/shipping/:id/status` | انتقال حالة شحنة | 🔒 JWT | CASHIER, GENERAL_MANAGER |

تُقبل انتقالات الشحنة فقط وفق `PREPARING → SHIPPED → IN_TRANSIT → DELIVERED`، مع `IN_TRANSIT → RETURNED` أو `DELIVERED → RETURNED`. يتطلب `DELIVERED` حقل `proofOfDelivery` غير فارغ، ويأخذ الخادم `deliveredById` و`deliveredAt` من الجلسة/الخادم. التحديث الذري المشروط بالحالة السابقة يمنع سباق الانتقالات ويسجل ActivityLog. عند الانتقال إلى `SHIPPED` يصرف الخادم عناصر أمر البيع من مخزن المنتج التام عبر InventoryService داخل نفس transaction، وفشل أي عنصر يعيد العملية كاملة.

يدعم `POST /shipping` رأس `Idempotency-Key` اختياريًا. نفس المفتاح مع نفس body وactor يعيد الشحنة دون إنشاء جديد، وإعادة استخدامه بمحتوى مختلف تُرفض بـ409. actor مأخوذ من JWT ولا يُقبل من body.

## المحاسبة — `/accounting`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/accounting/accounts` | شجرة الحسابات | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| POST | `/accounting/accounts` | حساب جديد | 🔒 JWT | ACCOUNTANT |
| GET | `/accounting/vouchers` | أوامر الصرف | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| POST | `/accounting/vouchers` | أمر صرف جديد | 🔒 JWT | ACCOUNTANT, CASHIER |
| POST | `/accounting/journal-entries/:id/reverse` | عكس قيد مالي مرة واحدة | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| POST | `/accounting/fiscal-periods` | إنشاء فترة مالية مفتوحة | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| PATCH | `/accounting/fiscal-periods/:id/close` | إغلاق فترة مالية | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| POST | `/accounting/journal-entries` | إنشاء قيد متعدد البنود داخل فترة مفتوحة | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |

يدعم إنشاء السند رأس `Idempotency-Key` اختياريًا. نفس المفتاح ونفس المحتوى يعيدان النتيجة دون إنشاء قيد أو سند مكرر، أما إعادة استخدام المفتاح بمحتوى مختلف فتُرفض بـ409. إنشاء الـVoucher والقيد وتحديث الخزينة والذمم يتم داخل transaction واحدة.

الفترات المالية لا تتداخل، ويُمنع الترحيل في فترة CLOSED أو بتاريخ خارج حدود الفترة. يقبل `POST /accounting/journal-entries` `description`, `reference`, `fiscalPeriodId`, `date` الاختياري، و`lines[]` الموجبة؛ يتحقق المحرك من الحسابات النشطة وتوازن المدين/الدائن ويأخذ `createdById` من JWT. إغلاق الفترة مشروط بحالتها الحالية ويسجل ActivityLog، ولا توجد كتابة دفع أو VAT آلية في هذا المسار.

**ملاحظة GF-0002:** `createdById` لم يعد يُقبل من body — من الجلسة.

## الصحة والتشغيل — `/health`

| Method | Path | الوظيفة | الحماية |
|---|---|---|---|
| GET | `/health` | فحص liveness للعملية فقط | 🌐 عام |
| GET | `/health/ready` | فحص readiness واتصال PostgreSQL | 🌐 عام |

`/health/ready` يعيد 200 فقط عند نجاح استعلام قاعدة البيانات، ويعيد 503 دون كشف تفاصيل الاتصال عند عدم الجاهزية.

## الجذر

| Method | Path | الوظيفة | الحماية |
|---|---|---|---|
| GET | `/` | رسالة ترحيب | 🌐 عام |

**إصلاح GF-0002:** كان `AppController` غير مسجّل في `AppModule` (GET / يرجع 404) — خلل قديم أُصلح.

## قواعد الحماية العامة (مفعّلة)

1. `SUPER_ADMIN` يتجاوز كل قيود `@Roles()`.
2. التوكن المنتهي/الغير صالح/لمستخدم موقوف → 401.
3. أي مسار جديد يُضاف لاحقًا **محمي افتراضيًا** — لا حاجة لتذكر الحماية؛ فقط أضف `@Public()` إن كان عامًا فعلًا (وبأقصى تضييق).
4. مصادقة الإقلاع fail-closed: غياب `JWT_SECRET`/`DATABASE_URL` (وفي الإنتاج: سر <32 حرفًا أو CORS مفتوح) → فشل إقلاع فوري.

## عقد Pagination الموحد (GF-0012)

كل endpoint يعيد قائمة يجب أن يستخدم query parameters التالية ما لم يُذكر استثناء صريح:

| Parameter | Default | Limit | Validation |
|---|---:|---:|---|
| `page` | 1 | — | integer >= 1 |
| `limit` | 20 | 100 | integer between 1 and 100 |

شكل الاستجابة الموحد هو:

```json
{
  "data": [],
  "meta": {
    "total": 0,
    "page": 1,
    "pageSize": 20,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

تطبّق القوائم الحالية هذا العقد على المنتجات، المواسم، الخامات، المخازن، ledger، المنتجات التامة، أوامر التشغيل، أوامر الشراء، العملاء، أوامر البيع، العمال، الجودة، الشحن، الحسابات، والسندات. أما endpoints الملخصات والتفاصيل المفردة فلا تستخدم pagination.

## ثغرات العقد المتبقية (تُغلق تباعًا)

1. **لا endpoint للـ Dashboard/Reports** رغم أن Flutter يطلب `/dashboard/stats` (P1-05 — GF-0019).
2. ~~**لا pagination** في القوائم~~ — ✅ **أُغلقت في GF-0012** بعقد موحد واختبارات حدودية.
3. ~~**لا DTOs** في معظم مسارات الكتابة~~ — ✅ **أُغلقت في GF-0004**.
4. ~~**لا معالج أخطاء موحد**~~ — ✅ **أُغلق في Cluster 4** عبر Global Exception Filter؛ يجب إضافة اختبارات عقدية لأي أخطاء جديدة.
5. ~~**قاعدة المجال المؤجلة**: `checked = passed + rejected` في فحص الجودة~~ — ✅ تُفرض في GF-0014 مع فصل `wasteQty` و`wasteReason` وربط `stageRun`.

## أمثلة Payloads الصحيحة (GF-0004)

> **تنبيه:** أمثلة القوائم تستخدم `GET /path?page=1&limit=20` وتعيد العقد الموحد أعلاه. سعر بند البيع لا يُرسل من العميل؛ الخادم يقرأ السعر من المنتج.

```jsonc
// POST /sales/orders
{
  "customerId": "uuid", "paymentType": "CASH", "discount": 0,
  "items": [{ "productVariantId": "uuid", "quantity": 2 }]
}
// POST /accounting/vouchers  { "type": "PAYMENT", "amount": 500, "description": "صرف نثريات" }
// POST /production/work-orders  { "productVariantId": "uuid", "bomVersionId": "uuid", "quantity": 100 }
// PATCH /production/work-orders/:uuid/status  { "status": "SEWING" }
// POST /production/work-orders/:uuid/stage-transitions
// Header: Idempotency-Key: transition-2026-001
// Body: { "toStage": "CUTTING", "reason": "بدء القص" }
// POST /production/work-orders/:uuid/stage-output
// Body: { "stage": "CUTTING", "inputQty": 100, "acceptedQty": 95, "rejectedQty": 3, "wasteQty": 2 }
// POST /production/work-orders/:uuid/material-consumptions
// Header: Idempotency-Key: consumption-2026-001
// Body: { "stageRunId": "uuid", "rawMaterialId": "uuid", "warehouseId": "uuid", "plannedQuantity": 50, "actualQuantity": 52, "wasteQuantity": 2, "unit": "METER", "wasteReason": "CUTTING_LOSS" }
// POST /production/work-orders/:uuid/cost/finalize
// Body: {}
// POST /inventory/raw-materials/:uuid/add-stock  { "quantity": 50, "costPerUnit": 45.5 }
// POST /hr/production  { "workerId": "uuid", "workOrderId": "uuid?", "date": "2026-08-25T00:00:00.000Z", "piecesCount": 100 }
// POST /hr/advances  { "workerId": "uuid", "amount": 200, "notes": "اختياري" }
// POST /hr/payrolls  { "workerId": "uuid", "periodStart": "2026-08-01", "periodEnd": "2026-08-31", "notes": "اختياري" }
// POST /hr/payrolls/:id/approve  Header: Idempotency-Key: payroll-approve-2026-08
// POST /quality  { "workOrderId": "uuid", "stage": "SEWING", "checkedQty": 100, "passedQty": 95, "rejectedQty": 5 }
// POST /products  { "code": "PRD-T01", "name": "تيشيرت", "category": "تيشيرت", "retailPrice": 250, "wholesalePrice": 180, "seasonId": "uuid?" }
// POST /sales/customers  { "name": "عميل", "phone": "اختياري", "address": "اختياري" }
// POST /shipping  { "salesOrderId": "uuid", "shippingCost": 75, "trackingNumber": "اختياري" }
// POST /accounting/accounts  { "code": "1000", "name": "الصندوق", "type": "ASSET", "parentId": "uuid?", "isGroup": false }
```

