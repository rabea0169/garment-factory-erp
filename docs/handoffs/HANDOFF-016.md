# Handoff 016 — Purchasing Receipt Hardening

## Status

- Branch: `phase6/gf0016-purchasing-complete`
- Base: `main@19076b4` (بعد دمج GF-0015؛ يحتوي أيضًا تنفيذ GF-0016 الجزئي PR #27 وGF-0017 PR #29)
- Phase: GF-0016 Purchasing
- Status: إكمال الاستلام الجزئي محليًا؛ ينتظر commit/PR/CI

## Completed

تم تدقيق PR #27 ووجد أن `POST /purchasing/:id/receipts` ينشئ receipt وحركات `RECEIVE` عبر InventoryService داخل transaction، لكنه كان بلا Idempotency-Key. أضيف مفتاح idempotency اختياري مربوط بإذن الاستلام، مع تخزين استجابة قابلة للتسلسل، ورفض المحتوى المختلف بـ409، وإضافة اختبارات replay. قُوّي DTO لمنع قائمة فارغة، وأبقي فحص تكرار بنود الاستلام والكمية المتبقية.

أضيفت PostgreSQL integration suite تثبت receipt واحدًا وledger واحدًا وزيادة المخزون وإعادة الطلب الآمنة، واختبار تجاوز الكمية. لا تزال مراجعة التزامن العميقة للاستلام الجزئي بحاجة إلى إثبات CI؛ القراءة الحالية للرصيد السابق تتم قبل transaction، ولذلك لا يُعلن المسار جاهزًا للإنتاج قبل نتيجة الاختبار ومراجعة isolation.

## Files Changed

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260830020000_gf0016_receipt_idempotency/migration.sql`
- `backend/src/modules/purchasing/purchasing.service.ts`
- `backend/src/modules/purchasing/purchasing.controller.ts`
- `backend/src/modules/purchasing/dto/create-purchase-receipt.dto.ts`
- `backend/src/modules/purchasing/purchasing.service.spec.ts`
- `backend/test/purchasing.integration-spec.ts`
- `docs/API_CONTRACT.md`
- `docs/DATA_AND_MIGRATIONS.md`
- `docs/handoffs/HANDOFF-016.md`

## Checks

| Check | Result | Notes |
|---|---|---|
| Prisma validate/generate | PASS | schema valid; Client generated |
| Format/typecheck/lint | PASS | local |
| Build | PASS | local |
| Backend unit | PASS | 28 suites / 162 tests |
| Backend E2E | PASS | 3 suites / 50 tests |
| PostgreSQL integration | NOT RUN LOCALLY | 4 suites / 20 tests skipped لغياب Docker وGF_INTEGRATION_DATABASE_URL |
| Flutter | NOT RUN LOCALLY | لا تغييرات Flutter؛ مطلوب CI |
| Secret scan | PENDING PR CI | لا secrets جديدة |

## Not Done / Boundaries

الدفع للمورد وربط الذمم/المحاسبة، المرتجعات typed وledger RETURN، وتسوية الفروقات ليست مكتملة في هذا PR وتبقى ضمن GF-0016 أو GF-0018 حسب القرار. لا تُعدّل migration المدمجة السابقة، ولا تُستخدم `db push`.

## Next Exact Task

Commit/push وفتح PR مستقل لـGF-0016 فوق `main@19076b4`، ثم انتظار migration deploy وPostgreSQL integration في CI. بعد الدمج، تدقيق PR #29 المدمج الخاص بـGF-0017، ثم فتح GF-0018 فقط بعد استقرار مسار المشتريات وعدم وجود تغيير متداخل.

## Rollback

استخدم `git revert` للشفرة وbackup/restore أو migration عكسية معتمدة للقاعدة. لا تحذف receipts أو StockLedgerEntry يدويًا.
