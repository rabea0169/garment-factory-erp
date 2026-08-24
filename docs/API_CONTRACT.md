# API_CONTRACT — عقد الـ API

> **تحديث GF-0002:** كل المسارات محمية الآن بـ JWT عبر `JwtAuthGuard` عالمي (APP_GUARD). المسارات العامة فقط: `POST /auth/login` و `GET /`. القيود الدقيقة عبر `@Roles()` + `RolesGuard`. مصفوفة الأدوار أدناه **مفعّلة ومختبرة** (401/403) في `backend/test/auth-guard.e2e-spec.ts`.

**Base URL:** `http://<host>:3005` (PORT من البيئة — ADR-0004) · **Docs:** `/api/docs` · **Auth:** `Authorization: Bearer <JWT>`

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
| PATCH | `/production/work-orders/:id/status` | تحديث حالة/مرحلة | 🔒 JWT | PRODUCTION_MANAGER |

**ملاحظة GF-0002:** `creatorId` لم يعد يُقبل من body — يُستخرج من الجلسة (`@CurrentUser('id')`).

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

**ملاحظة GF-0002:** `createdById` لم يعد يُقبل من body — من الجلسة.

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

## ثغرات العقد المتبقية (تُغلق تباعًا)

1. **لا endpoint للـ Dashboard/Reports** رغم أن Flutter يطلب `/dashboard/stats` (P1-05 — GF-0019).
2. **لا pagination** في أي قائمة (P1-10 — GF-0012).
3. **لا DTOs** في معظم مسارات الكتابة — `@Body() any` (P0-05 — GF-0004).
4. **لا معالج أخطاء موحد** — أخطاء Prisma تتسرب بتفاصيلها (P2-05).
5. Flutter `ApiClient` لا يضيف التوكن للطلبات بعد (P1-04 — GF-0010) — الحماية جاهزة server-side.
