# Handoff — GF-REMAINING-002: Warehouse-scoped inventory balances

## 1. Scope and verdict

- **Task ID:** GF-REMAINING-002
- **Verdict:** complete on branch; unsafe to merge until remote CI, including real PostgreSQL integration, passes.
- **In scope:** فصل رصيد الخامة لكل مستودع عن إجمالي `RawMaterial.currentStock`، تصحيح `balanceAfter` في حركات الخامات، منع الصرف من تجاوز رصيد المستودع، اختبار القراءة والمطابقة والتزامن، وتحديث العقد والتوثيق.
- **Out of scope:** مخزون المنتجات التامة، المحاسبة المالية، ترحيل المشتريات، تغيير schema أو migration، وواجهة الهاتف.
- **Dependencies:** `origin/main@a3b7191aeb56eb9472ca152642ac3fc2145578f7` بعد دمج PR #48 ونجاح CI على main.

## 2. Repository state

| Item | Value |
|---|---|
| Base branch | `origin/main` |
| Base SHA | `a3b7191aeb56eb9472ca152642ac3fc2145578f7` |
| Working branch | `fix/gf-remaining-002-inventory-ledger` |
| Head SHA | implementation commit `d5c3a8e`; documentation state update is the latest commit on this branch |
| Pull Request | pending push and PR creation |
| Merge status | not merged |
| CI run | local backend gates pass; local PostgreSQL unavailable; remote CI pending |

## 3. Implementation

يحسب `InventoryService.executeMovement` رصيد المستودع داخل نفس transaction بعد قفل صف الخامة وتحديث الإجمالي الذري. يتم رفض الرصيد السالب على مستويي الإجمالي والمستودع، وتُكتب لقطة `balanceAfter` الخاصة بالمستودع في سطر الـledger وفي الاستجابة. أصبح حدث `STOCK_LOW` يحمل `warehouseId` حتى لا يختلط تنبيه مستودع بآخر.

تم تصحيح `getMaterialBalanceByWarehouse` ليجمع `SUM(quantityDelta)` لكل مستودع بدلاً من اختيار آخر `balanceAfter`، لأن اللقطة لا تصلح كمصدر تجميع تاريخي عند وجود بيانات legacy أو عند اختلاف المستودعات.

تمت إضافة اختبارات unit للحركة والقراءة متعددة المستودعات، واختبار PostgreSQL حقيقي في `backend/test/inventory-warehouse.integration-spec.ts` يغطي مستودعين، مطابقة الإجمالي، اختلاف `balanceAfter`، وتزامن صرفين مع rollback لأحدهما.

لا توجد migration ولا تغييرات في schema؛ التعديل سلوكي في الخدمة والاستعلامات والاختبارات والتوثيق فقط.

## 4. Contract changes

| Area | Before | After |
|---|---|---|
| `RawMaterial.currentStock` | إجمالي الخامة | يبقى إجمالي الخامة عبر المستودعات |
| `StockMovementResult.balanceAfter` | قد يعكس الإجمالي العالمي | رصيد المستودع المحدد في `warehouseId` |
| `GET /inventory/raw-materials/:id/balance-by-warehouse` | يعتمد على آخر `balanceAfter` لكل مستودع | يعتمد على `SUM(quantityDelta)` لكل مستودع |
| `STOCK_LOW` event | `materialId`, `currentStock`, `minStockLevel` | يضاف `warehouseId` لتمييز الرصيد والتنبيه |

## 5. Verification evidence

| Gate | Command or run | Result | Notes |
|---|---|---|---|
| Install | existing `backend/node_modules` from `npm ci --no-audit --no-fund` | PASS | التبعيات موجودة من التحقق السابق |
| Prisma generate | `npx prisma generate` | PASS | Prisma Client 7.9.1 |
| Prisma validate | `npx prisma validate` | PASS | لا تغيير schema |
| Format | `npm run format:check` | PASS | كل ملفات backend منسقة |
| Typecheck | `npm run typecheck` | PASS | لا أخطاء TypeScript |
| Lint | `npm run lint` | PASS | لا أخطاء |
| Build | `npm run build` | PASS | Nest build ناجح |
| Unit tests | `npm test -- --runInBand` | PASS | 30 suites / 188 tests |
| Targeted unit | `npx jest src/modules/inventory/inventory.service.spec.ts --runInBand` | PASS | 1 suite / 32 tests |
| E2E tests | `npm run test:e2e -- --runInBand` | PASS | 3 suites / 59 tests |
| Integration tests | `npm run test:integration -- --runInBand` | SKIPPED LOCALLY | 7 suites / 26 tests؛ لا `GF_INTEGRATION_DATABASE_URL` محلياً |
| PostgreSQL integration | CI required | PENDING | الاختبار الجديد يجب أن يعمل على PostgreSQL 16 في PR |
| Diff check | `git diff --check` | PASS | لا whitespace errors قبل commit |
| Secret scan | repository CI | PENDING | يُنتظر على PR |

## 6. Known limitations and risks

اختبار التكامل الجديد لا يمكن إثباته محلياً لعدم توفر PostgreSQL/ Docker، ولذلك لا تُغلق المهمة نهائياً قبل نجاح CI. لا يعالج هذا الإصلاح بيانات legacy التي قد يكون إجماليها غير مطابق لمجموع ledger؛ يكتشفها reconciliation ويجب تسويتها بقرار تدقيق مستقل قبل بيئة مشتركة.

المنطق الحالي يحتفظ بإجمالي `RawMaterial.currentStock` مع أرصدة ledger المفصلة. هذا يحافظ على التوافق، لكنه يعني أن أي عملية إصلاح legacy أو backfill لاحقة يجب أن تكون مهمة مستقلة مع backup وrollback.

تحذير GitHub الحالي الخاص بإجبار بعض actions على Node.js 24 بدلاً من Node.js 20 ليس فشلاً في هذه المهمة، لكنه يستحق تحديث actions في مهمة صيانة مستقلة.

## 7. Next agent instructions

بعد دمج هذا الفرع والتحقق من CI، المهمة التالية هي `GF-REMAINING-003`: ضمان idempotency لمخرجات مراحل الإنتاج. ابدأ من `docs/PROJECT_STATE.md` و`docs/MASTER_BACKLOG.md` و`docs/API_CONTRACT.md` و`backend/src/modules/production/**` و`backend/test/production-workflow*`.

يجب التحقق من merge commit وCI على `main` أولاً. لا تغيّر schema أو تضف migration في GF-REMAINING-003 بلا قرار موثق وخطة rollback. يجب اختبار replay بنفس المفتاح والمحتوى، رفض المحتوى المختلف بـ409، وreplay المتزامن دون أثر ثانٍ.
