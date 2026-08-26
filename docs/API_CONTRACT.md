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
| UUID غير صالح | `customerId: 'not-a-uuid'` + معامل مسار إضافة المخزون/تحديث الحالة |
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

## المخزون — `/inventory`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/inventory/raw-materials` | الخامات | 🔒 JWT | أي مستخدم موثّق |
| GET | `/inventory/raw-materials/low-stock` | تنبيه النقص | 🔒 JWT | أي مستخدم موثّق |
| POST | `/inventory/raw-materials/:id/add-stock` | إضافة رصيد | 🔒 JWT | INVENTORY_MANAGER |
| GET | `/inventory/finished-goods` | المنتج التام | 🔒 JWT | أي مستخدم موثّق |
| GET | `/inventory/summary` | ملخص المخزون | 🔒 JWT | أي مستخدم موثّق |

## الإنتاج — `/production`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/production/work-orders` | أوامر التشغيل | 🔒 JWT | أي مستخدم موثّق |
| POST | `/production/work-orders` | إنشاء أمر تشغيل | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |
| PATCH | `/production/work-orders/:id/status` | تحديث الحالة legacy | 🔒 JWT | PRODUCTION_MANAGER |
| POST | `/production/work-orders/:id/stage-transitions` | نقل الأمر إلى المرحلة التالية | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |
| POST | `/production/work-orders/:id/stage-output` | تسجيل مخرجات المرحلة وإغلاقها وتسجيل actor | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |
| POST | `/production/work-orders/:id/material-consumptions` | صرف خامة فعلي لمرحلة | 🔒 JWT | PRODUCTION_MANAGER, INVENTORY_MANAGER, GENERAL_MANAGER |
| POST | `/production/work-orders/:id/cost/finalize` | تثبيت لقطة تكلفة المواد | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |

مسارات GF-0013 الجديدة تمرر هوية الفاعل من JWT إلى `ProductionWorkflowService`. يدعم `stage-transitions` و`material-consumptions` رأس `Idempotency-Key` اختياريًا؛ تكرار المفتاح مع نفس المحتوى يعيد النتيجة دون أثر إضافي، واستخدامه مع payload مختلف يرد بـ409. لا تُرسل `actorId` أو `createdById` في body.

**ملاحظة GF-0002:** `creatorId` لم يعد يُقبل من body — يُستخرج من الجلسة (`@CurrentUser('id')`).

### قواعد مراحل GF-0013

المراحل المسموحة بالترتيب هي `CUTTING`, ثم `SEWING`, ثم `IRONING`, ثم `PACKING`. لا يقبل API القفز بين المراحل، ولا تسجيل مخرج لمرحلة غير `currentStage`. يجب أن تحقق مخرجات المرحلة `inputQty = acceptedQty + rejectedQty + wasteQty` قبل إغلاقها. أما تكلفة الوحدة فتستخدم accepted output لآخر مرحلة مكتملة، وتبقى التكلفة الحالية تكلفة مواد فقط إلى أن تعتمد مكونات العمالة والمصاريف العامة.

## الجودة — `/quality`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/quality` | سجل الفحوصات | 🔒 JWT | أي مستخدم موثّق |
| POST | `/quality` | تسجيل فحص | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |

## الموارد البشرية — `/hr`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/hr/workers` | العمال | 🔒 JWT | أي مستخدم موثّق |
| GET | `/hr/workers/:id` | عامل واحد | 🔒 JWT | أي مستخدم موثّق |
| POST | `/hr/production` | تسجيل إنتاج يومي | 🔒 JWT | PRODUCTION_MANAGER, HR_MANAGER, GENERAL_MANAGER |
| POST | `/hr/advances` | صرف سلفة | 🔒 JWT | HR_MANAGER |

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
| GET | `/shipping` | الشحنات | 🔒 JWT | أي مستخدم موثّق |
| POST | `/shipping` | إنشاء شحنة | 🔒 JWT | CASHIER, GENERAL_MANAGER |

## المحاسبة — `/accounting`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/accounting/accounts` | شجرة الحسابات | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| POST | `/accounting/accounts` | حساب جديد | 🔒 JWT | ACCOUNTANT |
| GET | `/accounting/vouchers` | أوامر الصرف | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| POST | `/accounting/vouchers` | أمر صرف جديد | 🔒 JWT | ACCOUNTANT, CASHIER |
| POST | `/accounting/journal-entries/:id/reverse` | عكس قيد مالي مرة واحدة | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |

يدعم إنشاء السند رأس `Idempotency-Key` اختياريًا. نفس المفتاح ونفس المحتوى يعيدان النتيجة دون إنشاء قيد أو سند مكرر، أما إعادة استخدام المفتاح بمحتوى مختلف فتُرفض بـ409. إنشاء الـVoucher والقيد وتحديث الخزينة والذمم يتم داخل transaction واحدة.

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
5. **قاعدة المجال المؤجلة**: `checked = passed + rejected` في فحص الجودة تُفرض في GF-0014.

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
// POST /quality  { "workOrderId": "uuid", "stage": "SEWING", "checkedQty": 100, "passedQty": 95, "rejectedQty": 5 }
// POST /products  { "code": "PRD-T01", "name": "تيشيرت", "category": "تيشيرت", "retailPrice": 250, "wholesalePrice": 180, "seasonId": "uuid?" }
// POST /sales/customers  { "name": "عميل", "phone": "اختياري", "address": "اختياري" }
// POST /shipping  { "salesOrderId": "uuid", "shippingCost": 75, "trackingNumber": "اختياري" }
// POST /accounting/accounts  { "code": "1000", "name": "الصندوق", "type": "ASSET", "parentId": "uuid?", "isGroup": false }
```

