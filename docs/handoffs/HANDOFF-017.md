# Handoff 017 — Shipping Lifecycle and Proof of Delivery

## Status

- Branch: `phase7/gf0017-shipping-hardening`
- Base: `main@a835b87` بعد CI أخضر لدمج GF-0016
- Phase: GF-0017 Shipping
- Status: تنفيذ محلي؛ ينتظر commit/PR/CI

## Completed

دُقّق PR #29 المدمج، وثبت أنه يفرض lifecycle أساسيًا لكنه لا يسجل إثبات التسليم أو actor ولا يحمي التحديث من race. أضيفت migration additive لحقلي `proofOfDelivery` و`deliveredById`، وأصبح الانتقال إلى DELIVERED يتطلب إثباتًا غير فارغ ويأخذ الفاعل من JWT. صار تحديث الحالة transaction ذريًا بشرط الحالة السابقة، ويسجل ActivityLog، ويعيد 409 عند سباق التحديث.

أضيفت PostgreSQL integration suite لتسلسل PREPARING→SHIPPED→IN_TRANSIT→DELIVERED والتحقق من POD والفاعل، وحالة رفض DELIVERED بلا إثبات. لا يكتب مسار الشحن مخزونًا أو قيودًا مالية.

## Files Changed

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260830030000_gf0017_shipment_pod/migration.sql`
- `backend/src/modules/shipping/shipping.service.ts`
- `backend/src/modules/shipping/shipping.controller.ts`
- `backend/src/modules/shipping/dto/update-shipment-status.dto.ts`
- `backend/src/modules/shipping/shipping.service.spec.ts`
- `backend/src/modules/shipping/shipping.controller.spec.ts`
- `backend/test/shipping.integration-spec.ts`
- `docs/adr/ADR-0017-shipment-lifecycle-and-pod.md`
- `docs/API_CONTRACT.md`
- `docs/DATA_AND_MIGRATIONS.md`
- `docs/handoffs/HANDOFF-017.md`

## Checks

| Check | Result | Notes |
|---|---|---|
| Prisma validate/generate | PASS | schema valid; Client generated |
| Format/typecheck/lint | PASS | local |
| Shipping unit/controller | PASS | 2 suites / 9 tests |
| Full backend unit/E2E/build | PENDING | بعد التوثيق النهائي |
| PostgreSQL integration | NOT RUN LOCALLY | 5 suites / 22 tests skipped لغياب Docker وGF_INTEGRATION_DATABASE_URL |
| Flutter | NOT RUN LOCALLY | لا تغييرات Flutter؛ مطلوب CI |
| Secret scan | PENDING PR CI | لا secrets جديدة |

## Not Done / Boundaries

إنشاء الشحنة نفسه لا يزال بلا idempotency؛ إضافة ملفات/صور POD أو تعديل إثبات التسليم، وربط shipment بالدفع والمحاسبة، ليست ضمن هذا slice. لا يُعلن GF-0017 جاهزًا للإنتاج قبل CI PostgreSQL.

## Next Exact Task

تشغيل البوابات الكاملة، مراجعة diff وmigration، commit/push وفتح PR GF-0017، ثم انتظار migration deploy وintegration وFlutter وSecret Scan. بعد الدمج وتحقق main، يبدأ GF-0018 فقط بعد مراجعة مسارات المحاسبة الموجودة.

## Rollback

استخدم `git revert` للشفرة وbackup/restore أو migration عكسية معتمدة للقاعدة. لا تحذف shipments أو ActivityLog يدويًا.
