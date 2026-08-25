# RELEASE_GATES — بوابات العبور بين المراحل

> لا يبدأ عمل في مرحلة تالية قبل تحقق بوابة المرحلة الحالية. التحقق مسؤولية المهمة التي تغلق المرحلة ويُوثق في الـ handoff.

## G0 → G1 (Baseline إلى Security & Stabilization)
- [x] خط أساس مقاس وموثق (build/test/lint) في `PROJECT_STATE.md`
- [x] كل P0/P1 معروفة ومسجلة في `SECURITY_BASELINE.md`
- [x] CI يشغّل الفحوصات ولا يخفي الفشل
- [x] لا سر حقيقي جديد في المستودع (`.env.example` بلا قيم حقيقية)
- [ ] **بوابة G1 (هدف GF-0002):** طلب بلا token إلى أي endpoint محمي → 401 · دور خاطئ → 403 · غياب JWT_SECRET في production → فشل إقلاع · build+tests تمر

## G1 → G2 (إلى Domain Foundation)
- [ ] كل مسارات API محمية ومصفوفة الأدوار معتمدة ومختبرة (401/403)
- [ ] لا fallback لأي سر، CORS من البيئة
- [ ] الاختبارات خضراء (18 الفاشلة أُصلحت أو استُبدلت)
- [ ] لا mock data في أي مسار تشغيلي

## G2 → G3 (إلى Catalog & Inventory)
- [ ] قاموس المجال معتمدًا من مالك المنتج
- [ ] schema/migrations مستقرة: Warehouse، ledger، BOM versions، idempotency، indexes
- [ ] سياسة التكلفة موثقة ADR + سياسة الرصيد السالب

## G3 → G4 (إلى Production Core)
- [ ] دورة كاملة: SKU→BOM→استلام→أمر تشغيل→صرف→إنتاج→منتج تام بأرصدة متسقة قابلة للتدقيق

## G4 → G5 (إلى Quality & Workforce)
- [ ] فحص يجبر checked=passed+rejected، هالك مربوط بمرجع وتكلفة
- [ ] راتب يحسبه الخادم من قواعد معتمدة

## G5 → G6 (إلى Commercial Operations)
- [ ] استلام الشراء منفصل عن الأمر؛ البيع يتحقق من المتاح قبل الاعتماد

## G6 → G7 (إلى Accounting & Reports)
- [ ] كل عملية مالية تولد قيدًا متوازنًا مرتبطًا بمصدره؛ KPIs حقيقية بلا mock

## G7 → G8 (إلى Flutter UX)
- [ ] شاشات بحالات كاملة (loading/empty/error/unauthorized/offline) + secure storage + navigation guards

## G8 → G9 (إلى QA)
- [ ] unit/API/E2E/Flutter/security/performance خضراء، ولا blocker مفتوح

## G9 → G10 (إلى Pilot)
- [ ] backup/restore مجربان، UAT على 16 سيناريو القبول، تدريب المستخدمين

## G10 → G11 (إلى Production Launch)
- [ ] أسبوعا pilot دون فروقات حرجة غير مفسرة + توقيع Go/No-Go من مالك المؤسسة

## Definition of Done لأي مهمة (Micro-gate)
```text
[ ] الكود مُراجَع (git diff مفهوم)
[ ] الاختبارات المناسبة موجودة وتنجح
[ ] PROJECT_STATE.md وملفات docs ذات الصلة محدثة
[ ] لا أسرار/ملفات generated/debug prints في الـ diff
[ ] Handoff مكتوب باسم المهمة الدقيقة التالية
```
