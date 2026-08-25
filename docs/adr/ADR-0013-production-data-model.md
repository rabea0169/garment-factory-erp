# ADR-0013 — نموذج بيانات مراحل الإنتاج والاستهلاك والتكلفة

## الحالة

مقترح للتنفيذ في GF-0013، مبني على `main` عند `7e73cf7` بعد اكتمال GF-0012. هذا الملف يثبت قرارات قاعدة البيانات قبل كتابة خدمات الإنتاج والمهاجرات النهائية.

## السياق

يحتوي النظام الحالي على `WorkOrderStatus` و`WorkOrderStage` و`MaterialConsumption` قديمة، بالإضافة إلى `BomVersion` و`StockLedgerEntry` و`IdempotencyKey`. المطلوب إضافة مراحل إنتاج قابلة للتدقيق واستهلاك فعلي للخامات دون كسر البيانات السابقة أو الكتابة خارج ledger.

## القرارات

### فصل lifecycle عن المرحلة

يبقى `WorkOrder.status` مسؤولًا عن دورة حياة الأمر، ويُضاف `WorkOrder.currentStage` من نوع `ProductionStage` للمرحلة الحالية. تُحتفظ قيم `WorkOrderStatus` القديمة للتوافق مع الصفوف والكود السابق، ولا تُحذف في هذه المرحلة.

### سجل تشغيل المرحلة

يضاف `ProductionStageRun` بسجل واحد لكل `(workOrderId, stage)` مع ترتيب فريد. يحتوي السجل على planned/input/accepted/rejected/waste، وحالة التشغيل، وأزمنة البدء والإكمال. الانتقالات التفصيلية تُحفظ في `WorkOrderStageTransition` كسجل append-only.

### الكميات

تُخزن الكميات بوحدة المنتج كأعداد صحيحة في `ProductionStageRun`. القاعدة التشغيلية المعتمدة هي:

```text
inputQty = acceptedQty + rejectedQty + wasteQty
```

يجب فرضها في service واختبارات السلوك عند إغلاق المرحلة، وإضافة CHECK مشروط في migration: يسمح السجل غير المكتمل (`PENDING` أو `IN_PROGRESS`) بالبقاء بقيم مخرجات ابتدائية، بينما يمنع السجل `COMPLETED` من الحفظ إلا عند تحقق المعادلة. لا يكفي Prisma schema لفرض CHECK مخصص في PostgreSQL.

### الاستهلاك

يضاف `ProductionMaterialConsumption` لكل خامة ومرحلة ومخزن. يحتفظ بالسعر والكمية المخططة والفعلية والفرق والتكلفة الإجمالية، ويرتبط اختياريًا بحركة `StockLedgerEntry` وبـ `IdempotencyKey`. يجب إنشاء سجل الاستهلاك وحركة ledger داخل transaction واحدة.

### التكلفة

يضاف `ProductionCostSnapshot` مع `materialCost` و`wasteCost` و`totalCost` و`unitCost`. يتم حساب تكلفة المواد من Stock Ledger وفق Weighted Average. تُترك `laborCost` و`overheadCost` بقيمة صفر افتراضيًا إلى أن تُعتمد سياسة GF-0018، ولا يجوز وصف `unitCost` بأنه تكلفة تصنيع شاملة قبل إدخالها.

### المنتج التام

يبقى حقل `FinishedGood.quantity` القديم للتوافق فقط، ويضاف `FinishedGoodStock` كمخزون تشغيلي authoritative حسب المفتاح الفريد `(warehouseId, productVariantId)`. لا يجوز تحديث أي من الرصيد الجديد دون حركة `StockLedgerEntry` داخل نفس transaction. استلام المنتج التام عند التعبئة النهائية وتنفيذ حركة ledger هما جزء من خدمة المجال اللاحقة، وليس من schema وحده.

### idempotency والتصحيح

لكل انتقال واستهلاك مفتاح idempotency اختياري فريد. لا تُحذف الحركات أو الانتقالات المعتمدة، ويكون التصحيح بحركة عكسية في مسار مخزون مخصص.

## سبب عدم إضافة Route Builder الآن

المراحل الأربع الثابتة `CUTTING`, `SEWING`, `IRONING`, `PACKING` تغطي الإصدار الأول. إذا احتاج المصنع مسارات مختلفة حسب المنتج أو الفرع، تُضاف لاحقًا جداول `ProductionRoute` و`ProductionRouteStage` عبر ADR مستقل بدل خلطها مع أول migration.

## ملاحظات الترحيل

تغييرات GF-0013 additive من ناحية schema: أعمدة nullable أو ذات default على `work_orders` وجداول جديدة. يجب إنشاء migration يدوياً أو مراجعتها بعناية، ثم إضافة CHECK وقيود الفهارس عبر SQL. يجب تنفيذ الترحيل على نسخة PostgreSQL احتياطية، ثم اختبار backfill وrollback قبل أي بيانات Pilot.

يجب عدم استخدام `prisma migrate dev` على قاعدة إنتاج، وعدم تنفيذ أوامر `DROP TABLE` أو `DROP COLUMN` في migration GF-0013. كما يجب تحديد سياسة rollback: حذف الجداول الجديدة فقط إذا كانت فارغة، أو استخدام restore للنسخة الاحتياطية إذا بدأت عمليات تشغيل فعلية.

## ما لا يثبته هذا ADR

نجاح `prisma validate` و`prisma generate` يثبت صحة نموذج Prisma، ولا يثبت صحة transaction أو CHECK constraints أو concurrency. هذه البنود تحتاج خدمة إنتاج واختبارات PostgreSQL فعلية ضمن بقية GF-0013.
