# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الأساسي المرجعي | `origin/main` |
| آخر commit على main | `2b530f9` — خط أساس origin/main بعد آخر الدمجات؛ لا يحتوي إصلاحات PR #52/#54 |
| فرع العمل الحالي | `direct/gf-audit-002d-payroll-payment` — إصلاحات المشتريات، دفع الرواتب، Dashboard، وحماية الترحيل |
| آخر commit في فرع العمل | `8a439c6` — توثيق الحالة والـbacklog والhandoff؛ CI اليدوي على هذا الخط الأخضر |
| Pull Requests الحالية | [PR #52](https://github.com/rabea0169/garment-factory-erp/pull/52) للمشتريات + [PR #54](https://github.com/rabea0169/garment-factory-erp/pull/54) للتوسعة؛ كلاهما ينتظر المراجعة والدمج |
| آخر مرحلة مكتملة بالكامل على main | GF-0019؛ الإصلاحات المباشرة GF-AUDIT-001C/001D وما بعدها ما زالت على PRs |
| حالة CI على main | `origin/main@2b530f9`؛ CI اليدوي على `8a439c6` في Run `32949589191` أخضر: Backend/Integration/Flutter/Secret Scan، بينما Prisma Compute Deploy الخارجي فاشل |
| حالة قاعدة البيانات | migrations GF-0014 إلى GF-0019 وGF-REMAINING-003 نجحت على PostgreSQL 16 في CI؛ لا توجد production/shared DB |
| إصدار API | `1.1-draft`؛ أضيف `/dashboard/stats` و`POST /hr/payrolls/:id/pay` على فرع الإصلاح، ولم يُعتمد الإصدار قبل الدمج |
| قاعدة البيانات المحلية | لا يوجد Docker/PostgreSQL متاح؛ integration وmigration deploy يجب إثباتهما في CI |
| الإصدار | `pre-release`؛ غير معتمد لتشغيل مؤسسي |
| المهمة النشطة | GF-AUDIT-002D — دفع الرواتب وDashboard وحماية الأرصدة؛ التنفيذ المباشر مكتمل على PR #54 |
| المرحلة النشطة | موجة الإصلاح المباشر؛ PR #54 مفتوح وCI اليدوي أخضر، وفحص Prisma Compute الخارجي فاشل؛ الدمج فقط بتفويض صريح |
| حالة GF-0014 | مكتملة ومُدمجة في main عبر PR #25؛ CI على merge commit أخضر |
| حالة GF-0015 | attendance عبر PR #24 وpayroll draft/approval عبر PR #30 مدمجان؛ main CI أخضر |
| Security blockers | لا P0/P1 أمني جديد من التغييرات الحالية؛ Secret Scan وCI الأخضر، لكن الإصدار يبقى No-Go حتى مراجعة PRs ومعالجة Prisma Compute وnpm audit |
| Open decisions | adjustment/reversal لفحص مكتمل مؤجل إلى ADR ومهمة مستقلة؛ لا كتابة مخزون/محاسبة في GF-0014 |
| Last handoff | `docs/handoffs/HANDOFF-GF-AUDIT-002D.md` سيُضاف مع اكتمال مراجعة PR #54 |
| Next exact action | مراجعة PR #54 دلاليًا، حل فشل Prisma Compute الخارجي، ثم دمج PR #52/#54 بترتيب آمن وإعادة CI على main |

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
| GF-0020 | GRN/AP — ترحيل إيصالات الشراء إلى الحسابات الدائنة | مدمجة خارجيًا عبر PR #38؛ لم تُراجع ضمن هذا التسليم |

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

تم تحديث هذا الملف على فرع `direct/gf-audit-002d-payroll-payment` فوق `origin/main@2b530f9`. الإصلاحات الحالية في PR #54 تشمل المشتريات ودفع الرواتب وDashboard وحماية الأرصدة. Run `32949589191` أخضر لجميع بوابات CI الداخلية، بينما Prisma Compute Deploy الخارجي ما زال فاشلًا؛ الإصدار Production يبقى No-Go حتى حل الفحص الخارجي واعتماد المحاسبة وRestore/UAT.
