# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## تحديث الموجة 7 — إصلاح P0 (2026-09-05)

كشف فحص شامل أُجري في 2026-09-05 أن `main` دُمجت فيه موجات UAT كاملة بـ CI أحمر، وأن آخر 8 تشغيلات CI على `main` فاشلة منذ 2026-08-28 (تحقق مباشر عبر GitHub Actions API؛ آخر تشغيل `33214907002` على `main@e72ee94` — فشل). وظيفتا CI الفاشلتان: E2E tests ووظيفة Performance التي تتوقف عند خطوة Seed. الموجات المعنية: موجة 1-3 عبر PR #73، الموجة 4 عبر PR #74، الموجة 5 عبر PR #75، الموجة 6 عبر PR #76.

**السبب الجذري — انحراف schema في الموجة 4 (P0):** migration `20260902000000_wave4_sec_f04_refresh_tokens` أنشأ `users.jwt_version` وجدول `refresh_tokens` بأعمدة snake_case، بينما `schema.prisma` صرّح بـ camelCase بلا `@map`. النتيجة: خطأ Prisma `P2022` على كل استعلام يمس User أو RefreshToken — رسالة الفشل الفعلية المسجلة: `The column users.jwtVersion does not exist in the current database`. الأثر:

- تسجيل الدخول نفسه معطل (500) على أي قاعدة تُبنى من migrations — أُعيد إنتاج الفشل محليًا على PostgreSQL 16 ثم أُعيد التحقق من الإصلاح.
- seed يفشل، ومن ثم تفشل خطوة Seed في وظيفة Performance.
- آلية SEC-F04 (JWT refresh + revoke) غير قابلة للتشغيل على قاعدة حقيقية لأن جدول `refresh_tokens` نفسه غير قابل للاستعلام.

**الاختباران E2E الفاشلان (62/64 قبل الإصلاح):** فشل اختبار auth-guard عند تسجيل سلفة (500) لأن mock الاختبار لم يُحدَّث بنموذج worker الذي أضافته الموجة 5، وفشل اختبار production-workflow عند وسيط idempotency الثالث في finalizeCost لأن assertion ظل على سلوك ما قبل RES-F02. كلاهما عيب في الاختبار لا في المسار التشغيلي.

**الإصلاح المنفذ على فرع `fix/uat-remediation-wave7-p0`** (غير مدمج — ينتظر مراجعة PR وCI):

1. إضافة `@map` في `schema.prisma` لـ `User.jwtVersion` ولكل حقول `RefreshToken` لتطابق بنية القاعدة القائمة. لا migration جديد لأن بنية القاعدة صحيحة أصلًا والخطأ كان في تصريحات النموذج فقط؛ إضافة migration كانت ستفاقم الانحراف.
2. إصلاح اختباري E2E: mock نموذج worker المفقود وتحديث assertion وسيط idempotency وفق RES-F02.
3. تُوثَّق بالتوازي خطة النسخ الاحتياطي وسيناريوهات UAT في `docs/runbooks/BACKUP_RESTORE.md` و`docs/UAT_SCENARIOS.md` (بطاقة الوكيل المعني، لا تُعد مكتملة قبل دمجها).

**نتائج التحقق المحلي على الفرع (2026-09-05):** `typecheck` و`lint` و`build` و`prisma validate` ناجحة؛ unit tests 36 suites / 302 tests ناجحة؛ E2E 3 suites / 64 tests ناجحة؛ `prisma migrate deploy` ثم `prisma db seed` ناجحان على قاعدة PostgreSQL 16 نظيفة (إعادة إنتاج خطوة Seed الفاشلة في CI)؛ و`POST /auth/login` يرجع 200 مع إدراج سجل في `refresh_tokens` على قاعدة مبنية من migrations (قبل الإصلاح: 500/P2022 على نفس القاعدة). لا يثبت ذلك نجاح CI على GitHub — الفحص النهائي مسؤولية تشغيل PR.

