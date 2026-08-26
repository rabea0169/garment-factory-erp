# DATA_AND_MIGRATIONS — قاعدة البيانات والمهاجرات

## 1. الحالة الحالية

- **المحرك:** PostgreSQL 16 (docker-compose، مستخدم `postgres`، DB `garment_erp`).
- **ORM:** Prisma 7.9.1 مع `@prisma/adapter-pg` (Pool يدوي في `prisma.service.ts`).
- **المخطط:** `backend/prisma/schema.prisma` — 37 model، 12 enums.
- **المهاجرات المطبقة:** `20260823183624_init` ← `20260825070834_domain_foundation_warehouse_stock_ledger_idempotency` (GF-0007 — غير مطبقة بعد على بيئة مشتركة؛ التطوير المحلي فقط).
- **بيانات seed:** `backend/prisma/seed.ts` — admin واحد + مخزنان (WH-RAW/WH-FG) + خامتان بأرصدة افتتاحية مبررة بحركات ledger + منتج وvariantان + BOM + عاملان. Admin يتطلب `SEED_ADMIN_PASSWORD` من البيئة (ADR-0006).
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
| 1 | **لا Warehouse/Location** — **مغلقة (GF-0007):** نموذج `Warehouse` + `WarehouseType` | حركات المخزون تلزم بتحديد مخزن منذ الآن | ✅ 2 |
| 2 | **لا Stock Ledger موحد** — **مغلق جزئيًا (GF-0007):** `StockLedgerEntry` موحد (خامة أو variant) وكل تحديث لـ `currentStock` يمر به داخل `$transaction` | تبقى حركات التام والتحويلات بين المخازن (GF-0008/0009) | ✅ 2 (جزئي) |
| 3 | **`WorkOrder.productId`** يرتبط بالمنتج لا الـ variant | أمر إنتاج بلا SKU محدد | 4 |
| 4 | **BOM بلا version ولا فعالية زمنية** (`BomItem` مسطح) | لا يمكن تثبيت وصفة عند بدء أمر | 3–4 |
| 5 | **لا idempotency key** لأي عملية — **مغلقة (GF-0007):** `IdempotencyKey` + ترويسة `Idempotency-Key` في مسارات الحركات | إعادة الإرسال من الهاتف بلا أثر مزدوج | ✅ 2 |
| 6 | **`JournalLine` نموذج مبسط** (debit account + credit account لكل سطر) | لا double-entry كامل بعدة أسطر متوازنة | 7 |
| 7 | **لا Fiscal Period** | لا إغلاق فترة ولا منع ترحيل على فترة مغلقة | 7 |
| 8 | **لا soft-delete/isActive كافٍ** — حذف مادي ممكن لكيانات ذات تاريخ مالي | يكسر التدقيق | 2 |
| 9 | **لا indexes** فوق الأكواد/التواريخ/الحالات مطلوبة للأداء — **مغلقة للجداول الجديدة (GF-0007):** 9 indexes + `raw_materials(code, isActive)` | الجداول القديمة تُفهرس عند لمسها في مهامها | ✅ 2 (للجديد) |
| 10 | **لا audit columns** (createdBy/updatedAt) على حركات المخزون — **مغلق جزئيًا (GF-0007):** `createdById`+`createdAt` على `StockLedgerEntry` | القيود المحاسبية القديمة بلا منشئ | 2–3 |
| 11 | `FinishedGood.productVariantId @unique` | مخزون التام لكل variant في صف واحد بلا مخزن ولا تكلفة — يُعاد تصميمه عند دمج التام في ledger | 3 |
| 12 | `Treasury.type` نص حر (`String`) بدل enum | قيم غير متسقة | 7 |

## 4. قواعد سلامة البيانات (إلزامية من الآن)

1. أي عملية تعدل أكثر من جدول → `prisma.$transaction`.
2. **الرصيد لا يُعدل مباشرة من أي مكان خارج InventoryService (GF-0007)** — وداخلها لا يتغير `currentStock` إلا عبر `StockLedgerEntry` واحدة داخل `prisma.$transaction` واحدة. المسار القديم `add-stock` نفسه موجّه عبر هذه القناة بلا استثناء.
3. `Decimal` للأموال والكميات — لا `Number` float في المسارات المالية.
4. لا حذف نهائي لسجلات مالية/مخزنية — `isActive` أو حركة عكسية.
5. القيم المالية (total/balance/amount) تُحسب في الخادم دائمًا.

