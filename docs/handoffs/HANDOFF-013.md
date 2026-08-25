# HANDOFF-013: GF-0013 — نموذج مراحل الإنتاج واختبارات PostgreSQL

## 1. النطاق والحكم

المهمة الرسمية هي `GF-0013` ضمن `MASTER_BACKLOG.md`: تقييد انتقالات أمر التشغيل بين `CUTTING → SEWING → IRONING → PACKING`، تسجيل مخرجات كل مرحلة مع المقبول والمرفوض والهدر، وربط استهلاك الخامات الفعلي بالمرحلة داخل transaction واحدة مع تكلفة Weighted Average.

الحكم الحالي: **نطاق PR #11 مكتمل ومجتاز لبوابات CI، لكن GF-0013 كميزة مؤسسية كاملة غير مكتملة بعد**. الـ PR مفتوح وقابل للدمج تقنيًا، ولم يُدمج لأن سياسة المشروع تشترط طلبًا صريحًا من المستخدم. لا توجد بعد Controllers/DTOs/RBAC عامة لمسارات workflow، ولا تنفيذ استلام المنتج التام في `FinishedGoodStock`، ولا شاشة Flutter لهذه الدورة.

الفرع مبني على `main` عند `7e73cf7`، ولم تُعدّل `main` مباشرة. يجب على النموذج التالي عدم إعلان GF-0013 مغلقة بالكامل لمجرد أن PR أخضر.

## 2. حالة المستودع

