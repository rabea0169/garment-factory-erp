# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الأساسي المرجعي | `origin/main` |
| آخر commit على main | `bd3c02eefc404a2110c60c31df3ea405214186e6` — baseline متحقق يتضمن إصلاحات Railway |
| فرع العمل الحالي | `feat/sprint1-navigation-ux` — شريحة Sprint 1 معزولة |
| آخر commit في فرع العمل | مبني على baseline أعلاه؛ تغييرات Sprint 1 قيد المراجعة قبل أول commit |
| Pull Requests الأخيرة | لا يوجد PR لـSprint 1 بعد؛ لا دمج إلى main دون موافقة صريحة |
| آخر مرحلة مكتملة بالكامل على main | آخر حالة موثقة قبل Sprint 1؛ هذا الفرع لا يغيّر main |
| حالة CI على main | تُراجع من GitHub قبل الدمج؛ نجاح الفحوص المحلية لا يثبت CI أو جاهزية الإنتاج |
| حالة قاعدة البيانات | لا توجد migration في Sprint 1؛ إضافة `email` تستعمل عمود Customer الموجود مسبقًا |
| إصدار API | `1.1`؛ توسعة `POST /sales/customers` لتوثيق وحفظ `email` الاختياري |
| قاعدة البيانات المحلية | `GF_INTEGRATION_DATABASE_URL` غير مضبوط؛ اختبارات PostgreSQL التكاملية لم تُشغّل محليًا |
| الإصدار | `pre-release`؛ غير معتمد لتشغيل مؤسسي أو إنتاجي |
| المهمة النشطة | Sprint 1 — navigation/UX وContact Picker وربط إنشاء العميل |
| المرحلة النشطة | التنفيذ والتحقق المحلي مكتملان مبدئيًا؛ APK Debug نجح، ولا يوجد اختبار جهاز فعلي أو قبول إنتاجي |
| سبب عدم إغلاق Sprint 1 | يلزم مراجعة diff النهائي، secret scan، commit/push، فتح PR، وانتظار CI؛ supplier/worker APIs خارج النطاق |
| حالة GF-0014 | مكتملة ومُدمجة في main عبر PR #25؛ CI على merge commit أخضر |
| حالة GF-0015 | attendance عبر PR #24 وpayroll draft/approval عبر PR #30 مدمجان؛ main CI أخضر |
| Security blockers | لا أسرار في Sprint 1 حسب المراجعة الحالية؛ بيئة Railway التجريبية لا تعني جاهزية إنتاجية، ويجب تغيير بيانات الحساب التجريبي قبل الاستخدام الحقيقي |
| Open decisions | إنشاء Supplier API وWorker API وربط Contact Picker بهما مؤجلان؛ إنشاء أمر البيع من الواجهة ودورات ERP الأخرى مؤجلة |
| Last handoff | سيُضاف `docs/handoffs/HANDOFF-SPRINT1-NAVIGATION-UX.md` مع نتائج التحقق وقيود التشغيل |
| Next exact action | إكمال secret/diff review ثم commit وpush وفتح PR مستقل؛ لا تدمج PR إلا بعد تفويض صريح ونجاح CI |

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
| GF-0015 | attendance endpoint + payroll | مكتملة ومُدمجة عبر PR #24 و#30؛ CI أخضر |
| GF-0016 | receipt idempotency وربط الاستلام بالـledger | مكتملة ومُدمجة عبر PR #27 و#31؛ CI PostgreSQL أخضر |
| GF-0017 | shipment lifecycle وproof of delivery وactor audit | مكتملة ومُدمجة عبر PR #29 و#33؛ CI PostgreSQL أخضر |
| GF-0018 | fiscal periods وقيود متعددة البنود ومنع الترحيل المغلق | مكتملة ومُدمجة عبر PR #32 و#36؛ CI PostgreSQL أخضر |
| GF-0019 | صرف المنتج التام عند SHIPPED وحماية إنشاء الشحنة من التكرار | مكتملة ومُدمجة عبر PR #35 و#39؛ migration وCI PostgreSQL أخضران |
| GF-0020 | GRN/AP — ترحيل إيصالات الشراء إلى الحسابات الدائنة | مكتملة وموجودة على main عبر PR #55 |

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

1. تم دمج GF-0014 إلى GF-0018 في PRs مستقلة (#25، #30، #31، #33، #36)، ونجح CI النهائي على `main@5dfa0fe` بما في ذلك migrations وPostgreSQL integration.
2. أثبت Run `32926745698` تطبيق migration على PostgreSQL نظيفة وتشغيل integration؛ لا تزال قاعدة بيانات production غير موجودة ضمن المشروع.
3. اختبارات E2E الحالية mock-backed، وتظل اختبارات PostgreSQL التكاملية المرجع لمسار البيانات الحقيقي.
4. لا توجد بعد آلية adjustment/reversal لفحص مكتمل؛ أي تصحيح يجب أن يكون مهمة مستقلة مع audit trail.
5. GF-0015 إلى GF-0018 مكتملة ضمن النطاق المنفذ، لكن ذلك لا يعني الجاهزية المؤسسية: لا تزال UAT، backup/restore، monitoring، Flutter workflows، وربط posting التجاري/الرواتب بالمحاسبة الآلية خارج هذه الشرائح.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة، ولا يُعتبر PR مدمجًا قبل تنفيذ الدمج والتحقق من CI على `main`.

## آخر تحديث توثيقي

تم تحديث هذا الملف على فرع `docs/post-merge-release-state` فوق `main@e32f745` بعد دمج PR #57 وPR #58. Run `32950963418` أخضر وحقق Backend وPostgreSQL integration وE2E وFlutter وSecret Scan. ما زال Production No-Go حتى إغلاق Prisma Compute/npm audit وBackup/Restore/UAT.