### 4.1 GF-REMAINING-002 — رصيد الخامة حسب المستودع

- `RawMaterial.currentStock` هو snapshot للإجمالي عبر جميع المستودعات، ولا يُستخدم لعرض رصيد مستودع منفرد.
- الرصيد التشغيلي لكل مستودع هو `SUM(stock_ledger_entries.quantityDelta)` مع ترشيح `rawMaterialId` و`warehouseId`. لا يعتمد الاستعلام على آخر `balanceAfter` لأن هذا الحقل لقطة تدقيق وقديمة قد تكون كُتبت بدلالة الإجمالي قبل هذا الإصلاح.
- عند تنفيذ حركة خامة، تُقفل صف الخامة عبر `UPDATE ... increment` داخل transaction، ثم يُجمع ledger للمستودع نفسه، ويُكتب `balanceAfter` كرصد ذلك المستودع. يُرفض الصرف إذا أصبح الإجمالي أو رصيد المستودع سالبًا، ويؤدي الرفض إلى rollback كامل.
- لا توجد migration في GF-REMAINING-002؛ لا تغيير في schema ولا حذف أو backfill. يجب تشغيل reconciliation على كل خامة قبل أي بيئة مشتركة، ومقارنة `RawMaterial.currentStock` مع مجموع ledger الإجمالي، ثم مراجعة أي فروق legacy بقرار تدقيق مستقل.
- اختبار PostgreSQL الحقيقي في `backend/test/inventory-warehouse.integration-spec.ts` يثبت مستودعين منفصلين، مطابقة الإجمالي، اختلاف `balanceAfter` بين المستودعات، وتعارض صرف متزامن مع rollback.

## 5. Migration GF-REMAINING-003 — Stage Output Idempotency

**الاسم:** `20260830060000_gf_remaining_003_stage_output_idempotency`

تضيف migration العمود nullable `production_stage_runs.idempotencyKeyId` مع unique index وFK إلى `idempotency_keys`. لا تعدّل مخرجات المراحل القديمة ولا تنشئ مفاتيح لها؛ الطلبات الجديدة التي تحمل `Idempotency-Key` تربط المفتاح بالـ`ProductionStageRun` داخل transaction واحدة. replay بالمفتاح والمحتوى نفسه يعيد النتيجة دون تحديث أو activity log إضافي، بينما المحتوى المختلف أو النطاق المختلف يُرفض بـ409.

التغيير additive وغير تدميري، ولا يتطلب backfill. يجب تشغيل `npx prisma migrate deploy` على PostgreSQL نظيفة ونسخة بيانات legacy، ثم تشغيل اختبارات workflow والتزامن. rollback عبر backup/restore أو migration عكسية معتمدة بعد إيقاف مسار stage-output؛ SQL العكسي هو حذف FK والفهرس والعمود فقط، ولا يُحذف أي stage run أو idempotency record يدويًا.

## 6. Migration GF-0014 — Quality and Waste

**الاسم:** `20260830000000_gf0014_quality_waste`

### ما تفعله

1. تضيف `QualityWasteReason` و`QualityCheckStatus`، وتربط الفحص اختياريًا بـ`ProductionStageRun` وبالفاعل `User` وبمفتاح idempotency.
2. تضيف `wasteQty`, `wasteReason`, `unitCost`, `wasteCost`, `status`, `createdById`, `idempotencyKeyId`, و`closedAt` إلى `quality_checks`.
3. تضيف فهارس على أمر التشغيل/المرحلة/التاريخ والفاعل، وقيدًا فريدًا على `stageRunId` غير الفارغ، وقيود CHECK غير سالبة وقيد conservation وقيد إلزام سبب الهالك عند `wasteQty > 0`.
4. تبقي `stage` القديم للقراءة والتوافق، بينما يفرض التطبيق على الكتابات الجديدة `ProductionStage` و`stageRunId` المرتبطين بأمر التشغيل.

### الأثر على البيانات القديمة