| البند | القيمة |
|---|---|
| المستودع | [rabea0169/garment-factory-erp](https://github.com/rabea0169/garment-factory-erp) |
| الفرع الأساسي | `main` |
| Base SHA | [`7e73cf75`](https://github.com/rabea0169/garment-factory-erp/commit/7e73cf75a61c0e275337d2e604de44453a43342a) |
| فرع العمل | `phase3/gf0013-schema-design` |
| Head SHA | [`fbd892ba`](https://github.com/rabea0169/garment-factory-erp/commit/fbd892baf877e8ed9af860a6ee95c98f9be1a14b) |
| Pull Request | [#11](https://github.com/rabea0169/garment-factory-erp/pull/11) |
| حالة PR | مفتوح، `MERGEABLE`، غير مدمج |
| CI الأخضر | [Run 32884044157](https://github.com/rabea0169/garment-factory-erp/actions/runs/32884044157) |
| PR توثيق سابق مفتوح | [PR #10](https://github.com/rabea0169/garment-factory-erp/pull/10) — لا تخلطه مع PR #11 |
| حالة working tree عند التسليم | نظيف بعد دفع آخر commit |

## 3. ما تم تنفيذه

### قاعدة البيانات

أضيفت كيانات `ProductionStageRun` و`WorkOrderStageTransition` و`ProductionMaterialConsumption` و`ProductionCostSnapshot` و`FinishedGoodStock`، مع أعمدة `currentStage` و`stageVersion` في `WorkOrder`. السجل الانتقالي append-only، ويوجد سجل واحد لكل `(workOrderId, stage)`، مع فهارس وقيود uniqueness وعلاقات خارجية وقيود non-negative.

Migration `backend/prisma/migrations/20260825150000_gf_0013_production_workflow/migration.sql` additive. أضيفت قيمة `IN_PROGRESS` إلى enum `WorkOrderStatus` الموجود في migration الأولية، وأضيف قيد conservation مشروط بحالة `COMPLETED`: السجل `IN_PROGRESS` يمكن إنشاؤه قبل معرفة المخرجات، بينما لا يُغلق السجل إلا عند تحقق `inputQty = acceptedQty + rejectedQty + wasteQty`. لا توجد أوامر حذف لجداول أو أعمدة legacy.

### Backend/domain

أضيفت `ProductionWorkflowService` مع `transitionStage` و`recordStageOutput` و`consumeMaterial` و`finalizeCost`. الانتقال sequential ومقيد بحالة أمر التشغيل وبإكمال المرحلة السابقة. صرف الخامة يمر عبر `InventoryService.issue` مع نفس transaction client، ويسجل التكلفة والهدر ويربط الحركة بالمرحلة ومفتاح idempotency.

تمت معالجة replay idempotency قبل التنفيذ، وكذلك تعارضات uniqueness المتزامنة في transition بحيث يُعاد السجل الفائز عند وصول طلبين متطابقين. تم ربط `recordStageOutput` صراحةً بـ `currentStage`. ويستخدم `finalizeCost` مخرج آخر مرحلة مكتملة بدل جمع `acceptedQty` عبر كل المراحل حتى لا يتضخم مقام تكلفة الوحدة.

### الاختبارات وCI

تغطي suite PostgreSQL حقيقية خمسة سيناريوهات: الانتقالات المتسلسلة ورفض القفز وreplay، سباق انتقالين متطابقين، conservation لمخرجات المرحلة، استهلاك الخامة وتكلفة الهدر مع replay، ثم rollback الكامل عند عدم كفاية الرصيد. الاختبارات تستخدم `PrismaService` حقيقية ولا تعتمد على mock، وتعمل على قاعدة disposable مع `TRUNCATE ... CASCADE`.

تم إصلاح CI ليطبق migrations على PostgreSQL 16 قبل integration tests، مع إبقاء credentials الاختبارية disposable داخل workflow المستثنى من Secret Scan. تم تحويل مثال التوثيق إلى placeholders منفصلة لا تحتوي `user:password@`.

## 4. التغييرات والملفات الرئيسية

| المجموعة | الملفات |
|---|---|
| Prisma | `backend/prisma/schema.prisma`، `backend/prisma/migrations/20260825150000_gf_0013_production_workflow/migration.sql` |
| Domain service | `backend/src/modules/production/production-workflow.service.ts`، `backend/src/modules/production/production.module.ts` |
| Integration tests | `backend/test/production-workflow.integration-spec.ts`، `backend/test/jest-integration.json`، `backend/package.json` |
| CI | `.github/workflows/ci.yml` |
| توثيق التشغيل | `backend/test/INTEGRATION_TESTS.md`، `docs/adr/ADR-0013-production-data-model.md` |
| التسليم | `docs/handoffs/HANDOFF-013.md`، `docs/PROJECT_STATE.md`، `docs/CURRENT_STATUS_2026-08-25.md` |

## 5. عقد السلوك الحالي

لا يوجد API عام جديد في هذا PR؛ الخدمة domain-level ومصدّرة من `ProductionModule`. الانتقال الأول المسموح هو إلى `CUTTING`، ولا يُسمح بالقفز إلى مرحلة لاحقة. يجب أن تكون المرحلة الحالية مكتملة قبل الانتقال التالي. مخرجات المرحلة لا تُقبل إذا لم تحقق conservation، ولا يجوز تسجيل output لمرحلة ليست `currentStage`.

استهلاك الخامة يتطلب `workOrderId` و`stageRunId` و`rawMaterialId` و`warehouseId` والكميات والوحدة وهوية الفاعل. `actualQuantity` تُصرف من الرصيد، و`wasteQuantity` جزء من الكمية الفعلية وتُحسب تكلفته بسعر الوحدة المطبق من InventoryService. تكرار نفس الطلب بالمفتاح والمحتوى نفسيهما replay بلا ledger أو consumption إضافي، أما اختلاف المحتوى فيُرفض.

## 6. أدلة التحقق

| البوابة | الأمر أو Run | النتيجة | الملاحظة |
|---|---|---|---|
| Prisma validate | `npx prisma validate` محليًا وCI | ناجحة | schema صالح |
| Prisma generate | `npx prisma generate` محليًا وCI | ناجحة | Prisma Client مولّد |
| Format | `npm run format:check` | ناجحة | لا اختلافات |
| Typecheck | `npm run typecheck` | ناجحة | لا أخطاء TypeScript |
| Lint | `npm run lint` | ناجحة | لا أخطاء |
| Build | `npm run build` | ناجحة | Backend يبنى |
| Unit tests | محليًا وCI | `25 suites / 120 tests` ناجحة | تستمر اختبارات الوحدات السابقة |
| E2E tests | Run `32884044157` | `2 suites / 36 tests` ناجحة | ما زالت mock-backed كما هو موثق |
| Flutter | Run `32884044157` | `analyze` و`test` ناجحان | لا تغيير Flutter في هذا PR |
| Secret Scan | Run `32884044157` | ناجحة | مثال URI الآمن لا يطابق النمط |
| Migration deploy | Run `32884044157` | ناجح | PostgreSQL 16 نظيفة |
| Real PostgreSQL integration | Run `32884044157` | `1 suite / 5 tests` ناجحة | تنفيذ حقيقي بلا Prisma mock |
| Local integration | `npm run test:integration` | `5 tests skipped` | Docker/PostgreSQL غير متاح في sandbox، لذلك لا تُنسب هذه النتيجة إلى نجاح محلي |

## 7. القيود والمخاطر المفتوحة

الخطر الأعلى هو أن PR #11 لا يضيف بعد طبقة HTTP/DTO/RBAC؛ لذلك لا يجوز اعتباره workflow متاحًا للمستخدمين أو جاهزًا للتشغيل المؤسسي. يجب تنفيذ endpoints مع مصفوفة أدوار واختبارات `401/403` قبل إغلاق GF-0013 وظيفيًا.

استلام المنتج التام إلى `FinishedGoodStock` وربطه بحركة ledger مؤجل، كما أن واجهة Flutter ومسار حالات الشاشة مؤجلان. التكلفة الحالية هي تكلفة مواد فقط؛ `laborCost` و`overheadCost` يظلان صفرًا إلى أن تُعتمد سياسة GF-0018، فلا يُوصف snapshot بأنه تكلفة تصنيع شاملة.

اختبارات E2E الحالية لا تثبت runtime PostgreSQL لأنها mock-backed. تم علاج هذا النقص لمسار GF-0013 عبر suite حقيقية، لكن لا تزال migrations وبقية المسارات بحاجة إلى اختبارات أوسع قبل Pilot. تحذير Node.js 20 في Actions ليس فشلًا، لكنه يحتاج تحديث actions لاحقًا.

## 8. تعليمات النموذج التالي

أولًا، اقرأ `docs/PROJECT_STATE.md` و`docs/MASTER_BACKLOG.md` و`docs/handoffs/HANDOFF-013.md` و`docs/adr/ADR-0013-production-data-model.md`، ثم تحقق من `origin/main` ومن أن PR #11 ما زال مفتوحًا وأخضر. لا تدمج PR #11 إلا بطلب صريح من المستخدم.

بعد الدمج، تحقق من merge commit وCI على `main`، ثم أنشئ فرعًا مستقلًا للامتداد التالي. النطاق التالي المباشر هو **GF-0013 API/RBAC substage**: DTOs ومسارات transition/output/consumption/cost، استخراج actor من JWT، صلاحيات الإنتاج والمخزون، اختبارات 401/403/DTO validation وidempotency عبر HTTP، مع عدم إعادة تصميم schema أو تجاوز InventoryService.

بعد اكتمال طبقة API ومراجعتها، تأتي شاشة Flutter ومسارات loading/empty/error/success ثم استلام المنتج التام، وفق ترتيب `MASTER_BACKLOG.md`. لا تبدأ GF-0014 قبل تثبيت عقد GF-0013 ومراجعة finished-good posting.

## 9. الروابط المرجعية

- [PR #11](https://github.com/rabea0169/garment-factory-erp/pull/11)
- [CI Run 32884044157](https://github.com/rabea0169/garment-factory-erp/actions/runs/32884044157)
- [PROJECT_STATE](../PROJECT_STATE.md)
- [MASTER_BACKLOG](../MASTER_BACKLOG.md)
- [ADR-0013](../adr/ADR-0013-production-data-model.md)
