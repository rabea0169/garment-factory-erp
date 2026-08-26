# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الرئيسي | `main` |
| آخر commit على main | `033ae6fd` — merge PR #17 وتصحيحات Cluster 5 الأساسية |
| فرع الإصلاح الحالي | `maintenance/pre-gf0014-blockers` — غير مرفوع بعد |
| Pull Request الحالي | لا يوجد بعد؛ الإصلاحات قيد التحقق محليًا |
| آخر CI أخضر على main | [Run 32916998502](https://github.com/rabea0169/garment-factory-erp/actions/runs/32916998502) |
| الإصدار | لا يوجد إصدار مؤسسي معتمد بعد — `pre-release` |
| آخر مهمة مكتملة على main | Cluster 5 — foundation المحاسبي والتشغيلي الأساسي |
| حالة GF-0013 | schema/service/integration مدمجة؛ API/RBAC وposting/Flutter مدمجة فقط في فروع مرحلية أو قيد الإغلاق |
| حالة CI على main | أخضر عند `033ae6fd`؛ readiness والتحقق الدلالي ما زالا ضمن هذا الإصلاح |
| حالة قاعدة البيانات على main | migrations additive حتى Cluster 5 المدمج؛ أي migration جديدة يجب أن تبقى additive |
| API version | 1.0 — عقد GF-0013 HTTP موثق في الفرع المرحلي ويُراجع ضمن هذا الإصلاح |

## المهام المكتملة على main

| المهمة | الوصف | الحالة |
|---|---|---|
| GF-0001..GF-0006 | الحوكمة، fail-closed auth، DTOs، الاختبارات، الأسرار وCI | مكتملة وموجودة في التاريخ |
| GF-0007 | Warehouse، Stock Ledger، idempotency، indexes ومنع الرصيد السالب | مكتملة |
| GF-0008 | BOM versioning، ربط WorkOrder بالـ SKU، واستهلاك الخامات داخل transaction | مكتملة |
| GF-0009 | Purchasing Module، أوامر الشراء، الاستلام والمرتجعات عبر InventoryService | مكتملة ومُدمجة في main |
| GF-0010 | Flutter secure storage، Authorization interceptor، 401، logout، إزالة mock، Flutter CI | مكتملة ومُدمجة في main |
| GF-0011 | المبيعات: منع البيع فوق المتاح، وحساب الإجماليات على الخادم وتأمين الخصم | مكتملة |
| GF-0012 | Pagination موحد لكل قوائم الوحدات مع data/meta وقيود page/limit | مكتملة وموجودة في main عند `7e73cf75` |

## نطاق GF-0013 المنفذ في PR #11

أضيفت مراحل ثابتة `CUTTING`, `SEWING`, `IRONING`, `PACKING`، وسجل `ProductionStageRun` واحد لكل أمر ومرحلة، وسجل انتقال append-only، وتخزين input/accepted/rejected/waste، واستهلاك فعلي للخامة حسب المرحلة والمخزن، ولقطات تكلفة، ومخزون finished goods حسب warehouse وSKU. التغيير additive ويحافظ على الحقول القديمة.

تقدم `ProductionWorkflowService` انتقالات sequential، تسجيل مخرجات المرحلة مع conservation، صرفًا عبر `InventoryService.issue` داخل transaction واحدة، Weighted Average لتكلفة المواد، idempotency للانتقال والاستهلاك، ومعالجة replay عند تعارض uniqueness المتزامن. يستخدم `finalizeCost` آخر مرحلة مكتملة كمقام للتكلفة بدل جمع acceptedQty لجميع المراحل، ويرفض تسجيل output لمرحلة ليست `currentStage`.

## دليل التحقق لـ PR #11

| الفحص | النتيجة |
|---|---|
| `npx prisma validate/generate` | ناجح محليًا وداخل CI |
| `npm run format:check` | ناجح محليًا وداخل CI |
| `npm run typecheck` | ناجح محليًا وداخل CI |
| `npm run lint` | ناجح محليًا وداخل CI |
| `npm run build` | ناجح محليًا وداخل CI |
| Unit tests | `25 suites / 120 tests` ناجحة |
| E2E tests | `2 suites / 36 tests` ناجحة؛ ما زالت mock-backed |
| Flutter analyze/test | ناجحان في CI |
| Secret Scan | ناجح في Run `32884547465` |
| Prisma migrate deploy | ناجح على PostgreSQL 16 disposable في Run `32884547465` |
| GF-0013 PostgreSQL integration | `1 suite / 5 tests` ناجحة في Run `32884547465` |
| Integration محليًا | `5 tests skipped` لأن sandbox لا يحتوي Docker/PostgreSQL؛ لا تُحسب نجاحًا محليًا |

## الفجوات المعروفة قبل الاستخدام المؤسسي

1. هذا الفرع يعالج مسار production legacy ومخزون المنتج التام، لكن لا يُعتبر الحل منشورًا حتى يُدمج PR الإصلاح ويمر CI على `main`.
2. ما زالت اختبارات E2E الحالية تستخدم Prisma mock ولا تثبت runtime على PostgreSQL، باستثناء suites integration المخصصة التي تفعل ذلك على CI.
3. `/dashboard/stats` غير منفذ في Backend، وبعض دورات الجودة والشحن والمالية ما زالت جزئية.
4. `npm audit` يحتاج قرارًا واعيًا بشأن ثغرات `deepmerge-ts` ضمن سلسلة Prisma؛ لا يُنفذ `npm audit fix --force` قبل قرار وترقية متوافقة.
5. تحذير Node.js 20 في GitHub Actions غير حاجب، لكنه يحتاج تحديث actions لاحقًا.
6. لا توجد حتى الآن اختبارات ضغط تثبت p95 وthroughput وpool saturation في سيناريوهات البيع والإنتاج.

## المهمة التالية الرسمية

بعد دمج هذا الإصلاح والتحقق من CI على `main`، تُراجع بوابات GF-0013 النهائية ثم يُفتح GF-0014 حسب ترتيب `MASTER_BACKLOG.md`. لا تُفتح مهمة جديدة قبل تثبيت عقد الإنتاج والمخزون والمحاسبة وتحديث Handoff.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة، ولا يُعتبر PR مدمجًا قبل تنفيذ merge بطلب صريح والتحقق من CI على `main`.

## آخر تحديث توثيقي

تم تحديث هذا الملف على فرع `maintenance/pre-gf0014-blockers` بعد مراجعة `main@033ae6fd`. يجب تحديث SHA وRun CI النهائيين بعد دمج PR الإصلاح، وعدم اعتبار هذا المصدر نهائيًا قبل ذلك.
