# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الرئيسي | `main` |
| آخر commit على main | `7e73cf75` — أساس GF-0013 قبل الدمج |
| فرع GF-0013 الحالي | `phase3/gf0013-schema-design` عند `3e99765` |
| Pull Request الحالي | [PR #11](https://github.com/rabea0169/garment-factory-erp/pull/11) — مفتوح، أخضر، غير مدمج |
| آخر CI أخضر للفرع | [Run 32884547465](https://github.com/rabea0169/garment-factory-erp/actions/runs/32884547465) |
| الإصدار | لا يوجد إصدار مؤسسي معتمد بعد — `pre-release` |
| آخر مهمة مكتملة على main | `GF-0012` — Pagination الموحد |
| حالة GF-0013 | نطاق schema/service/integration مكتمل في PR #11؛ API/RBAC وFlutter وFinishedGood posting مؤجلة |
| حالة CI على main | لم يُدمج GF-0013 بعد؛ آخر دليل أخضر هو CI الخاص بـ PR #11 |
| حالة قاعدة البيانات على main | خمس migrations: init، GF-0007، GF-0008، GF-0009، GF-0011 |
| حالة قاعدة البيانات على فرع GF-0013 | migration إضافية GF-0013 مجرّبة عبر `migrate deploy` على PostgreSQL 16 نظيفة في CI |
| API version | 1.0 — عقد GF-0013 HTTP لم يُفتح بعد |

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

1. PR #11 لا يضيف Controllers/DTOs/RBAC لمسارات workflow؛ لذلك لا توجد بعد واجهة HTTP متاحة للمستخدمين ولا اختبارات 401/403 الخاصة بها.
2. استلام المنتج التام إلى `FinishedGoodStock` وحركة ledger المقابلة لم يُنفذا بعد.
3. واجهة Flutter لمسار الإنتاج وحالات loading/empty/error/success مؤجلة إلى امتداد GF-0013 اللاحق وGF-0020.
4. اختبارات E2E الحالية تستخدم Prisma mock ولا تثبت runtime على PostgreSQL، باستثناء suite GF-0013 المخصصة التي تفعل ذلك على CI.
5. `npm audit` يحتاج قرارًا واعيًا بشأن ثغرات `deepmerge-ts` ضمن سلسلة Prisma؛ لا يُنفذ `npm audit fix --force` قبل قرار وترقية متوافقة.
6. `/dashboard/stats` غير منفذ في Backend، وبعض دورات الجودة والشحن والمالية ما زالت جزئية.
7. تحذير Node.js 20 في GitHub Actions غير حاجب، لكنه يحتاج تحديث actions لاحقًا.

## المهمة التالية الرسمية

امتداد **GF-0013 API/RBAC** بعد دمج PR #11 بطلب صريح: إنشاء DTOs ومسارات transition/output/consumption/cost، استخراج actor من JWT، مصفوفة أدوار واختبارات `401/403` وvalidation وHTTP idempotency، مع عدم تجاوز `ProductionWorkflowService` أو `InventoryService` وعدم إعادة تصميم schema دون ADR.

بعد ذلك ينفذ النموذج التالي Flutter workflow UI، ثم finished-good posting، قبل الانتقال إلى GF-0014 وفق ترتيب `MASTER_BACKLOG.md`.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة، ولا يُعتبر PR مدمجًا قبل تنفيذ merge بطلب صريح والتحقق من CI على `main`.

## آخر تحديث توثيقي

تم إنشاء `docs/handoffs/HANDOFF-013.md` وتحديث هذا الملف و`docs/CURRENT_STATUS_2026-08-25.md` بعد نجاح Run `32884547465`. PR #11 ما زال مفتوحًا، وPR #10 التوثيقي السابق ما زال مفتوحًا أيضًا ويجب عدم خلطه ببطاقة GF-0013.