يبقى فحص قاعدة Railway الإنتاجية مطلوبًا بعد الدمج لأنها قد تكون متأثرة بنفس الانحراف إذا طُبقت عليها migrations الموجة 4-6.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الأساسي المرجعي | `origin/main` |
| آخر commit على main | `e72ee94` — fix(uat): wave 6 — COMM-F07 customer credit limit + SCHEMA-F01 follow-up (#76) بتاريخ 2026-08-29 |
| فرع العمل الحالي | `fix/uat-remediation-wave7-p0` — إصلاح P0 انحراف schema + إصلاح اختباري E2E؛ لم يُرفع إلى GitHub بعد عند إعداد هذا التحديث |
| Pull Requests الأخيرة | #73 (موجات 1-3) و#74 (موجة 4) و#75 (موجة 5) و#76 (موجة 6) مدمجة في main وكلها بـ CI أحمر؛ لا يُدمج PR جديد قبل CI أخضر وموافقة المالك |
| آخر مرحلة مكتملة بالكامل على main | الموجات 1-6 مدمجة كوديًا لكن بوابة CI غير متحققة؛ آخر حالة CI أخضر موثقة على main قبل هذه الموجات |
| حالة CI على main | فاشلة — آخر 8 تشغيلات منذ 2026-08-28 (آخرها Run `33214907002` على `e72ee94`: فشل E2E tests وPerformance عند Seed) |
| حالة قاعدة البيانات | 36 migration حتى `20260903000000_wave6_comm_f07_customer_credit_limit`؛ انحراف schema الذي أدخلته migration الموجة 4 أُصلح في النموذج على فرع العمل (بلا migration جديد) وينتظر الدمج |
| إصدار API | `1.0` (وفق `setVersion` في `main.ts`)؛ 11 وحدة و73 endpoint تشغيليًا |
| قاعدة البيانات المحلية | `GF_INTEGRATION_DATABASE_URL` غير مضبوط؛ تحقق الموجة 7 استعمل PostgreSQL 16 محمولًا على 5433 مباشرة عبر `DATABASE_URL` (migrate deploy + seed + login)، واختبارات PostgreSQL التكاملية لم تُشغّل محليًا وتظل مسؤولية CI |
| الإصدار | `pre-release`؛ غير معتمد لتشغيل مؤسسي أو إنتاجي |
| المهمة النشطة | GF-REMAINING-010 — إصلاح انحراف schema الموجة 4 وإعادة CI أخضر، ثم إكمال شروط Pilot |
| المرحلة النشطة | إصلاح P0 منفذ على `fix/uat-remediation-wave7-p0` ومتحقق محليًا؛ ينتظر مراجعة PR وتشغيل CI والدمج |
| سبب عدم الإغلاق النهائي | CI أحمر على main، مراجعة PR وموافقة المالك على الدمج، فحص قاعدة Railway الإنتاجية، UAT فعلي وbackup/restore قبل أي إطلاق |
| حالة GF-0014 | مكتملة ومُدمجة في main عبر PR #25؛ CI على merge commit أخضر |
| حالة GF-0015 | attendance عبر PR #24 وpayroll draft/approval عبر PR #30 مدمجان؛ main CI أخضر |
| Security blockers | لا أسرار في الفحص الحالي؛ `npm audit` بعد fix غير كاسر: أُغلقت ثغرتا qs والمتبقي ثغرتا سلسلة mysql2 داخل Prisma (غير مستخدمة — المشروع PostgreSQL حصريًا، والإصلاح الكاسر مؤجل بقرار MASTER_BACKLOG)؛ قاعدة Railway الإنتاجية قد تكون متأثرة بانحراف schema وتحتاج فحصًا بعد الدمج |
| Open decisions | قرار ثغرتا mysql2 داخل Prisma (`npm audit fix --force` يثبّت Prisma 6.19.3 — كاسر، مؤجل بقرار MASTER_BACKLOG)؛ طريقة فحص قاعدة Railway الإنتاجية بعد الدمج؛ نطاق UAT الفعلي وتوقيته وفق `docs/UAT_SCENARIOS.md` |
| Last handoff | `docs/handoffs/HANDOFF-UAT-REMEDIATION-WAVE7.md` (الموجة 7)؛ سلسلة البطاقات السابقة في `docs/handoffs/` |
| Next exact action | مراجعة PR لفرع `fix/uat-remediation-wave7-p0`، تشغيل CI والتحقق من اخضراره على main بعد الدمج بموافقة المالك، ثم فحص قاعدة Railway الإنتاجية من نفس الانحراف |

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

## سجل التنفيذ الشامل — 2026-08-27

على فرع `feat/sprint1-navigation-ux` تم تنفيذ شرائح إضافية فوق Sprint 1: Supplier وWorker master-data APIs مع RBAC، ربط Contact Picker بنماذج العميل والمورد والعامل مع شاشة مراجعة، دورة المبيعات والتحصيل والإلغاء والمرتجعات، دورة الشحن، أوامر الشراء والاستلام، فحص الجودة والهالك، الخزائن والسندات المحاسبية، وتوحيد حالات UX وإصلاح الانتظار غير المتزامن في تسجيل إنتاج العامل.

نتائج بوابات التحقق الأخيرة: Flutter analyze و29 اختبار Flutter وAndroid Debug APK ناجحة؛ Backend Prisma generate وformat وtypecheck وbuild ناجحة؛ 35 suite و241 unit tests ناجحة؛ و3 E2E suites و64 اختبارًا ناجحة. توجد 6 تحذيرات lint قديمة فقط في payroll/inventory specs، ولا توجد أخطاء lint. لم تُشغّل PostgreSQL integration محليًا لغياب `GF_INTEGRATION_DATABASE_URL`، ولم يُنفذ قبول على جهاز Android فعلي أو iOS build في بيئة Linux.

لم تُرفع commits ما بعد `b868087` إلى GitHub حتى الآن، ولم يتم دمج أي تعديل في `main`. يبقى الإصدار `pre-release` إلى أن تُغلق مراجعة الأسرار، وUAT، وsigning/release build، وخطة backup/restore وmonitoring، ثم تُرفع النسخة النهائية ويُراجع CI قبل الدمج.
