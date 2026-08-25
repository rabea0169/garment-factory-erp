# Handoff 006

## Status
- Branch: `phase2/domain-foundation` (متفرعة من `stabilization/baseline-and-security` @ 3ebf6a7)
- Commit: 9ab9baa (GF-0007 — Domain Foundation — implementation commit)
- Phase: 2 — Domain Foundation (مهمة أولى مكتملة)
- Task ID: GF-0007
- Date: 2026-08-25

## Completed
- **ثلاثة نماذج schema جديدة:** `Warehouse` (`WarehouseType`: خامات/تام/عام، كود فريد) · `StockLedgerEntry` (سجل حركات موحد append-only: `quantityDelta` موقعة، لقطة `balanceAfter` لكل حركة، `unitCost`/`totalValue`، روابط خامة **أو** variant + مخزن + مفتاح idempotency + منشئ من الجلسة) · `IdempotencyKey` (مفتاح فريد + نطاق + بصمة SHA-256 للطلب + الاستجابة المخزنة).
- **Migration وصفية كاملة:** `20260825070834_domain_foundation_warehouse_stock_ledger_idempotency` — جداول + 9 indexes (أكواد/تواريخ/حالات) + قيدا CHECK يدويان: `currentStock >= 0` على raw_materials (ADR-0007 defense-in-depth) وXOR (خامة أو variant لا كلاهما) على الـ ledger.
- **القاعدة المركزية (معيار القبول 2):** لا تحديث لـ `currentStock` خارج InventoryService — وداخلها حصريًا عبر `executeMovement`: UPDATE ذري واحد (`increment`) هو نقطة التسلسل ضد السباقات، ثم فحص السالب، ثم سطر ledger واحد، كل شيء داخل `prisma.$transaction` واحدة. المسار القديم `POST /inventory/raw-materials/:id/add-stock` موجّه داخليًا عبر `receive()` في مخزن الخامات الافتراضي (بلا استثناءات، متوافق مع الواجهة القائمة).
- **Idempotency (معيار القبول 3):** ترويسة `Idempotency-Key` اختيارية على مسارات الحركات الأربعة؛ سجل المفتاح يُنشأ ويُستكمل بالاستجابة داخل نفس transaction الحركة؛ الإرسال المتكرر يعيد `replayed: true` بنفس الاستجابة بلا كتابة جديدة؛ نفس المفتاح بمحتوى مختلف أو نطاق مختلف → 409؛ سباق تزامن (P2002) → استرجاع استجابة العملية الفائزة.
- **مسارات API جديدة:** `GET /inventory/warehouses` · `GET /inventory/ledger` (مرشحات خامة/مخزن/نوع/فترة + حد 200) · `POST /inventory/movements/receive|issue|adjust|waste` — كل الكتابة INVENTORY_MANAGER، الهوية من `@CurrentUser('id')`، DTOs مع class-validator (سبب التسوية/الهدر إلزامي).
- **سياسات معتمدة (معيار القبول 6):** ADR-0007 منع الرصيد السالب بثلاث طبقات · ADR-0008 متوسط مرجح للتكلفة (يعاد احتسابه داخل transaction الاستلام: 150@45.5 + 50@48 → 46.13).
- **seed:** مخزنان (WH-RAW/WH-FG) + الأرصدة الافتتاحية للخامات مبررة بحركات ledger داخل `$transaction` — ثابت المطابقة `currentStock == SUM(quantityDelta)` يتحقق من اليوم الأول.
- **اختبارات (معيارا القبول 3 و4):** 37 اختبار inventory (كانت 7): نفس المفتاح مرتين = أثر واحد (الـ transaction لا تنفذ مرتين) · فشل منتصف transaction = لا استجابة مخزنة وكل الكتابات tx-scoped (mock منفصل للـ tx يثبت عدم وجود أي كتابة خارجها) · P2025 → 404 · منع السالب · متوسط مرجح · تحقق المخازن (غير موجود/غير نشط/نوع خاطئ) · انحدار كامل للقراءات القديمة.
- **أحداث:** STOCK_ADDED/STOCK_DEDUCTED/STOCK_LOW تُطلق بعد نجاح الـ transaction فقط (وفق اتجاه ADR-0003-ج — إشعارات غير مالية).

