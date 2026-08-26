# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الأساسي المرجعي | `origin/main` |
| آخر commit على main | `eae3f7e` — دمج PR #28 التوثيقي فوق GF-0016 الجزئي PR #27 |
| فرع العمل الحالي | `phase5/gf0015-payroll` — تنفيذ payroll MVP |
| آخر commit في فرع العمل | `eae3f7e` — base verified؛ تغييرات GF-0015 غير ملتزمة بعد |
| Pull Request الحالي | لا يوجد؛ فرع GF-0015 قيد الإعداد قبل الرفع |
| آخر مرحلة مكتملة بالكامل على main | GF-0014؛ GF-0015 بدأ جزئيًا فقط عبر attendance endpoint في PR #24 |
| حالة CI على main | PASS — Run `32928522342` على `eae3f7e`، بما في ذلك Backend/PostgreSQL وFlutter وSecret Scan |
| حالة قاعدة البيانات | migration `20260830000000_gf0014_quality_waste` نجحت على PostgreSQL 16 disposable في CI؛ لا توجد production/shared DB بعد |
| إصدار API | `1.0`؛ أضيف `GET /quality/kpis` ووثّق POST الجودة في GF-0014 |
| قاعدة البيانات المحلية | لا يوجد Docker/PostgreSQL متاح؛ integration وmigration deploy يجب إثباتهما في CI |
| الإصدار | `pre-release`؛ غير معتمد لتشغيل مؤسسي |
| المهمة النشطة | `GF-0015-IMPL`: التحقق النهائي ورفع PR payroll |
| المرحلة النشطة | GF-0015 — HR/Payroll implementation |
| حالة GF-0014 | مكتملة ومُدمجة في main عبر PR #25؛ CI على merge commit أخضر |
| حالة GF-0015 | attendance مدمج عبر PR #24؛ payroll MVP منفذ محليًا وينتظر PR/CI، وبطاقة HANDOFF-015-IMPL مضافة |
| Security blockers | لا P0/P1 جديد معروف ضمن GF-0014؛ actor من JWT، المسارات محمية، وSecret Scan المحلي PASS |
| Open decisions | adjustment/reversal لفحص مكتمل مؤجل إلى ADR ومهمة مستقلة؛ لا كتابة مخزون/محاسبة في GF-0014 |
| Last handoff | `docs/handoffs/HANDOFF-015-IMPL.md` |
| Next exact action | مراجعة diff/GF-0015 migration، commit ورفع PR مستقل، ثم انتظار CI migration/integration وFlutter وSecret Scan |

## المهام المكتملة على main

| المهمة | الوصف | الحالة |
|---|---|---|
| GF-0001..GF-0006 | الحوكمة، fail-closed auth، DTOs، الاختبارات، الأسرار وCI | مكتملة وموجودة في التاريخ |
| GF-0007 | Warehouse، Stock Ledger، idempotency، indexes ومنع الرصيد السالب | مكتملة |
| GF-0008 | BOM versioning، ربط WorkOrder بالـSKU، واستهلاك الخامات داخل transaction | مكتملة |
| GF-0009 | Purchasing Module، أوامر الشراء، الاستلام والمرتجعات عبر InventoryService | مكتملة ومُدمجة |
| GF-0010 | Flutter secure storage، Authorization interceptor، 401، logout، إزالة mock، Flutter CI | مكتملة ومُدمجة |
| GF-0011 | المبيعات: منع البيع فوق المتاح وحساب الإجماليات على الخادم وتأمين الخصم | مكتملة |
| GF-0012 | Pagination موحد لكل القوائم مع data/meta وقيود page/limit | مكتملة |
| GF-0013 | مراحل الإنتاج، stage runs، المخرجات، الاستهلاك، التكلفة، وposting المنتج التام | مدمجة على main؛ تحتاج متابعة UI/اختبارات تشغيلية لاحقة |
| GF-0014 | الجودة والهالك وربط stageRun وKPI | مكتملة ومُدمجة عبر PR #25؛ migration وCI PostgreSQL ناجحان |
| GF-0015 | attendance endpoint + payroll | attendance جزئي مدمج عبر PR #24؛ payroll ينتظر التنفيذ المستقل |