التغيير additive ولا يحذف سجلات. تحصل الصفوف القديمة على `wasteQty = 0` و`status = COMPLETED` و`closedAt = CURRENT_TIMESTAMP`، بينما تبقى `stageRunId` و`createdById` و`idempotencyKeyId` فارغة للسجلات التاريخية. قيود CHECK الجديدة معلنة `NOT VALID` حتى لا تمنع نشر migration بسبب صفوف تاريخية تحتاج reconciliation، لكنها تُطبق على الصفوف الجديدة.

### التحقق والـrollback

يجب تشغيل `npx prisma migrate deploy` على قاعدة اختبار نظيفة ونسخة تحتوي بيانات جودة قديمة، ثم تشغيل `npm run test:integration`. لا يُستخدم `db push`، ولا تُعدل migration بعد تطبيقها. في حال التراجع يُوقف استخدام الحقول الجديدة ويُنفذ `git revert` مع migration عكسية معتمدة؛ لا تُحذف سجلات الجودة أو الهالك حذفًا نهائيًا.

## 6. Migration GF-0015 — HR and Payroll Controls

**الاسم:** `20260830010000_gf0015_payroll_controls`

### ما تفعله

1. تضيف enum `PayrollStatus` بقيمتي `DRAFT` و`APPROVED`، وحقول `status`, `createdById`, `approvedById`, `approvedAt`, و`idempotencyKeyId` إلى `payrolls`.
2. تضيف علاقات التدقيق إلى `users` ومفتاح idempotency، وقيدًا فريدًا على `(workerId, periodStart, periodEnd)` لمنع كشفين للعامل والفترة نفسها، وقيدًا فريدًا على `idempotencyKeyId`.
3. تضيف فهارس الحالة والفترة والفاعل، وقيود مبالغ غير سالبة وقيد اكتمال بيانات الاعتماد بصيغة `NOT VALID` للتوافق مع صفوف payroll التاريخية.

### الأثر على البيانات القديمة

التغيير additive ولا يحذف أي payroll أو attendance أو production. الصفوف القديمة تحصل على `status = DRAFT` وتبقى `createdById` و`approvedById` و`approvedAt` و`idempotencyKeyId` فارغة. قبل تطبيق migration على بيئة تحمل بيانات فعلية يجب فحص تكرار `(workerId, periodStart, periodEnd)` وتسوية التكرارات بقرار تدقيق؛ القيد الفريد لا يمكن إنشاؤه إذا بقيت تكرارات.

### قواعد المجال المرتبطة

يحسِب التطبيق `grossAmount` من `DailyProduction.totalAmount` داخل الفترة، ويحسب `advanceDeduct` من السلف داخل الفترة بحد أقصى gross، ويجعل `absenceDeduct = 0` في MVP لأن schema لا يحتوي سياسة راتب ثابت أو daily absence rate معتمدة. لا يقبل endpoint مبالغ gross/net من العميل، ولا ينشئ GF-0015 دفعًا أو قيدًا ماليًا؛ ذلك مؤجل إلى GF-0018.

### التحقق والـrollback

يجب تشغيل `npx prisma migrate deploy` على PostgreSQL نظيفة وعلى نسخة بيانات تحتوي صفوف Payroll legacy، ثم تشغيل unit وHTTP وPostgreSQL integration. يجب اختبار uniqueness والتزامن وreplay والحساب والاعتماد وعدم التعديل. للتراجع البرمجي استخدم `git revert`، وللقاعدة استخدم backup/restore أو migration عكسية معتمدة بعد إيقاف endpoints الجديدة؛ لا تسقط أعمدة أو تحذف سجلات payroll يدويًا.

## 7. Migration GF-0016 — Purchase Receipt Idempotency

**الاسم:** `20260830020000_gf0016_receipt_idempotency`

تضيف migration العمود nullable `purchase_receipts.idempotencyKeyId` مع FK إلى `idempotency_keys` وunique/index. لا تغيّر receipts القديمة ولا تحذف أي حركة مخزون. يمر إنشاء receipt الجديد عبر transaction واحدة تنشئ idempotency record، receipt، حركات `RECEIVE` في ledger، وتحديث حالة PurchaseOrder، ثم تخزن استجابة replay القابلة للتسلسل. إعادة الطلب بالمفتاح نفسه والمحتوى نفسه لا تنشئ receipt أو ledger إضافيًا؛ المحتوى المختلف يُرفض بـ409.

