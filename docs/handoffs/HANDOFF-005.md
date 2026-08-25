# Handoff 005

## Status
- Branch: `stabilization/baseline-and-security`
- Commit: 119653c
- Phase: 1 — Security & Stabilization (**مكتملة — بوابة G1 معبورة**)
- Task ID: GF-0006
- Date: 2026-08-25

## Completed
- **docker-compose.yml أُعيدت كتابته آمنة**: صفر كلمات مرور ثابتة (كل القيم من `.env` الجذري بصيغة `${VAR:?msg}` — فشل تشغيل فوري عند النقص) · healthcheck مصلح فعليًا (`pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}` — كان بمستخدم غير معرّف) · الربط الخارجي `127.0.0.1` فقط لكل الخدمات · pgAdmin تحت profile اختياري `tools` لا يعمل افتراضيًا (ADR-0005).
- **`.env.example` جديد بجذر المستودع** لمتغيرات docker-compose.
- **README أُعيدت كتابتها صادقة**: صفر بيانات دخول، 9 وحدات (لا 12)، قسم "الحماية المفعّلة" + قسم صريح "ما هو غير مكتمل بعد" (Flutter غير مربوط، لا Dashboard/Reports، أحداث بلا listeners، Redis غير مستخدم)، تعليمات .env fail-closed، كلمة مرور seed من `SEED_ADMIN_PASSWORD` بلا نشر أي قيمة.
- **seed fail-closed**: `SEED_ADMIN_PASSWORD` من البيئة — يفشل برسالة واضحة عند الغياب (مثبت سلوكيًا) (ADR-0006). مثال موثق في `backend/.env.example`.
- **login.dto**: example كلمة المرور أصبح `********` — لا سر منشور في Swagger.
- **CI secret-scan مضبوط**: استثناءات موثقة بتعليق مسبب لـ `backend/.agents/**` و`.claude/**` و`.windsurf/**` (false positives: أمثلة placeholder توثيقية من أدوات توليد مهارات Prisma — ليست أسرارًا ولا كود تشغيلي).
- **CI اكتمل بخطوة E2E جديدة**: `npm run test:e2e` داخل CI (كانت مفقودة — اكتشاف GF-0004) — تعمل بلا قاعدة بيانات بمتغيرات اختبارية واضحة موثقة.
- تحديث: `SECURITY_BASELINE` (إغلاق P0-03 كاملة + P1-02 + P1-06 + P1-07) · `PROJECT_STATE` (**بوابة G1 معبورة**) · `DECISIONS` (ADR-0005 + ADR-0006) · `MASTER_BACKLOG` (GF-0001..0006 كلها منجزة، GF-0005 مدمجة وموثقة).

## Files Changed
- `docker-compose.yml` (إعادة كتابة) · `README.md` (إعادة كتابة) · `.env.example` (جديد بالجذر) · `backend/.env.example` (+SEED_ADMIN_PASSWORD) · `backend/prisma/seed.ts` (fail-closed) · `backend/src/modules/auth/dto/login.dto.ts` (example) · `.github/workflows/ci.yml` (استثناءات + e2e) · docs ×5.
- كلها ضمن Allowed Files في بطاقة GF-0006.

## Database/API Impact
- **Database:** لا تغيير schema. تغيير تشغيلي: تشغيل الحاويات يتطلب `.env` بجذر المستودع، وseed يتطلب `SEED_ADMIN_PASSWORD`.
- **API:** لا تغيير.

## Checks
| Check | Result | Notes |
|---|---|---|
| `git grep -nE "erp_password_2024\|Admin@123"` (خارج docs) | ✅ **صفر نتائج** | معيار القبول 1 |
| محاكاة CI secret-scan (بالاستثناءات) | ✅ **صفر تطابقات** | معيار القبول 4 |
| docker-compose YAML + بنية | ✅ صحيحة (تحقق آلي: profiles/localhost/$$) | لا docker في بيئة القياس — تحقق YAML |
| seed بلا SEED_ADMIN_PASSWORD | ✅ يفشل برسالة واضحة | fail-closed |
| Unit tests | ✅ 22/22 — 89/89 | |
| E2E tests | ✅ 2/2 — 36/36 (بلا DB) | |
| Lint / Build / Prisma validate | ✅ / ✅ / ✅ | |
| **CI على GitHub (الوظيفتان)** | ✅ **أخضر بالكامل — Run #7 @ 119653c** (Backend كله + Secret Scan) | معيار القبول 7 — بعد إصلاح خطأ TS في seed (requireEnv) |

