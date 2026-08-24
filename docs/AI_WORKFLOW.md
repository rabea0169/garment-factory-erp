# AI_WORKFLOW — بروتوكول عمل النماذج على هذا المستودع

> إلزامي لأي نموذج ذكاء اصطناعي أو مطور قبل تعديل أي سطر. المرجع الأعلى: `الخطة المرجعية الرئيسية` ثم هذا الملف ثم `PROJECT_STATE.md`.

## دورة حياة أي مهمة

```text
A. Inspect → B. Plan → C. Implement (أصغر تغيير آمن) → D. Tests → E. Checks → F. Review diff → G. Update docs → H. Handoff
```

**A. Inspect:** `pwd` + `git status` + `git log -1` + قراءة `PROJECT_STATE.md` وآخر handoff + فحص ملفات المهمة وusages. اذكر ما وجدته وما لم تجده. سجل أي تعارض README↔كود في `DECISIONS.md`.

**B. Plan:** اكتب قبل الكتابة:
```text
Files to change / Files not to change / Database impact / API impact /
Flutter impact / Security impact / Rollback plan / Tests to add
```

**C. Implement:** أصغر تغيير يحقق الهدف. لا refactor جانبي. لا كسر naming قائم. لا `any` جديد.

**D. Tests:** اختبار لكل معيار قبول. للمسارات الحساسة: 401 / 403 / 2xx / 400 / token منتهي / سلوك idempotent.

**E. Checks:** (حسب نطاق التغيير)
```bash
cd backend && npm run lint && npx prisma validate && npm run build && npm test -- --runInBand
# Flutter عند تعديل mobile_app: flutter analyze && flutter test
```

**F. Review diff:** تأكد من غياب: أسرار، debug prints، mock fallback، refactor غير ذي صلة، ملفات generated.

**G. Update docs:** `PROJECT_STATE.md` دائمًا + الملف ذو الصلة (`API_CONTRACT` / `DATA_AND_MIGRATIONS` / `SECURITY_BASELINE` / `TESTING_STRATEGY`). قرار معماري = ADR في `DECISIONS.md`.

**H. Handoff:** بطاقة جديدة في `docs/handoffs/` وفق `HANDOFF_TEMPLATE.md` تحدد المهمة الدقيقة التالية.

## قواعد غير قابلة للتفاوض

1. **لا ميزة جديدة قبل إغلاق P0 مفتوحة** إن كانت في نطاق المهمة الحالية أو تعتمد عليها.
2. **لا secret في Git** — لا fallback لسر JWT، ولا connection string بكلمة مرور في الكود.
3. **لا تعديل schema بلا migration** ولا `db push` على staging/production.
4. **لا حذف سجل تشغيلي/مالي** — التصحيح بحركة عكسية.
5. **لا إخفاء فشل** — لا `|| true`، لا تعطيل test suite، لا mock صامت في مسار إنتاجي.
6. **userId من الجلسة** لا من body.
7. **API contract لا يُكسر** دون تحديث Flutter + docs + tests معًا.
8. ملفات خارج `Allowed Files` لا تُلمس إلا لسبب يُذكر **قبل** التعديل.

## سلسلة المهام الحالية

```text
GF-0001 (تم)  →  GF-0002: fail-closed auth + حماية المسارات  →  GF-0003: إصلاح الاختبارات والـ CI  →  ...
```

التسلسل الكامل في `MASTER_BACKLOG.md`. لا تقفز مرحلة قبل عبور بوابتها في `RELEASE_GATES.md`.

## التعارضات المسجلة README ↔ كود (مؤخراة من Baseline)

| # | ادعاء README | الواقع |
|---|---|---|
| 1 | Event-driven: قيود آلية وسحب مخزون تلقائي | صفر `@OnEvent` listeners |
| 2 | 12 وحدة | 9 وحدات backend (لا Dashboard/Reports) |
| 3 | المنفذ 3000 | Flutter يطلب 3005، وbackend افتراضي 3000 |
| 4 | RBAC فعال | RolesGuard موجود وغير مستخدم إطلاقًا |
| 5 | Redis caching | غير مستخدم في الكود |