## Files Changed
- `backend/prisma/schema.prisma` (3 نماذج + علاقات + تعليقات سياسات + index خامات)
- `backend/prisma/migrations/20260825070834_domain_foundation_warehouse_stock_ledger_idempotency/migration.sql` (جديد)
- `backend/prisma/seed.ts` (مخازن + أرصدة ledger-backed)
- `backend/src/modules/inventory/inventory.service.ts` (إعادة كتابة الجوهر: executeMovement + receive/issue/adjust/waste + ledger reads + add-stock legacy adapter)
- `backend/src/modules/inventory/inventory.controller.ts` (مسارات جديدة + Idempotency-Key header + CurrentUser)
- `backend/src/modules/inventory/dto/{receive,issue,adjust,waste}-stock.dto.ts` + `ledger-query.dto.ts` (جديدة) — `add-stock.dto.ts` بلا تغيير كسر (متوافق مع e2e القائمة)
- `backend/src/modules/inventory/inventory.service.spec.ts` + `inventory.controller.spec.ts` (إعادة كتابة/توسعة)
- `docs/DATA_AND_MIGRATIONS.md` (§6 تفصيل الـ migration + خطة rollback + استعلام المطابقة) · `docs/DOMAIN_GLOSSARY.md` · `docs/PROJECT_STATE.md` · `docs/DECISIONS.md` (ADR-0007/0008) · هذا الملف
- كلها ضمن Allowed Files في بطاقة GF-0007.

## Database/API Impact
- **Database:** migration جديدة (جداول + indexes + CHECKs) — لا تعديل على صفوف قائمة؛ التطبيق المحلي: `docker compose up -d db` ثم `npx prisma migrate deploy` ثم `npm run seed`. التفصيل وخطة الـ rollback في `DATA_AND_MIGRATIONS.md §6`.
- **API إضافات:** `GET /inventory/warehouses` · `GET /inventory/ledger?rawMaterialId&warehouseId&type&from&to` · `POST /inventory/movements/{receive,issue,adjust,waste}` (ترويسة `Idempotency-Key` اختيارية).
- **API توافق:** `add-stock` كما هو شكلًا (نفس DTO) لكنه الآن يمر عبر الـ ledger ويكتب `StockLedgerEntry` بدل `RawMaterialTransaction` (توقف الكتابة للنموذج القديم — موثق في schema/glossary).

## Checks
| Check | Result | Notes |
|---|---|---|
| Prisma validate | ✅ | schema صالحة بعد إضافة النماذج الثلاثة |
| Lint (npm run lint) | ✅ **صفر أخطاء وصفر تحذيرات** | |
| Build (nest build) | ✅ | |
| tsc --noEmit نظيف بلا كاش | ✅ لملفات GF-0007 | خطأان TS **تاريخيان** في ملفات لم تُلمس (quality spec + method-metadata) موجودان على HEAD قبل التغيير — درس GF-0006 مطبق بالتحقق النظيف |
| Unit tests | ✅ **116/116** (كانت 89 — +27 صافي في inventory) | |
| E2E tests | ✅ **36/36** (بلا DB) | مسارات add-stock القديمة متوافقة: 400/401/403 كما هي |
| CI على GitHub | ⏳ **لم يُشغل بعد** — الفرع الجديد لم يُدفع (لا صلاحيات دفع في بيئة التنفيذ؛ توصية التوكن السابق إبطاله) | أمر الدفع أدناه؛ نفس بوابات CI السابقة ستغطي كل شيء |
| docker/migrate فعلي | ⏳ غير متاح في بيئة القياس (لا docker) — migration مولدة بـ `prisma migrate diff` من schema-to-schema (دقيقة بالبناء) والتحقق YAML/بنية | أول `migrate deploy` على جهاز المطور يثبت التطبيق الفعلي |

