# Handoff 001

## Status
- Branch: `stabilization/baseline-and-security`
- Commit: 0446cc5 (docs + CI فقط — لا تغيير سلوك تطبيقي)
- Phase: 0 — Baseline & Governance
- Task ID: GF-0001
- Date: 2026-08-24

## Completed
- قياس خط الأساس الكامل وتوثيقه: build ✅ / prisma validate ✅ / tests ❌ 18-19 فاشلة / lint ❌ 21 مشكلة (أوامر الإعادة في `PROJECT_STATE.md §4`).
- فحص أمني شامل وتسجيل 5 ثغرات P0 و12 P1 و7 P2 في `SECURITY_BASELINE.md` مع مواضعها في الكود.
- جرد الـ 30 endpoint ووثّق عقد الـ API الحالي كاملًا في `API_CONTRACT.md` (كلها مكشوفة).
- توثيق فجوات المخطط الـ 12 وسياسة المهاجرات في `DATA_AND_MIGRATIONS.md`.
- قاموس مجال كامل في `DOMAIN_GLOSSARY.md` (Product/Variant/BOM/Warehouse/Ledger/WorkOrder/Quality/Waste/Payroll/Accounting).
- إنشاء CI أولي `.github/workflows/ci.yml` يشغّل prisma generate→validate→lint→build→test بلا إخفاء فشل + secret scan + job Flutter موثق التعطيل مؤقتًا لغياب SDK (يفشل CI عمدًا إذا لم يُحل — انظر Known Issues).
- `backend/.env.example` بكل المتغيرات المطلوبة (بلا قيم حقيقية) + توسيع `backend/.gitignore`.
- سجل قرارات: ADR-0001 (فرع التثبيت)، ADR-0002 (تجميد schema)، ADR-0003/0004 مسودتان.
- Backlog مرتب P0/P1/P2 بـ 22 مهمة مرقمة GF-0001..GF-0022 مع ملفاتها ومعايير قبولها.

## Files Changed
- `docs/PROJECT_STATE.md` (جديد) — مصدر الحقيقة للحالة.
- `docs/AI_WORKFLOW.md` (جديد) — بروتوكول النماذج.
- `docs/ARCHITECTURE.md` (جديد) — كما-هي + الهدف.
- `docs/DOMAIN_GLOSSARY.md` (جديد)
- `docs/API_CONTRACT.md` (جديد)
- `docs/SECURITY_BASELINE.md` (جديد)
- `docs/DATA_AND_MIGRATIONS.md` (جديد)
- `docs/TESTING_STRATEGY.md` (جديد)
- `docs/RELEASE_GATES.md` (جديد)
- `docs/DECISIONS.md` (جديد)
- `docs/MASTER_BACKLOG.md` (جديد)
- `docs/handoffs/HANDOFF_TEMPLATE.md` (جديد)
- `docs/handoffs/HANDOFF-001.md` (هذا الملف)
- `backend/.env.example` (جديد)
- `backend/.gitignore` (توسيع)
- `.github/workflows/ci.yml` (جديد)
- `README.md` لم يُلمس عمدًا — يُصحح في GF-0006 (قرار موثق).

## Database/API Impact
- **لا شيء.** لا تغيير في schema أو endpoints أو سلوك تشغيلي. توثيق + CI + قوالب env فقط.

## Checks
| Check | Result | Notes |
|---|---|---|
| Build (`npm run build`) | ✅ PASS | يتطلب `prisma generate` أولًا — أُتمتت في CI |
| Backend tests (`npm test --runInBand`) | ❌ 18 فاشل / 1 ناجح | قوالب افتراضية بلا PrismaService mock — الإصلاح GF-0003 |
| Lint (`npm run lint`) | ❌ 16 errors / 5 warnings | موثقة في TESTING_STRATEGY — الإصلاح GF-0003 |
| Prisma validate | ✅ PASS | |
| Flutter analyze/test | ⚠️ غير مشغّلة | لا Flutter SDK في بيئة القياس — مهمة CI (job منفصل) |
| Security scan | ✅ منفذ يدويًا | النتائج هي محتوى SECURITY_BASELINE — 5 P0 مفتوحة |
| git diff review | ✅ | docs/env-template/CI فقط، لا أسرار، لا سلوك |

## Known Issues
- **CI سيكون أحمر حاليًا** بسبب اختبارات/lint الفاشلة أصلًا — هذا مقصود (لا إخفاء فشل). يخضرّ بعد GF-0002/GF-0003.
- job الـ Flutter في CI معطل بتعليق موثق لغياب runner مناسب — يجب حله قبل المرحلة 8 (لا يُترك معطلًا للأبد).
- `PROJECT_STATE.md` يشير لهذا الـ handoff كآخر تسليم.

## Not Done
- كل P0 الخمس (مهمة GF-0002 التالية).
- إصلاح الاختبارات (GF-0003).
- تصحيح README وdocker-compose (GF-0006).

## Next Exact Task
```text
TASK_ID: GF-0002
TITLE: تفعيل المصادقة fail-closed وحماية مسارات API
PHASE: 1
OBJECTIVE: جعل كل مسار API يتطلب JWT صالحًا مع صلاحيات، مع إزالة كل fallback للأسرار،
          وأخذ الهوية من الجلسة لا من body — بلا تغيير عقد الاستجابة الناجح.

ALLOWED FILES:
- backend/src/app.module.ts                      (تسجيل APP_GUARD)
- backend/src/main.ts                            (CORS من env)
- backend/src/modules/auth/jwt-auth.guard.ts     (جديد: guard عالمي + Public decorator)
- backend/src/modules/auth/public.decorator.ts   (جديد)
- backend/src/modules/auth/current-user.decorator.ts (جديد)
- backend/src/modules/auth/jwt.strategy.ts       (إزالة fallback 'secret')
- backend/src/modules/auth/auth.module.ts
- backend/src/modules/auth/roles.guard.ts        (تفعيل + مراجعة)
- backend/src/prisma/prisma.service.ts           (إزالة connection string الثابتة)
- backend/prisma/seed.ts                         (DATABASE_URL من env)
- backend/.env  (محلي فقط، غير منشور)
- الاختبارات المصاحبة + تحديث docs/API_CONTRACT.md وSECURITY_BASELINE.md

ACCEPTANCE CRITERIA:
1. GET /sales/orders بلا token → 401 (وكذا بقية المسارات عدا /auth/login و/).
2. token بدور خاطئ على مسار مقيّد → 403 (اختبار فعلي supertest/jest).
3. غياب JWT_SECRET أو قيمته أقصر من 32 حرفًا في NODE_ENV=production → فشل إقلاع واضح.
4. prisma.service.ts وseed.ts لا يحويان أي connection string بكلمة مرور — DATABASE_URL من env فقط.
5. userId/createdById/creatorId لم تعد تقبل من body (تُستخرج من الجلسة).
6. npm run build + npx prisma validate يمران؛ الاختبارات الجديدة تمر (القديمة تبقى على حال GF-0003).
7. تحديث API_CONTRACT.md وSECURITY_BASELINE.md بإغلاق P0-01..P0-04.
```

## Rollback
- `git revert 0446cc5` — تغيير docs/CI/env-template فقط، لا أثر على أي سلوك أو بيانات.
- حذف الفرع كليًا يعيد المستودع إلى `main @ 2023acf` دون أي فقد.