## Known Issues
- docker غير متاح في بيئة القياس — تحقق compose كان YAML/بنية فقط؛ أول تشغيل فعلي للحاويات على جهاز المطور يتحقق من runtime (متوقع سليم: متغيرات ?{} قياسية).
- قيود الربط `127.0.0.1` تعني أن اختبار Flutter على جهاز فعلي يحتاج تعديلًا واعيًا أو tunnel (موثق في ADR-0005).
- Flutter job في CI ما زال معطلًا بقرار موثق (قبل المرحلة 8 / GF-0020).

## Not Done
- المرحلة 2 كاملة (GF-0007: Warehouse/ledger/idempotency — البطاقة التالية).
- P1-03/04/05 (Flutter — GF-0010) وP1-08..12 (rate-limit/pagination/ADR-0003).

## Next Exact Task
```text
TASK_ID: GF-0007
TITLE: Domain Foundation — Warehouse + Stock Ledger + Idempotency + Indexes
PHASE: 2
OBJECTIVE: أول مهمة schema: أساس مخزون قابل للتدقيق — كل تغيير رصيد يمر بحركة ledger
          موثقة داخل transaction، مع مخازن، idempotency keys، وindexes الأداء.

ALLOWED FILES:
- backend/prisma/schema.prisma (نماذج جديدة: Warehouse, StockLedgerEntry, IdempotencyKey + تحسينات)
- backend/prisma/migrations/<new>/ (migration وصفية باسم واضح)
- backend/prisma/seed.ts (تحديث بيانات seed للمخازن)
- backend/src/modules/inventory/** (Inventory Application Service مبدئي: receive/issue/adjust/waste عبر ledger)
- backend/src/modules/inventory/**/specs (اختبارات transaction وidempotency وtزامن)
- docs/DATA_AND_MIGRATIONS.md، docs/DOMAIN_GLOSSARY.md، docs/PROJECT_STATE.md، docs/DECISIONS.md (ADR سياسة الرصيد السالب والتكلفة)، docs/handoffs/HANDOFF-006.md

ACCEPTANCE CRITERIA:
1. Migration جديدة قابلة للتطبيق باسم وصفي + خطة rollback موثقة في DATA_AND_MIGRATIONS.
2. لا تحديث مباشر لـ currentStock خارج Inventory Service — كل مسار يمر بـ ledger entry داخل prisma.$transaction.
3. IdempotencyKey يمنع تكرار نفس العملية (اختبار: نفس المفتاح مرتين → أثر واحد).
4. اختبار فشل منتصف transaction: لا يتغير الرصيد ولا يبقى ledger معلقًا.
5. indexes على الأكواد/التواريخ/الحالات للجداول الجديدة.
6. ADR: سياسة الرصيد السالب (منع/سماح بصلاحية) + سياسة التكلفة (Weighted Average مبدئيًا).
7. كل الفحوصات القائمة (89 unit + 36 e2e + lint + build + CI أخضر) تبقى خضراء.
```

## إصلاح لاحق ضمن المهمة (Run #6 → #7)
- فشل Build في CI بخطأ TS2345 في seed.ts: تضييق `string | undefined` عبر `process.exit` لا يثبت تحت نسخة TS في CI (محليًا أخفاه كاش تزايدي). الحل: دالة `requireEnv(name, hint): string` — حتمية عبر كل إصدارات TS، مع بقاء fail-closed مثبتًا (exit 1 بدون SEED_ADMIN_PASSWORD). التزام 119653c.

## Rollback
- `git revert 119653c` — لا schema ولا بيانات؛ config وdocs فقط.
- استرجاع الحاويات القديمة: revert docker-compose.yml و`.env.example` الجذري.