## Known Issues
- **الفرع لم يُدفع لـ GitHub**: بيئة التنفيذ بلا صلاحيات دفع (التوكن السابق أُلغي توصيةً أمنية). أمر الدفع: `cd backend/.. && git push -u origin phase2/domain-foundation` (أو عبر PAT جديد لمرة واحدة).
- **docker غير متاح في بيئة القياس** — تطبيق الـ migration الفعلي يحدث أول مرة على جهاز المطور (متوقع سليم: SQL مولد من Prisma نفسه + قيدان CHECK قياسيان).
- **MASTER_BACKLOG لم يُحدَّث** (علامة ✅ لصف GF-0007) — الملف خارج Allowed Files لهذه البطاقة؛ أول إجراء في المهمة التالية.
- **API_CONTRACT.md لم يُحدَّث بالم المسارات الجديدة** — خارج Allowed Files؛ يُحدَّث مع GF-0008 أو أول مهمة تلمس العقد.
- خطأان TS تاريخيان (quality.service.spec + test/helpers/method-metadata) يظهران فقط مع `tsc --noEmit` الخام (باب CI `nest build` يستثني specs فلا يراهما) — موجودان قبل GF-0007، يُصلحان عند لمس ملفاتهما.
- مخزون المنتج التام (`FinishedGood.quantity`) لم يُدمج بعد في الـ ledger — بنيوية الجاهزية موجودة (عمود `productVariantId` في الـ ledger + قيد XOR) والدمج في GF-0008/0009.

## Not Done
- GF-0008: BOM versions + ربط WorkOrder بالـ variant/SKU.
- GF-0009: استكمال Inventory Service (reserve/transfer/return/count) وتحويلات بين المخازن.
- دمج حركات التام في ledger · pagination عام (GF-0012) · Flutter (GF-0010).

## Next Exact Task
```text
TASK_ID: GF-0008
TITLE: BOM versions + ربط WorkOrder بالـ variant/SKU
PHASE: 2
OBJECTIVE: أمر التشغيل يستهدف SKU محددًا مع إصدار BOM مجمد لحظة الإنشاء،
          واكتمال الإنتاج يمر عبر ledger (أول استخدام فعلي لعمود
          productVariantId في stock_ledger_entries).

ALLOWED FILES:
- backend/prisma/schema.prisma (BomVersion/BomLine أو تحسين مكافئ + WorkOrder.productVariantId)
- backend/prisma/migrations/<new>/ (migration وصفية + rollback في DATA_AND_MIGRATIONS)
- backend/prisma/seed.ts (BOM بإصدار + أمر تشغيل يستهدف variant)
- backend/src/modules/production/** (الإنشاء/التحديث/الاكتمال عبر InventoryService.issue/receive)
- backend/src/modules/inventory/** (لا كسر للعقد القائم — احتيالات الاكتمال إن لزم)
- docs/DATA_AND_MIGRATIONS.md، docs/DOMAIN_GLOSSARY.md، docs/PROJECT_STATE.md، docs/DECISIONS.md، docs/MASTER_BACKLOG.md (علامة GF-0007 ✅)، docs/handoffs/HANDOFF-007.md

ACCEPTANCE CRITERIA:
1. Migration وصفية قابلة للتطبيق + خطة rollback موثقة (نمط §6 في DATA_AND_MIGRATIONS).
2. WorkOrder يُنشأ لـ productVariantId محدد (SKU) — لا "أول variant" — مع رفض قديم للنموذج القائم بوثيقة انتقال.
3. BOM يُثبَّت بإصدار لحظة إنشاء أمر التشغيل (snapshot) — تغييرات الوصفة لاحقًا لا تمس الأوامر القائمة.
4. اكتمال أمر التشغيل: صرف الخامات وفق إصدار BOM عبر InventoryService.issue داخل transaction واحدة، واستلام التام عبر ledger (productVariantId) — لا تحديث مباشر لأي رصيد.
5. اختبارات: تجميد الإصدار · صرف وفق BOM · فشل منتصف transaction لا يترك أمرًا مكتملًا جزئيًا · انحدار كامل (116 unit + 36 e2e تبقى خضراء + lint + build).
6. تحديث MASTER_BACKLOG (✅ GF-0007 + حالة GF-0008) وAPI_CONTRACT إن اتسع النطاق.
```

## Rollback
- الكود: `git revert <التزام GF-0007>` على فرع `phase2/domain-foundation`.
- قاعدة البيانات: SQL العكسي الموثق في `DATA_AND_MIGRATIONS.md §6` (إسقاط الجداول الثلاثة والنوعين والقيد والـ index المضاف) — أو محليًا `docker-compose down -v` ثم `migrate deploy` على الحالة المرجعة.
- تحذير: إسقاط الـ ledger يفقد تاريخ الحركات — قرار موثق لا يُنفذ على بيانات فعلية دون تصدير.
