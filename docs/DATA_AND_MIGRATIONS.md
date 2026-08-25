# DATA_AND_MIGRATIONS — قاعدة البيانات والمهاجرات

## 1. الحالة الحالية

- **المحرك:** PostgreSQL 16 (docker-compose، مستخدم `postgres`، DB `garment_erp`).
- **ORM:** Prisma 7.9.1 مع `@prisma/adapter-pg` (Pool يدوي في `prisma.service.ts`).
- **المخطط:** `backend/prisma/schema.prisma` — 34 model، 10 enums.
- **المهاجرات المطبقة:** migration واحدة فقط — `20260823183624_init`.
- **بيانات seed:** `backend/prisma/seed.ts` — admin واحد + خامتان + منتج وvariantان + BOM + عاملان. Seed يستخدم connection string ثابتة (P0-03).
- **لا توجد بيئات** staging/production بعد — التطوير المحلي فقط.

## 2. سياسة المهاجرات (إلزامية)

1. كل تعديل على `schema.prisma` **يتبع migration باسم وصفي**: `npx prisma migrate dev --name <وصف>`.
2. **يُمنع** `prisma db push` خارج التطوير المحلي الشخصي، ويُمنع مطلقًا على staging/production.
3. **يُمنع تعديل migration مطبقة** — التراجع أو التصحيح بـ migration جديدة.
4. كل migration تصاحبها في المهمة: وصف الأثر على البيانات القديمة، خطة rollback (الخطوات أو SQL العكسي)، وحالة الاختبار على نسخة بيانات.
5. Backup قبل أي migration على بيئة مشتركة، وrestore drill دوري في المراحل 10+.

## 3. فجوات المخطط المسجلة (تُغلق في المراحل 2–7 وفق MASTER_BACKLOG)

| # | الفجوة | الأثر | المرحلة |
|---|---|---|---|
| 1 | **لا Warehouse/Location** — المخزون موضع واحد ضمني | لا يمكن فصل مخزن خامات/تام أو تحويلات | 3 |
| 2 | **لا Stock Ledger موحد** — `currentStock` حقل يُحدَّث مباشرة | لا تدقيق للرصيد؛ race conditions | 3 |
| 3 | **`WorkOrder.productId`** يرتبط بالمنتج لا الـ variant | أمر إنتاج بلا SKU محدد | 4 |
| 4 | **BOM بلا version ولا فعالية زمنية** (`BomItem` مسطح) | لا يمكن تثبيت وصفة عند بدء أمر | 3–4 |
| 5 | **لا idempotency key** لأي عملية | ازدواج من الهاتف عند retry | 3 |
| 6 | **`JournalLine` نموذج مبسط** (debit account + credit account لكل سطر) | لا double-entry كامل بعدة أسطر متوازنة | 7 |
| 7 | **لا Fiscal Period** | لا إغلاق فترة ولا منع ترحيل على فترة مغلقة | 7 |
| 8 | **لا soft-delete/isActive كافٍ** — حذف مادي ممكن لكيانات ذات تاريخ مالي | يكسر التدقيق | 2 |
| 9 | **لا indexes** فوق الأكواد/التواريخ/الحالات مطلوبة للأداء | بطء القوائم والتقارير | 2–3 |
| 10 | **لا audit columns** (createdBy/updatedAt) على حركات المخزون والقيود | تتبع منفّذ العملية | 2–3 |
| 11 | `FinishedGood.productVariantId @unique` | مخزون التام لكل variant في صف واحد بلا مخزن ولا تكلفة | 3 |
| 12 | `Treasury.type` نص حر (`String`) بدل enum | قيم غير متسقة | 7 |

## 4. قواعد سلامة البيانات (إلزامية من الآن)

1. أي عملية تعدل أكثر من جدول → `prisma.$transaction`.
2. الرصيد لا يُعدل مباشرة من الواجهة — عبر حركة موثقة (بعد بناء ledger؛ حتى ذلك الحين تُوثق كل عملية تعديل رصيد في handoff).
3. `Decimal` للأموال والكميات — لا `Number` float في المسارات المالية.
4. لا حذف نهائي لسجلات مالية/مخزنية — `isActive` أو حركة عكسية.
5. القيم المالية (total/balance/amount) تُحسب في الخادم دائمًا.

## 5. نقاط الاسترجاع (Rollback hooks)

- المستودع: `git revert` لأي commit — لا migration بعد عكس schema إلا بmigration عكسية.
- قاعدة البيانات محليًا: إعادة `docker-compose down -v` ثم `migrate dev` + seed (بيانات تطوير فقط — لا بيانات إنتاج موجودة بعد).