قبل التطبيق على بيئة مشتركة يجب تشغيل `npx prisma migrate deploy` على PostgreSQL وفحص اختبار receipt/ledger والتزامن. rollback يكون بـbackup/restore أو migration عكسية معتمدة بعد إيقاف endpoint؛ لا تُحذف receipts أو ledger يدويًا.

## 8. Migration GF-0017 — Shipment Proof of Delivery

**الاسم:** `20260830030000_gf0017_shipment_pod`

تضيف `shipments.proofOfDelivery` و`shipments.deliveredById` بصورة nullable، مع FK إلى `users` وفهارس الحالة والفاعل. لا تعدّل الشحنات القديمة؛ تسجل الكتابات الجديدة الفاعل والتاريخ من الخادم عند الانتقال إلى DELIVERED، ويجب تنفيذ migration عبر `npx prisma migrate deploy` لا `db push`.

الـrollback يكون بـbackup/restore أو migration عكسية معتمدة بعد إيقاف مسار POD؛ لا تُحذف سجلات الشحن أو ActivityLog. يجب إثبات lifecycle وPOD على PostgreSQL في CI قبل أي بيئة مشتركة.

## 9. Migration GF-0018 — Fiscal Periods and Journal Entries

**الاسم:** `20260830040000_gf0018_fiscal_periods`

تنشئ migration جدول `fiscal_periods` بحالة OPEN/CLOSED وقيد ترتيب التاريخ وفهرس الحالة، وتضيف `journal_entries.fiscalPeriodId` nullable مع FK وفهرس التاريخ. الحقول nullable في القيود القديمة للحفاظ على التوافق؛ لا يُرحّل أي سجل قديم تلقائيًا. يمنع التطبيق التداخل والترحيل في فترة مغلقة، بينما تمنع قاعدة البيانات ترتيب التواريخ. كما تصلح migration trigger التوازن القديم الذي كان يشير خطأً إلى أعمدة `debit` و`credit` غير الموجودة؛ الحماية المتوافقة مع schema الحالي تتحقق من `amount` والحسابين.

يجب تشغيل `npx prisma migrate deploy` على PostgreSQL نظيفة وبيانات legacy ثم اختبار قيد مفتوح وقيد مغلق وrollback rehearsal قبل البيئة المشتركة. rollback عبر backup/restore أو migration عكسية معتمدة؛ لا تُحذف journal entries أو account balances يدويًا.

## 10. نقاط الاسترجاع (Rollback hooks)

- المستودع: `git revert` لأي commit — لا migration بعد عكس schema إلا بmigration عكسية.
- قاعدة البيانات محليًا: إعادة `docker-compose down -v` ثم `migrate dev` + seed (بيانات تطوير فقط — لا بيانات إنتاج موجودة بعد).

## 7. Migration GF-0007 — Domain Foundation (تفصيل موثق)

**الاسم:** `20260825070834_domain_foundation_warehouse_stock_ledger_idempotency`

### ما تفعله
1. تُنشئ `warehouses` (كود فريد + `WarehouseType` + isActive) و`stock_ledger_entries` (كود حركة فريد، `quantityDelta` موقعة، لقطة `balanceAfter`، `unitCost`/`totalValue`، روابط خامة/variant/مخزن/مفتاح idempotency/منشئ) و`idempotency_keys` (مفتاح فريد + نطاق + بصمة طلب + استجابة مخزنة).
2. تُنشئ 9 indexes على الأكواد/التواريخ/الحالات للجداول الجديدة + `raw_materials(code, isActive)`.
3. تضيف قيدي CHECK يدويًا (لغة Prisma DSL لا تدعم CHECK — موثقان في رأس ملف الـ migration نفسه):
   - `raw_materials_current_stock_nonnegative_check`: `currentStock >= 0` — ADR-0007 مفروضة على مستوى قاعدة البيانات نفسها.
   - `stock_ledger_entries_single_item_check`: كل حركة تستهدف خامة أو variant بالضبط (XOR منطقي على العمودين).

