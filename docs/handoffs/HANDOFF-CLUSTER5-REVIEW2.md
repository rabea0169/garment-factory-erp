# HANDOFF — Cluster 5 Review Corrections

## الحالة

هذه حزمة تصحيحية مبنية على `main` بعد دمج Cluster 5 في PR #16. النطاق هو إصلاح الفجوات المؤكدة في keyed financial posting، ذرية إنشاء Voucher، مصدر مخزون المنتج التام، تكلفة المنتج التام، ومسار soft-delete، دون إعادة تصميم شامل خارج Cluster 5.

## الإصلاحات

- إضافة `postingKey` و`postingHash` إلى `JournalEntry` مع replay للمحتوى نفسه ورفض المحتوى المختلف.
- جعل إنشاء Voucher والقيد وتحديث الخزينة والذمم داخل Prisma transaction واحدة.
- تمرير `Idempotency-Key` من AccountingController إلى خدمة السند.
- توحيد بيع المنتج التام عبر `FinishedGoodStock` و`InventoryService.issueFinishedGood`.
- إضافة `unitCost` لمخزون المنتج التام، وتحديث تكلفة مرجحة عند PACKING، وإضافة COGS إلى دليل الحسابات.
- حفظ metadata اللازمة لعكس آثار القيد، ومنع العكس المكرر بقيد فريد.
- إصلاح replay المتزامن في issueFinishedGood بإتمام await داخل try/catch.
- تحديث فلاتر soft-delete في المنتجات والموردين واختباراتها.

## Migrations

- `20260829070000_cluster5_reversal_atomic_metadata`
- `20260829080000_cluster5_finished_goods_cost`
- `20260829090000_cluster5_financial_posting_idempotency`

المigrations additive، وترتيبها بعد migrations التي تنشئ `reversalOfId`، وتنفذ backfill مخزون المنتج التام legacy إلى `WH-FG` بتكلفة صفرية معلنة لأن المصدر التاريخي لا يحمل تقييمًا موثوقًا.

## الأدلة المحلية

- `prisma validate`: ناجح.
- `prisma generate`: ناجح.
- `typecheck`: ناجح.
- `lint`: ناجح.
- `build`: ناجح.
- Unit: 26 suites / 126 tests ناجحة.
- E2E: 2 suites / 36 tests ناجحة.
- Integration: 1 suite / 6 tests skipped محليًا لعدم توفر PostgreSQL/Docker؛ يجب اعتبار CI على PostgreSQL بوابة إلزامية.

## حدود معروفة

هذه الحزمة لا تغلق كل عناصر الجاهزية المؤسسية: لا تزال اختبارات البيع المالي الحقيقية على PostgreSQL واختبارات reconciliation وload testing مطلوبة، كما يجب التحقق من CI على قاعدة نظيفة وقاعدة تحتوي بيانات legacy قبل الدمج.

## الخطوة التالية

رفع PR مستقل من `audit-fixes/cluster5-post16-review` إلى `main`، انتظار كل بوابات CI، مراجعة migration logs، ثم الدمج فقط بعد نجاحها وطلب الدمج المصرح به سابقًا. بعد الدمج يجب التحقق من merge commit وCI على `main` وتحديث PROJECT_STATE.