## GF-0014 — الحالة التفصيلية

تضيف المرحلة فحصًا نهائيًا واحدًا مرتبطًا بـ`ProductionStageRun` مكتمل. يفرض الخادم وقاعدة البيانات الكميات غير السالبة وقاعدة `checkedQty = passedQty + rejectedQty + wasteQty`، ويفصل الرفض عن الهالك المصنف، ويحسب `wasteCost` من تكلفة الخادم. تُسجل هوية actor وActivityLog ويدعم المسار `Idempotency-Key`، ولا يوجد تعديل مباشر لفحص مكتمل.

يضيف `GET /quality/kpis` تجميعًا حقيقيًا من `QualityCheck` بحالات `COMPLETED` فقط، مع مرشحات المرحلة وأمر التشغيل والفترة، وإرجاع totals وpass/rejection/waste rates. لا تكتب المرحلة مخزونًا أو قيودًا محاسبية.

السياسة المعتمدة في ADR-0014 هي رفض `PENDING` و`IN_PROGRESS` و`CANCELLED`، وقيد فريد على `stageRunId` غير الفارغ لمنع الفحص المكرر لنفس تنفيذ المرحلة. الصفوف التاريخية legacy تبقى قابلة للقراءة وحقول الربط الجديدة nullable.

## دليل التحقق المحلي لـGF-0014

| الفحص | النتيجة |
|---|---|
| `npx prisma validate` | PASS |
| `npx prisma generate` | PASS — Prisma Client 7.9.1 |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| Unit tests | PASS — 27 suites / 144 tests |
| E2E tests | PASS — 3 suites / 46 tests، وتشمل 401 لمسار KPI |
| Integration محليًا | NOT RUN — 2 suites / 14 tests skipped لغياب `GF_INTEGRATION_DATABASE_URL` وDocker؛ CI PASS في Run `32926745698` |
| Migration deploy محليًا | NOT RUN — CI PASS على PostgreSQL 16 في Run `32926745698` |
| Flutter analyze/test | CI PASS في Run `32926745698`; لم تُشغّل محليًا |
| Secret Scan | PASS — نفس patterns الخاصة بـCI |
| `git diff --check` | PASS قبل توثيق الحالة؛ يجب إعادة تشغيله قبل push |

## الفجوات والقيود المعروفة

1. تم دمج PR #25، ونجح CI على `main@9e8ffcc`؛ GF-0014 مغلقة من ناحية الكود والبوابات، مع بقاء متطلبات التشغيل المؤسسي العامة.
2. أثبت Run `32926745698` تطبيق migration على PostgreSQL نظيفة وتشغيل integration؛ لا تزال قاعدة بيانات production غير موجودة ضمن المشروع.
3. اختبارات E2E الحالية mock-backed، وتظل اختبارات PostgreSQL التكاملية المرجع لمسار البيانات الحقيقي.
4. لا توجد بعد آلية adjustment/reversal لفحص مكتمل؛ أي تصحيح يجب أن يكون مهمة مستقلة مع audit trail.
5. وجود PR #24 المدمج يعني أن GF-0015 بدأت جزئيًا على main، ولا يجوز تكرار أو استبدال attendance قبل مراجعة scope الفعلي.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة، ولا يُعتبر PR مدمجًا قبل تنفيذ الدمج والتحقق من CI على `main`.

## آخر تحديث توثيقي

تم تحديث هذا الملف على فرع `phase5/gf0015-payroll` فوق `main@eae3f7e` بعد تنفيذ payroll MVP وفق ADR-0015. البوابات المحلية Backend خضراء، والتكامل الحقيقي ينتظر CI؛ المهمة التالية هي رفع PR والتحقق منه.
