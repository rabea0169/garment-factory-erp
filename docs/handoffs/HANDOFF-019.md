# Handoff 019 — Shipment Creation Idempotency

## Status

- Branch: `phase/gf0019-shipment-idempotency`
- Base: `main@94ca689` بعد دمج PR #35
- Phase: GF-0019 Shipping and Inventory Hardening
- Status: تنفيذ محلي؛ ينتظر commit/PR/CI

## Completed

دُقّق PR #35 المدمج، وثبت أن انتقال PREPARING إلى SHIPPED يصرف عناصر أمر البيع من مخزن المنتج التام عبر InventoryService داخل transaction واحدة، مع منع الرصيد السالب وتسجيل StockLedgerEntry. أضيف إلى integration fixture منتج وصنف ومخزون فعلي حتى لا يمر الاختبار دون عناصر بيع.

الفجوة المتبقية كانت أن `POST /shipping` ينشئ شحنة جديدة مع كل retry. أضيف `Idempotency-Key` اختياري لإنشاء الشحنة، مع actor من JWT، replay للمفتاح والمحتوى نفسيهما، و409 عند اختلاف المحتوى أو النطاق. المفتاح والسجل والاستجابة تُحفظ داخل transaction واحدة.

## Files Changed

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260830050000_gf0019_shipment_create_idempotency/migration.sql`
- `backend/src/modules/shipping/shipping.service.ts`
- `backend/src/modules/shipping/shipping.controller.ts`
- `backend/src/modules/shipping/shipping.service.spec.ts`
- `backend/src/modules/shipping/shipping.controller.spec.ts`
- `backend/test/shipping.integration-spec.ts`
- `docs/adr/ADR-0019-shipment-create-idempotency.md`
- `docs/API_CONTRACT.md`
- `docs/DATA_AND_MIGRATIONS.md`
- `docs/PROJECT_STATE.md`
- `docs/handoffs/HANDOFF-019.md`

## Checks

| Check | Result | Notes |
|---|---|---|
| Prisma validate/generate | PASS | schema valid; Client generated |
| Format/typecheck/lint | PASS | local |
| Shipping unit/controller | PASS | 2 suites / 10 tests |
| Full backend build/unit/E2E | PASS | build؛ 28 suites / 169 tests؛ 3 E2E suites / 50 tests |
| PostgreSQL integration | NOT RUN LOCALLY | 6 suites / 24 tests skipped لغياب Docker وGF_INTEGRATION_DATABASE_URL |
| Flutter | NOT RUN LOCALLY | لا تغييرات Flutter؛ مطلوب CI |
| Secret scan | PENDING PR CI | الفحص المحلي لا يثبت CI؛ لا secrets جديدة |

## Boundaries

إنشاء الشحنة لا يكتب قيدًا ماليًا. صرف المنتج التام عند SHIPPED هو الأثر المخزني الوحيد في هذا slice. رفع ملفات POD، تعديل بيانات الشحنة، refunds، payment posting، وshipping partial fulfillment ليست ضمن هذا PR.

## Next Exact Task

البوابات المحلية الكاملة خضراء، مع 6 integration suites / 24 tests متخطاة محليًا لغياب Docker وGF_INTEGRATION_DATABASE_URL. الخطوة التالية مراجعة diff والمهاجرة، ثم commit/push وفتح PR GF-0019؛ يجب أن يثبت CI migration deploy، replay، صرف المخزون والـledger، وFlutter وSecret Scan قبل الدمج.

## Rollback

استخدم `git revert` للشفرة وbackup/restore أو migration عكسية معتمدة للقاعدة. لا تحذف shipments أو stock ledger entries يدويًا.