### الأثر على البيانات القديمة
لا تعديل على أي صف موجود — جداول جديدة + قيد CHECK فقط. القيم الحالية موجبة (seed) فلا يفشل التطبيق على بيانات التطوير القائمة. الـ seed حُدِّث ليتوافق مع القاعدة الجديدة: الأرصدة الافتتاحية تُبرَّر بحركات ledger داخل `$transaction` واحدة، فيتحقق `currentStock == SUM(quantityDelta)` من اليوم الأول.

### كيفية التطبيق (بيئة تطوير محلية)
```bash
cd backend
docker compose up -d db          # أو أي postgres محلي
npx prisma migrate deploy        # أو: npx prisma migrate dev
npm run seed                     # ينشئ المخازن + الأرصدة الافتتاحية المبررة
```

### استعلام المطابقة (reconciliation) — يجب أن يعيد صفر صفوف دائمًا
```sql
SELECT rm.id, rm.code, rm."currentStock" AS cached_balance,
       COALESCE(SUM(sle."quantityDelta"), 0) AS ledger_balance
FROM raw_materials rm
LEFT JOIN stock_ledger_entries sle ON sle."rawMaterialId" = rm.id
GROUP BY rm.id, rm.code, rm."currentStock"
HAVING rm."currentStock" <> COALESCE(SUM(sle."quantityDelta"), 0);
```

### خطة الـ rollback (إلزامية التوثيق — تنفيذ على التطوير فقط)
1. **الكود:** `git revert <التزام GF-0007>` (يعيد schema/seed/الخدمة/الاختبارات إلى ما قبل المهمة).
2. **قاعدة البيانات — SQL عكسي بالترتيب:**
```sql
DROP TABLE IF EXISTS "stock_ledger_entries";
DROP TABLE IF EXISTS "idempotency_keys";
DROP TABLE IF EXISTS "warehouses";
DROP TYPE IF EXISTS "StockMovementType";
DROP TYPE IF EXISTS "WarehouseType";
ALTER TABLE "raw_materials" DROP CONSTRAINT IF EXISTS "raw_materials_current_stock_nonnegative_check";
DROP INDEX IF EXISTS "raw_materials_code_isActive_idx";
```
3. أو للبيئات المحلية ببساطة: `docker-compose down -v` ثم `npx prisma migrate deploy` على الحالة المرجعة.
4. **تحذير موثق:** حذف الـ ledger يُفقد تاريخ الحركات نهائيًا — لا يُنفذ على أي بيئة تحمل بيانات فعلية دون تصدير نسخة احتياطية أولًا (سياسة §2.5).

## 11. Migration GF-0019 — Shipment Creation Idempotency

**الاسم:** `20260830050000_gf0019_shipment_create_idempotency`

تضيف migration الحقل nullable `shipments.idempotencyKeyId` مع unique index وFK إلى `idempotency_keys`. الشحنات القديمة تبقى صالحة، بينما الطلبات الجديدة التي تحمل `Idempotency-Key` تحفظ المفتاح والاستجابة داخل transaction واحدة. لا تُعدّل المهاجرة المخزون؛ صرف المنتج التام ما يزال داخل انتقال SHIPPED عبر InventoryService.

يجب إثبات replay، اختلاف المحتوى، وrollback المعاملة في CI على PostgreSQL قبل أي بيئة مشتركة. rollback عبر backup/restore أو migration عكسية معتمدة، ولا تُحذف shipments أو stock ledger entries يدويًا.

## P0 Financial Reconciliation Fixes

هذه الإصلاحات لا تتطلب migration لأنها تستخدم الحقول الموجودة. البيع النقدي يمرر `treasuryUpdates` داخل transaction ويحفظها في `JournalEntry.metadata`. مرتجع المورد يستخدم `StockLedgerEntry.totalValue` الفعلي ويرحل مدين AP/دائن Inventory مع خفض Supplier.balance. إنشاء Voucher يحفظ treasury/customer/supplier updates في metadata حتى يقلبها reversal. لا تُعدّل القيود التاريخية التي تفتقد metadata تلقائيًا؛ تحتاج reconciliation معتمدًا. rollback هو rollback للـtransaction أو git revert، وليس حذف حركات أو قيود.
