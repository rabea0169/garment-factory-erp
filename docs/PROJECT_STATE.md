# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الأساسي المرجعي | `origin/main` |
| آخر commit على main | `78de23a` — دمج PR #62 وإغلاق GF-REMAINING-007؛ CI main run `32956288873` أخضر |
| فرع العمل الحالي | `fix/p0-financial-reconciliation-rebased` — إغلاق فجوات المصالحة المالية وسباقات production |
| آخر commit في فرع العمل | إعادة تأسيس فرع PR #64 على `origin/main@78de23a` قيد الإتمام |
| Pull Request الحالي | PR #64 مفتوح؛ كان متعارضاً مع main ويجري تحديثه قبل إعادة CI |
| آخر مرحلة مكتملة بالكامل على main | GF-REMAINING-007؛ الأداء والـPostgreSQL integration وFlutter وSecret Scan أخضر |
| حالة CI على main | `main@78de23a`؛ CI run `32956288873` أخضر ويشمل Performance وPostgreSQL integration |
| حالة قاعدة البيانات | migrations الحالية نجحت على PostgreSQL الاختبارية؛ PR #64 لا يضيف migration جديدة، لكنه يضيف assertions للمصالحة المالية |
| إصدار API | `1.1`؛ Dashboard حقيقي، receipt/AP idempotency، production replay، وقيود مالية مرتبطة بالمصدر |
| قاعدة البيانات المحلية | لا يوجد Docker/PostgreSQL محلي؛ PostgreSQL integration يجب إثباتها في CI أو بيئة اختبارية مخصصة |
| الإصدار | `pre-release`؛ غير معتمد لتشغيل مؤسسي |
| المهمة النشطة | P0 Financial Reconciliation — PR #64 |
| المرحلة النشطة | المصالحة المالية قيد الإغلاق؛ لا يبدأ Backup/Restore أو Go/No-Go قبل نجاح CI الخارجي والمراجعة والدمج |
| حالة الإصلاحات | خزينة البيع النقدي، metadata للعكس، مرتجع المورد، production idempotency، وtransaction timeout مغطاة بالكود والاختبارات على فرع PR #64 |
| Security blockers | لا سر جديد مثبت؛ Secret Scan main أخضر، لكن Prisma Compute في PR #64 فاشل والمصالحة المالية وBackup/Restore وUAT وPilot ما زالت موانع |
| Open decisions | القيود التاريخية الناقصة metadata تحتاج reconciliation/adjustment معتمدًا؛ Backup/Restore وUAT وmonitoring وPilot خارج الإصلاح الحالي |
| Last handoff | `docs/handoffs/HANDOFF-P0-FINANCIAL.md` |
| Next exact action | إتمام rebase وحل التعارضات، تشغيل كل بوابات PR #64 بما فيها Prisma Compute وPostgreSQL، ثم طلب الدمج؛ بعده تنفيذ Backup/Restore Drill وUAT |

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
