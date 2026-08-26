# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الأساسي المرجعي | `origin/main` |
| آخر commit على main | `90c37f6` — دمج PR #24، ويتضمن جزء attendance من GF-0015 |
| فرع العمل الحالي | `phase4/gf0014-quality-waste-v2` |
| آخر commit في فرع العمل | `2a56602` — GF-0014 quality/waste/KPI بعد rebase على main الأحدث |
| Pull Request الحالي | لا يوجد بعد؛ الفرع جاهز للرفع وفتح PR مستقل |
| آخر مرحلة مكتملة بالكامل على main | GF-0013؛ GF-0015 بدأ جزئيًا فقط عبر attendance endpoint في PR #24 |
| حالة CI على main | يجب إعادة التحقق بعد رفع GF-0014؛ آخر main مرجعي هو `90c37f6` |
| حالة قاعدة البيانات | migration `20260830000000_gf0014_quality_waste` غير مطبقة على بيئة مشتركة؛ التغيير additive فقط |
| إصدار API | `1.0`؛ أضيف `GET /quality/kpis` ووثّق POST الجودة في GF-0014 |
| قاعدة البيانات المحلية | لا يوجد Docker/PostgreSQL متاح؛ integration وmigration deploy يجب إثباتهما في CI |
| الإصدار | `pre-release`؛ غير معتمد لتشغيل مؤسسي |
| المهمة النشطة | `GF-0014-CLOSE`: رفع ومراجعة ودمج PR الجودة والهالك |
| المرحلة النشطة | Phase 5 — Quality and Waste delivery gate |
| حالة GF-0014 | التنفيذ مكتمل محليًا، والـPR وCI ودمج main ما زالت معلقة |
| حالة GF-0015 | يوجد جزء attendance مدمج في main؛ لا يبدأ تنفيذ HR/Payroll إضافي قبل مراجعة PR #24 مقابل MASTER_BACKLOG |
| Security blockers | لا P0/P1 جديد معروف ضمن GF-0014؛ actor من JWT، المسارات محمية، وSecret Scan المحلي PASS |
| Open decisions | adjustment/reversal لفحص مكتمل مؤجل إلى ADR ومهمة مستقلة؛ لا كتابة مخزون/محاسبة في GF-0014 |
| Last handoff | `docs/handoffs/HANDOFF-014.md` |
| Next exact action | رفع الفرع وفتح PR مستقل فوق `main@90c37f6`، ثم انتظار CI PostgreSQL/Flutter قبل الدمج |

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
| GF-0014 | الجودة والهالك وربط stageRun وKPI | غير مدمجة؛ جاهزة للـPR على الفرع الحالي |
| GF-0015 | attendance endpoint | جزئية مدمجة عبر PR #24؛ لا تعتبر المرحلة مكتملة |

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
| Integration محليًا | NOT RUN — 2 suites / 14 tests skipped لغياب `GF_INTEGRATION_DATABASE_URL` وDocker |
| Migration deploy محليًا | NOT RUN — لا PostgreSQL/Docker متاح |
| Flutter analyze/test | NOT RUN محليًا — التغيير Backend-only؛ مطلوب في CI |
| Secret Scan | PASS — نفس patterns الخاصة بـCI |
| `git diff --check` | PASS قبل توثيق الحالة؛ يجب إعادة تشغيله قبل push |

## الفجوات والقيود المعروفة

1. لم يُفتح أو يُدمج PR GF-0014، لذلك لا يجوز إعلان GF-0014 مكتملة مؤسسيًا.
2. يجب أن يثبت CI تطبيق migration على PostgreSQL نظيفة وتشغيل 14 حالة integration، بما فيها one-check-per-stageRun وKPI وCHECK constraints.
3. اختبارات E2E الحالية mock-backed، وتظل اختبارات PostgreSQL التكاملية المرجع لمسار البيانات الحقيقي.
4. لا توجد بعد آلية adjustment/reversal لفحص مكتمل؛ أي تصحيح يجب أن يكون مهمة مستقلة مع audit trail.
5. وجود PR #24 المدمج يعني أن GF-0015 بدأت جزئيًا على main، ولا يجوز تكرار أو استبدال attendance قبل مراجعة scope الفعلي.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة، ولا يُعتبر PR مدمجًا قبل تنفيذ الدمج والتحقق من CI على `main`.

## آخر تحديث توثيقي

تمت مزامنة هذا الملف على فرع `phase4/gf0014-quality-waste-v2` بعد rebase على `origin/main@90c37f6` وcommit التنفيذ `2a56602`. يجب إضافة رقم PR وmerge SHA ونتيجة CI بعد الرفع والدمج، وعدم اعتبار هذه الحالة نهائية قبل ذلك.
