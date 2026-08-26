# تقرير الحالة الحالي — Garment Factory ERP / GF-0013

**تاريخ التقرير:** 26 أغسطس 2026
**المستودع:** [rabea0169/garment-factory-erp](https://github.com/rabea0169/garment-factory-erp)  
**مصدر الحالة:** `origin/main` عند `033ae6fd`، وفرع الإصلاح `maintenance/pre-gf0014-blockers`

## 1. الحكم التنفيذي

تم دمج أساس GF-0013 وCluster 5 في `main`. أُنشئ هذا الفرع لإغلاق blockers دلالية اكتُشفت بعد الدمج: الكتابة legacy لمخزون المنتج التام، replay غير النهائي لتأكيد البيع، readiness غير المتصلة بقاعدة البيانات، وتعارضات عقد التوثيق. الإصلاحات المحلية اجتازت بوابات Backend والوحدات وE2E، لكنها لا تُعتبر منشورة حتى تُرفع في PR ويمر CI وتُدمج في `main`.

## 2. خط الأساس المنشور

| البند | القيمة |
|---|---|
| الفرع الرئيسي | `main` |
| آخر commit على main | [`033ae6fd`](https://github.com/rabea0169/garment-factory-erp/commit/033ae6fd8bc700b1ddea93d6373c78008cf233f4) |
| فرع الإصلاح | `maintenance/pre-gf0014-blockers` |
| Pull Request الإصلاح | سيُفتح بعد اكتمال المراجعة المحلية |
| آخر CI أخضر على main | [Run 32916998502](https://github.com/rabea0169/garment-factory-erp/actions/runs/32916998502) |
| الإصدار | `pre-release`، غير معتمد لمؤسسة بعد |

## 3. المراحل المثبتة

| المهمة | الحالة |
|---|---|
| GF-0001..GF-0006 | مكتملة وموجودة في التاريخ |
| GF-0007 | Warehouse وStock Ledger وidempotency ومنع الرصيد السالب مكتملة |
| GF-0008 | BOM versioning وربط WorkOrder واستهلاك الخامات مكتملة |
| GF-0009 | Purchasing والاستلام والربط بالمخزون مكتملة ومُدمجة |
| GF-0010 | Flutter secure storage وAuthorization و401/logout وCI مكتملة ومُدمجة |
| GF-0011 | إصلاحات المبيعات والصيانة التراكمية مكتملة ومُدمجة |
| GF-0012 | Pagination موحد للقوائم مكتمل ومُدمج |
| GF-0013 | schema وworkflow وAPI/RBAC وposting وintegration موجودة عبر الدمجات المرحلية؛ هذا الفرع يغلق التناقضات المتبقية |

## 4. الإصلاحات في هذا الفرع

| الفجوة | الإصلاح | دليل الاختبار |
|---|---|---|
| production legacy كان يكتب إلى `finishedGood` | استبدال الكتابة باستدعاء `InventoryService.receiveFinishedGood` داخل transaction؛ الاستلام يستخدم `FinishedGoodStock` وledger وweighted average وidempotency | `ProductionService` unit + PostgreSQL integration في CI |
| قائمة finished goods كانت تقرأ الجدول legacy | القراءة من `FinishedGoodStock` مع mapping توافقي لحقل `variant` | `InventoryService` unit |
| confirm replay قد يعيد DRAFT | تحميل `confirmedOrder` بعد تحديث الحالة والترحيل، ثم حفظه في idempotency response | `SalesService` unit assertion على `CONFIRMED` |
| readiness كانت liveness فقط | إضافة `/health/ready` باستعلام `SELECT 1` وإرجاع 503 عند فشل قاعدة البيانات | `HealthController` unit |
| API contract وstate قديمان | تحديث `API_CONTRACT` و`PROJECT_STATE` وإضافة Handoff للإصلاح | مراجعة diff وCI |

## 5. بوابات التحقق المحلية

| الفحص | النتيجة |
|---|---|
| Prisma generate/validate | ناجح |
| Format check | ناجح |
| Typecheck | ناجح |
| Lint | ناجح |
| Build | ناجح |
| Unit | `27 suites / 135 tests` ناجحة |
| E2E | `3 suites / 43 tests` ناجحة |
| PostgreSQL integration المحلي | `7 tests skipped` لغياب PostgreSQL/Docker؛ لا تُحسب نجاحًا محليًا |
| CI | يجب تشغيله على PR الإصلاح قبل الدمج |

## 6. الفجوات المتبقية خارج نطاق هذا blocker

ما زال `/dashboard/stats` غير منفذ، ولا توجد اختبارات ضغط تثبت p95 وthroughput وpool saturation، ولا تزال بعض دورات الجودة والشحن والتقارير المالية جزئية. كما أن E2E العام ما زال mock-backed، بينما suites integration المحددة تعمل على PostgreSQL داخل CI. `npm audit` يحتاج قرارًا منفصلًا بشأن سلسلة Prisma و`deepmerge-ts`، وتحذيرات Node.js 20 في Actions تحتاج تحديثًا لاحقًا.

## 7. الإجراءات التالية

يُراجع diff هذا الفرع، ثم تُشغل بوابات CI على PR الإصلاح، ويُفحص `prisma migrate deploy` على قاعدة نظيفة إن لم توجد migration جديدة. بعد نجاح CI يُدمج PR بطلب الدمج المصرح، ثم يُسجل merge commit وCI على `main` ويُحدّث هذا الملف وHandoff. لا يبدأ GF-0014 قبل تثبيت عقد GF-0013 والمخزون والمحاسبة.

## 8. المراجع

- [main عند 033ae6fd](https://github.com/rabea0169/garment-factory-erp/commit/033ae6fd8bc700b1ddea93d6373c78008cf233f4)
- [CI Run 32916998502](https://github.com/rabea0169/garment-factory-erp/actions/runs/32916998502)
- [PROJECT_STATE](PROJECT_STATE.md)
- [API_CONTRACT](API_CONTRACT.md)
- [MASTER_BACKLOG](MASTER_BACKLOG.md)
