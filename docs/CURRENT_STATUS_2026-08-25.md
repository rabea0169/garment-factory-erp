# تقرير الحالة الحالي — Garment Factory ERP / GF-0013

**تاريخ التقرير:** 25 أغسطس 2026  
**المستودع:** [rabea0169/garment-factory-erp](https://github.com/rabea0169/garment-factory-erp)  
**مصدر الحالة:** `origin/main` عند `7e73cf75`، مع مراجعة PR #11 عند `3e99765`

## 1. الحكم التنفيذي

نطاق PR #11 الخاص بالـ schema والخدمة الأولية واختبارات التكامل الحقيقية لـ GF-0013 **مكتمل ومجتاز**. أصبحت جميع بوابات CI خضراء، بما فيها migration على PostgreSQL 16 واختبارات workflow الخمسة بدون Prisma mock. ومع ذلك، **لا تُعد GF-0013 مكتملة كميزة مؤسسية ولا تُعد مدمجة في main**: PR #11 مفتوح، وطبقة HTTP/DTO/RBAC، ومسار استلام المنتج التام، وواجهة Flutter ما زالت خارج نطاق هذا الجزء وتحتاج امتدادًا مستقلًا قبل إغلاق المهمة رسميًا.

## 2. خط الأساس المنشور وحالة PR

| البند | القيمة |
|---|---|
| الفرع الرئيسي | `main` |
| آخر commit على main | [`7e73cf75`](https://github.com/rabea0169/garment-factory-erp/commit/7e73cf75a61c0e275337d2e604de44453a43342a) |
| فرع العمل | `phase3/gf0013-schema-design` |
| آخر commit للفرع | [`3e99765`](https://github.com/rabea0169/garment-factory-erp/commit/3e997652d8c12fbd5967625d93ad13c966258d8a) |
| Pull Request | [#11 — production workflow integration coverage](https://github.com/rabea0169/garment-factory-erp/pull/11) |
| حالة PR | مفتوح، `MERGEABLE`، غير مدمج |
| CI الأخضر | [Run 32884547465](https://github.com/rabea0169/garment-factory-erp/actions/runs/32884547465) |
| PR توثيقي سابق | [PR #10](https://github.com/rabea0169/garment-factory-erp/pull/10) ما زال مفتوحًا؛ لا يساوي دمج GF-0013 |
| الإصدار | `pre-release`، غير معتمد لمؤسسة بعد |
| حالة working tree | نظيف بعد آخر push |

## 3. ما تغير في GF-0013

### قاعدة البيانات

أضيفت المراحل الثابتة `CUTTING`, `SEWING`, `IRONING`, `PACKING` مع `ProductionStageRun` واحد لكل أمر ومرحلة، و`WorkOrderStageTransition` كسجل append-only، و`ProductionMaterialConsumption` للاستهلاك الفعلي، و`ProductionCostSnapshot` للتكلفة، و`FinishedGoodStock` لرصيد المنتج التام حسب المخزن وSKU. أضيفت إلى `WorkOrder` حقول `currentStage` و`stageVersion` مع الحفاظ على الحقول القديمة للتوافق.

Migration GF-0013 additive ولا تحذف جداول أو أعمدة legacy. أصلحت migration قيمة `IN_PROGRESS` المفقودة من enum `WorkOrderStatus`، وقيدت conservation بحيث يُفرض عند `COMPLETED` فقط؛ هذا ضروري لأن stage run يُنشأ `IN_PROGRESS` قبل تسجيل مخرجاته. القاعدة عند الإغلاق هي `inputQty = acceptedQty + rejectedQty + wasteQty`.

### Backend/domain

تقدم `ProductionWorkflowService` عمليات انتقال sequential، وتسجيل مخرجات المرحلة، واستهلاك الخامة داخل transaction مشتركة مع `InventoryService.issue`، وتثبيت تكلفة مواد Weighted Average. يمنع الانتقال القفزي أو تجاوز مرحلة غير مكتملة، ويرفض output لمرحلة ليست `currentStage`، ويجعل replay بالمفتاح نفسه بلا أثر إضافي.

تم إصلاح race behavior في transition: إذا مر طلبان متطابقان قبل الفحص الأول، يعيد الطلب الخاسر النتيجة الملتزمة بدل إنشاء سجل ثانٍ أو إرجاع تعارض غير معالج. كما أصبح مقام تكلفة الوحدة هو accepted output لآخر مرحلة مكتملة بدل مجموع accepted عبر كل المراحل.

### الاختبارات وCI

تغطي suite الحقيقية خمسة سيناريوهات: الانتقال المتسلسل ورفض القفز وreplay، concurrent transition idempotency، conservation، استهلاك الخامة مع waste cost وreplay، وrollback عند عدم كفاية الرصيد. تصل اختبارات التكامل بعد `prisma migrate deploy` إلى قاعدة PostgreSQL 16 disposable ولا تستخدم Prisma mock.

## 4. ملفات التغيير الأساسية

| الفئة | الملفات |
|---|---|
| Prisma/migration | `backend/prisma/schema.prisma`، `backend/prisma/migrations/20260825150000_gf_0013_production_workflow/migration.sql` |
| خدمة المجال | `backend/src/modules/production/production-workflow.service.ts`، `backend/src/modules/production/production.module.ts` |
| Integration | `backend/test/production-workflow.integration-spec.ts`، `backend/test/jest-integration.json`، `backend/package.json` |
| CI والتوثيق | `.github/workflows/ci.yml`، `backend/test/INTEGRATION_TESTS.md`، `docs/adr/ADR-0013-production-data-model.md` |
| الحالة والتسليم | `docs/PROJECT_STATE.md`، `docs/CURRENT_STATUS_2026-08-25.md`، `docs/handoffs/HANDOFF-013.md` |

## 5. مصفوفة الأدلة

| البوابة | النتيجة | الدليل الدقيق |
|---|---|---|
| Prisma validate/generate | ناجحة | محليًا وداخل Run `32884547465` |
| Format check | ناجحة | `npm run format:check` محليًا وCI |
| Typecheck | ناجحة | `npm run typecheck` محليًا وCI |
| Lint | ناجحة | `npm run lint` محليًا وCI |
| Build | ناجحة | `npm run build` محليًا وCI |
| Unit | ناجحة | `25 suites / 120 tests` |
| E2E | ناجحة | `2 suites / 36 tests`؛ الاختبارات الحالية mock-backed |
| Flutter | ناجحة | `flutter analyze` و`flutter test` في CI |
| Secret Scan | ناجحة | Run `32884547465` |
| Migration runtime | ناجحة | `prisma migrate deploy` على PostgreSQL 16 disposable |
| Real integration | ناجحة | `1 suite / 5 tests` في Run `32884547465` |
| Local integration | غير منفذة فعليًا | `5 skipped` لغياب Docker/PostgreSQL في sandbox؛ لا تُحسب نجاحًا محليًا |

## 6. المشكلات والفجوات مرتبة

| الأولوية | الفجوة | الأثر وشرط الإغلاق |
|---|---|---|
| حرجة قبل استخدام API | لا توجد Controllers/DTOs/RBAC لـ workflow | لا توجد واجهة تشغيل للمستخدمين؛ تُغلق بإضافة HTTP contract واختبارات `401/403` وvalidation واستخراج actor من JWT |
| عالية قبل الإنتاج | FinishedGood posting غير منفذ | لا يتم استلام المنتج التام إلى `FinishedGoodStock` مع حركة ledger؛ تُغلق بخدمة posting ذرية واختبارات rollback/idempotency |
| عالية قبل Pilot | E2E العام ما زال mock-backed | لا يثبت كل مسارات HTTP على PostgreSQL؛ suite GF-0013 تعالج workflow domain فقط |
| عالية قبل Pilot | التكلفة الحالية مواد فقط | `laborCost` و`overheadCost` صفر حتى سياسة GF-0018؛ لا يوصف snapshot كتكلفة تصنيع شاملة |
| متوسطة | Flutter workflow UI مؤجل | لا توجد شاشة مراحل أو حالات تشغيل من الهاتف؛ يُنفذ بعد تثبيت API |
| متوسطة | `/dashboard/stats` غير منفذ | التقارير لا تملك KPI backend حقيقيًا |
| منخفضة | تحذير Node.js 20 في Actions | لا يحجب الدمج، ويحتاج تحديث actions لاحقًا |

## 7. الإجراءات التالية بالترتيب

أولًا، لا تدمج PR #11 إلا بطلب صريح من المستخدم، رغم أن CI أخضر. عند طلب الدمج، نفذ الدمج عبر GitHub ثم تحقق من merge commit وCI على `main` وسجل SHA الجديد.

ثانيًا، نفذ امتداد **GF-0013 API/RBAC** في فرع مستقل فوق main بعد الدمج: DTOs ومسارات transition/output/consumption/cost، صلاحيات أدوار الإنتاج والمخزون، actor من JWT، validation، واختبارات HTTP لـ `401/403` وidempotency. يجب أن تبقى كل الكتابات خلف `ProductionWorkflowService` و`InventoryService`، وألا يُعاد تصميم schema دون ADR.

ثالثًا، نفذ posting المنتج التام عند إكمال `PACKING` إلى `FinishedGoodStock` مع ledger transaction، ثم ابنِ Flutter workflow UI بحالات loading/empty/error/success. لا تبدأ GF-0014 قبل تثبيت عقد GF-0013 ومراجعة هذا المسار.

## 8. المراجع

- [PR #11](https://github.com/rabea0169/garment-factory-erp/pull/11)
- [CI Run 32884547465](https://github.com/rabea0169/garment-factory-erp/actions/runs/32884547465)
- [PROJECT_STATE](PROJECT_STATE.md)
- [HANDOFF-013](handoffs/HANDOFF-013.md)
- [MASTER_BACKLOG](MASTER_BACKLOG.md)
- [ADR-0013](adr/ADR-0013-production-data-model.md)
