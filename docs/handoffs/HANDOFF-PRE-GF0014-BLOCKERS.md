# HANDOFF — PRE-GF0014 BLOCKER FIXES

## 1. المهمة

إغلاق المشكلات الدلالية التي ظهرت بعد دمج Cluster 5 وقبل بدء مهمة جديدة أو GF-0014.

## 2. المصدر والفرع

| البند | القيمة |
|---|---|
| Repository | `rabea0169/garment-factory-erp` |
| Base | `origin/main@033ae6fd` |
| Branch | `maintenance/pre-gf0014-blockers` |
| Pull Request | سيُفتح بعد اكتمال البوابات |
| Merge status | غير مدمج حتى الآن |

## 3. ما أُصلح

أصبح مسار `ProductionService.updateOrderStatus(...COMPLETED)` يستدعي `InventoryService.receiveFinishedGood` داخل transaction بدل الكتابة إلى `finishedGood` legacy. الاستلام يحدّث `FinishedGoodStock` ويكتب `StockLedgerEntry` مع تكلفة الوحدة وidempotency.

أصبحت قراءة قائمة المنتجات التامة من `FinishedGoodStock`، مع إبقاء mapping توافقي لحقل `variant` حتى لا يحدث contract break غير ضروري. كما أُصلح `confirmOrder` ليحفظ idempotency response بعد تحميل أمر البيع المؤكد، وبذلك يعيد replay حالة `CONFIRMED`.

أضيف `/health/ready` لفحص اتصال PostgreSQL عبر `SELECT 1` وإرجاع 503 دون تفاصيل حساسة عند الفشل. تم تحديث `API_CONTRACT.md` و`PROJECT_STATE.md` و`CURRENT_STATUS_2026-08-25.md`.

## 4. الأدلة

| الفحص | النتيجة |
|---|---|
| Prisma validate/generate | ناجح |
| Format check | ناجح |
| Typecheck | ناجح |
| Lint | ناجح |
| Build | ناجح |
| Unit | `27 suites / 135 tests` ناجحة |
| E2E | `3 suites / 43 tests` ناجحة |
| PostgreSQL integration محليًا | `7 skipped` بسبب غياب PostgreSQL/Docker |

يجب اعتبار CI على PR هو الدليل الحاسم لـmigration/runtime/integration؛ النجاح المحلي لا يعوض غياب PostgreSQL.

## 5. الملفات الأساسية

- `backend/src/modules/production/production.service.ts`
- `backend/src/modules/production/production.service.spec.ts`
- `backend/src/modules/inventory/inventory.service.ts`
- `backend/src/modules/inventory/inventory.service.spec.ts`
- `backend/src/modules/sales/sales.service.ts`
- `backend/src/modules/sales/sales.service.spec.ts`
- `backend/src/common/health.controller.ts`
- `backend/src/common/health.controller.spec.ts`
- `docs/API_CONTRACT.md`
- `docs/PROJECT_STATE.md`
- `docs/CURRENT_STATUS_2026-08-25.md`

## 6. المراجعة المطلوبة قبل الدمج

يجب التأكد من أن CI يشغل migration على قاعدة نظيفة، واختبار production legacy وFinishedGoodStock على PostgreSQL، واختبار replay المتزامن لتأكيد البيع، واختبار readiness بنجاح وفشل. يجب أيضًا التأكد من عدم وجود كتابة جديدة إلى `finishedGood` في المسارات التشغيلية؛ الجدول legacy يُحتفظ به للتوافق والقراءة التاريخية فقط.

بعد نجاح CI، يُفتح أو يُحدّث PR الإصلاح، ثم يُدمج بطلب صريح، ويُسجل merge commit وCI على `main`. لا يبدأ GF-0014 قبل تحديث `PROJECT_STATE` بـSHA الجديد.

## 7. خارج النطاق

Load testing، dashboard reports، توسعة محاسبة VAT والعملات، offline queue، وتحديث actions القديمة ليست جزءًا من هذا blocker PR وتُفتح كبنود مستقلة وفق `MASTER_BACKLOG.md`.
