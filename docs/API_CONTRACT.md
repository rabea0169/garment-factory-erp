# API_CONTRACT — عقد الـ API الحالي (كما هو في الكود)

> القاعدة: **كل مسار أدناه مكشوف حاليًا بلا مصادقة** (P0-01). هذا الملف يوثق العقد الفعلي، والعمود "الحماية المطلوبة" هو الهدف في GF-0002.

**Base URL:** `http://<host>:3000` افتراضيًا (Flutter يطلب 3005 — تعارض مسجل P1-12) · **Docs:** `/api/docs` · **Auth (مخطط):** Bearer JWT

## المصادقة — `/auth`

| Method | Path | الوظيفة | حماية حالية | الحماية المطلوبة | ملاحظات |
|---|---|---|---|---|---|
| POST | `/auth/login` | تسجيل دخول | عامة | Public (مع rate limit) | يرجع `access_token` + user |

## المنتجات — `/products` و`/products/seasons`

| Method | Path | الوظيفة | حماية حالية | الحماية المطلوبة |
|---|---|---|---|---|
| GET | `/products` | قائمة المنتجات | ❌ مكشوف | JWT + (VIEWER فأعلى) |
| GET | `/products/:id` | منتج واحد | ❌ مكشوف | JWT |
| POST | `/products` | إنشاء منتج | ❌ مكشوف | JWT + GENERAL_MANAGER/PRODUCTION_MANAGER |
| GET | `/products/seasons` | المواسم | ❌ مكشوف | JWT |

## المخزون — `/inventory`

| Method | Path | الوظيفة | حماية حالية | الحماية المطلوبة |
|---|---|---|---|---|
| GET | `/inventory/raw-materials` | الخامات | ❌ مكشوف | JWT |
| GET | `/inventory/raw-materials/low-stock` | تنبيه النقص | ❌ مكشوف | JWT |
| POST | `/inventory/raw-materials/:id/add-stock` | إضافة رصيد | ❌ مكشوف | JWT + INVENTORY_MANAGER |
| GET | `/inventory/finished-goods` | المنتج التام | ❌ مكشوف | JWT |
| GET | `/inventory/summary` | ملخص المخزون | ❌ مكشوف | JWT |

## الإنتاج — `/production`

| Method | Path | الوظيفة | حماية حالية | الحماية المطلوبة |
|---|---|---|---|---|
| GET | `/production/work-orders` | أوامر التشغيل | ❌ مكشوف | JWT |
| POST | `/production/work-orders` | إنشاء أمر تشغيل | ❌ مكشوف | JWT + PRODUCTION_MANAGER/GENERAL_MANAGER |
| PATCH | `/production/work-orders/:id/status` | تحديث حالة/مرحلة | ❌ مكشوف | JWT + PRODUCTION_MANAGER |

## الجودة — `/quality`

| Method | Path | الوظيفة | حماية حالية | الحماية المطلوبة |
|---|---|---|---|---|
| GET | `/quality` | سجل الفحوصات | ❌ مكشوف | JWT |
| POST | `/quality` | تسجيل فحص | ❌ مكشوف | JWT + أي دور تشغيلي |

## الموارد البشرية — `/hr`

| Method | Path | الوظيفة | حماية حالية | الحماية المطلوبة |
|---|---|---|---|---|
| GET | `/hr/workers` | العمال | ❌ مكشوف | JWT |
| GET | `/hr/workers/:id` | عامل واحد | ❌ مكشوف | JWT |
| POST | `/hr/production` | تسجيل إنتاج يومي | ❌ مكشوف | JWT + مشرف/PRODUCTION_MANAGER |
| POST | `/hr/advances` | صرف سلفة | ❌ مكشوف | JWT + HR_MANAGER |

## المبيعات — `/sales`

| Method | Path | الوظيفة | حماية حالية | الحماية المطلوبة |
|---|---|---|---|---|
| GET | `/sales/customers` | العملاء | ❌ مكشوف | JWT |
| POST | `/sales/customers` | عميل جديد | ❌ مكشوف | JWT + CASHIER فأعلى |
| GET | `/sales/orders` | أوامر البيع | ❌ مكشوف | JWT |
| POST | `/sales/orders` | إنشاء أمر بيع | ❌ مكشوف + `@Body() any` (P0-05) | JWT + CASHIER فأعلى |

## الشحن — `/shipping`

| Method | Path | الوظيفة | حماية حالية | الحماية المطلوبة |
|---|---|---|---|---|
| GET | `/shipping` | الشحنات | ❌ مكشوف | JWT |
| POST | `/shipping` | إنشاء شحنة | ❌ مكشوف | JWT + CASHIER/GENERAL_MANAGER |

## المحاسبة — `/accounting`

| Method | Path | الوظيفة | حماية حالية | الحماية المطلوبة |
|---|---|---|---|---|
| GET | `/accounting/accounts` | شجرة الحسابات | ❌ مكشوف | JWT + ACCOUNTANT/GENERAL_MANAGER |
| POST | `/accounting/accounts` | حساب جديد | ❌ مكشوف | JWT + ACCOUNTANT |
| GET | `/accounting/vouchers` | أوامر الصرف | ❌ مكشوف | JWT + ACCOUNTANT |
| POST | `/accounting/vouchers` | أمر صرف جديد | ❌ مكشوف + `createdById` من body (P0-04) | JWT + ACCOUNTANT/CASHIER |

## الجذر

| Method | Path | الوظيفة | حماية حالية |
|---|---|---|---|
| GET | `/` | رسالة ترحيب | عامة |

## ثغرات العقد المسجلة (تُغلق تباعًا)

1. **لا endpoint للـ Dashboard/Reports** رغم أن Flutter يطلب `/dashboard/stats` — يرجع 404 ثم mock (P1-05).
2. **لا pagination** في أي قائمة.
3. **لا DTOs** في معظم مسارات الكتابة — `@Body() any` يمر كما هو.
4. **`userId/createdById/creatorId` من body** في sales/accounting/production (P0-04).
5. **لا معالج أخطاء موحد** — أخطاء Prisma تتسرب بتفاصيلها للعميل.
6. **الهيكل التشغيلي للأدوار** (`UserRole`): SUPER_ADMIN, GENERAL_MANAGER, PRODUCTION_MANAGER, INVENTORY_MANAGER, ACCOUNTANT, CASHIER, HR_MANAGER, VIEWER — المصفوفة أعلاه مبدئية وتُعتمد نهائيًا في GF-0002 مع اختبارات 403.

> عند أي تعديل على endpoint قائم: حدّث هذا الملف + Flutter client + الاختبارات في نفس المهمة.
