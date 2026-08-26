# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه عند إغلاق كل مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الرئيسي | `main` |
| آخر commit على main | `033ae6fd` — Merge PR #17: Cluster 5 financial and finished-stock integrity corrections |
| آخر CI على main | [Run 32916998502](https://github.com/rabea0169/garment-factory-erp/actions/runs/32916998502) — ناجح بالكامل |
| الإصدار | `pre-release` — لا يوجد إصدار مؤسسي معتمد |
| آخر مهمة مدمجة | Cluster 5 correction review بعد PR #16 |
| حالة قاعدة البيانات | migrations additive مطبقة في CI على PostgreSQL 16 نظيفة، مع migrations تصحيحية لـreversal metadata وfinished-good cost وfinancial posting idempotency |
| حالة working tree المحلية | فرع توثيق نظيف؛ لا توجد تغييرات تطبيقية غير ملتزم بها |

## ما هو مدمج في main

توجد في `main` مراحل المشروع السابقة GF-0001 حتى GF-0012، وتشمل المصادقة الأساسية وDTOs وRBAC العام، المخازن وStock Ledger ومنع الرصيد السالب، BOM versioning، المشتريات والاستلام، Flutter secure storage و401 handling، وتحسينات المبيعات، إضافة إلى Pagination الموحد.

يضم `main` نواة GF-0013 لنموذج مراحل الإنتاج وسجل الانتقالات واستهلاك الخامات وتكلفة الهدر واختبارات PostgreSQL، مع تحسينات Cluster 5 الخاصة بـidempotency للمبيعات، reversal، VAT، soft-delete، العملات، الأكواد الآمنة، posting المنتج التام، وتكلفة `FinishedGoodStock`.

كما يضم `main` الإصلاحات التشغيلية والأمنية من PR #15، ثم تصحيحات PR #17 التي جعلت إنشاء Voucher والقيد وتحديث الخزينة والذمم داخل transaction واحدة، وأضافت keyed financial posting replay/conflict، وربطت بيع المنتج التام بـ`FinishedGoodStock` و`InventoryService.issueFinishedGood`، وثبتت تكلفة المنتج التام ومسار PACKING والـsoft-delete guards.

## دليل التحقق بعد PR #17

| الفحص | النتيجة |
|---|---|
| `prisma validate` | ناجح محليًا وداخل CI |
| `prisma generate` | ناجح محليًا وداخل CI |
| `format:check` | ناجح داخل CI |
| `typecheck` | ناجح محليًا وداخل CI |
| `lint` | ناجح محليًا وداخل CI |
| `build` | ناجح محليًا وداخل CI |
| Unit tests | `26 suites / 126 tests` ناجحة محليًا وداخل CI |
| E2E tests | `2 suites / 36 tests` ناجحة محليًا وداخل CI |
| Prisma migrate deploy | ناجح على PostgreSQL 16 disposable داخل CI |
| PostgreSQL integration | `1 suite / 6 tests` ناجحة فعليًا داخل CI، وتشمل PACKING posting |
| Flutter analyze/test | ناجحان داخل CI |
| Secret Scan | ناجح داخل CI |
| Integration محليًا | `6 tests skipped` لعدم توفر Docker/PostgreSQL؛ لا تُحسب نجاحًا محليًا |

## migrations التصحيحية المضافة

- `20260829070000_cluster5_reversal_atomic_metadata`
- `20260829080000_cluster5_finished_goods_cost`
- `20260829090000_cluster5_financial_posting_idempotency`

هذه migrations additive، وترتب بعد migrations التي تنشئ `reversalOfId`. Backfill مخزون المنتج التام legacy إلى `WH-FG` يستخدم تكلفة صفرية معلنة لأن الجدول legacy لا يحتوي تقييمًا تاريخيًا موثوقًا.

## الفجوات المتبقية

رغم تحسن الأساس، لا تزال اختبارات البيع المالي الحقيقي على PostgreSQL وreconciliation الشامل وload testing مطلوبة. كما تحتاج readiness إلى فحص اتصال قاعدة البيانات، وتحتاج بعض المسارات إلى مراجعة field-level authorization، وتبقى offline queue وretry المتقدم في Flutter خارج الإغلاق الكامل.

يجب مراجعة أن كل واجهات GF-0013 المنشورة تستخدم `ProductionWorkflowService` و`InventoryService`، وأن المسارات القديمة التي تتعامل مع `finishedGood` لا تعيد إنشاء مصدر مخزون موازٍ. لا يبدأ GF-0014 قبل تثبيت عقد GF-0013 وقرار واضح بشأن PRs المفتوحة المرتبطة بها.

## قاعدة التسليم

كل تغيير مستقل يمر عبر فرع وPR ومراجعة migration واختبارات سلوكية وCI. نجاح build لا يعني اكتمال الوظيفة، ونجاح PR لا يعني دمجه. بعد كل merge يجب تسجيل merge commit وCI على `main` في هذا الملف وفي Handoff مناسب.

## آخر تحديث

تم دمج PR #17 عند `033ae6fd`، ونجح CI على `main` في Run `32916998502`. فرع تصحيحات المراجعة والـPR المرتبط به لم يعد يمثل العمل غير المدمج؛ المتبقي هو توثيق الحالة وإكمال الاختبارات الشاملة للمراحل المستقبلية وفق `MASTER_BACKLOG.md`.
