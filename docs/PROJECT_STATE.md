# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو **مصدر الحقيقة** لحالة المشروع. يحدَّث بعد كل مهمة. لا يبدأ أي نموذج عملًا قبل قراءته.

```text
Project: Garment Factory ERP
Current branch: stabilization/baseline-and-security
Current commit: 0446cc5
Current release: لا يوجد إصدار معتمد بعد (pre-release)
Last completed phase: Phase 0 — Baseline & Governance (GF-0001)
Active task: GF-0002 — تفعيل المصادقة fail-closed وحماية مسارات API
Blocked tasks: لا شيء محظور تقنيًا؛ كل المهام اللاحقة مشروطة بعبور بوابة المرحلة 1
Known failing checks: انظر القسم 4 أدناه
Database migration state: migration واحدة فقط مطبقة (init 20260823183624)؛ لا توجد بيئة إنتاج
Current API version: 1.0 (غير مقفل — العقد غير مستقر بعد)
Current mobile API base URL: Android emulator http://10.0.2.2:3005 — iOS/Web http://localhost:3005 (مكتوبة داخل الكود، ليست من environment)
Security blockers: 5 ثغرات P0 مفتوحة — انظر SECURITY_BASELINE.md
Open decisions: ADR-0001 (نشر ports)، ADR-0002 (سياسة تغيير schema) قيد الاعتماد
Last handoff: docs/handoffs/HANDOFF-001.md
Next exact action: تنفيذ GF-0002 وفق بطاقة المهمة في HANDOFF-001.md
```

---

## 1. طبيعة الحالة الحالية (تقييم صريح)

المشروع في حالة **prototype وظيفي غير محمي**. الكود يترجم ويبنى بنجاح، لكنه غير صالح لأي تشغيل ببيانات حقيقية للأسباب التالية:

1. **كل مسارات API مكشوفة تمامًا** — لا يوجد `APP_GUARD` ولا `@UseGuards` ولا `@Roles` واحدة في أي controller من الـ 30 endpoint. أي شخص يصل للشبكة يقرأ ويكتب بيانات المصنع كاملة (عملاء، مخزون، رواتب، قيود).
2. **لا يوجد ملف `.env` في المستودع** — عند التشغيل الفعلي بدون `JWT_SECRET` يقبل الخادم أي token موقّع بالسر الافتراضي `'secret'`.
3. **الاختبارات شكلية** — 18 من 19 suite فاشلة أصلًا لأنها قوالب NestJS الافتراضية بلا mock لـ `PrismaService`.
4. **README يعد بما هو غير منفذ** — معمارية الأحداث المعلنة (سحب مخزون آلي + قيد محاسبي آلي) ليس لها أي `@OnEvent` listener واحد في الكود.
5. **تطبيق Flutter لا يستطيع المصادقة أصلًا** — `ApiClient` بلا auth interceptor، والتطبيق يقفل على mock data في التقارير.

## 2. خط الأساس المقاس (Baseline) — 2026-08-24

| البند | القيمة |
|---|---|
| البيئة | Node v24.18.0 / npm 11.16.0 / Prisma 7.9.1 / NestJS 11 |
| نقطة البداية | فرع `main` @ commit `2023acf` — شجرة نظيفة بلا تغييرات |
| `npm ci --no-audit --no-fund` | ✅ نجاح |
| `npx prisma generate` | ✅ نجاح (شرط مسبق للبناء) |
| `npx prisma validate` | ✅ نجاح — المخطط صالح |
| `npm run build` | ✅ نجاح (يفشل إذا لم يُسبق بـ `prisma generate`) |
| `npm test -- --runInBand` | ❌ **18 فاشل / 1 ناجح من 19 suite** |
| `npm run lint` | ❌ **21 مشكلة (16 error / 5 warning)** |
| `npm run format:check` | غير معرف كسكربت — يوجد `format` فقط |
| Flutter checks | غير مشغّلة في هذه البيئة (لا Flutter SDK مثبت) — مهمة CI |
| Docker Compose | ⚠️ healthcheck لـ postgres **مكسور** (انظر SECURITY_BASELINE P1-07) |

النتيجة: البناء قابل للتكرار، لكن **حزمة الاختبارات الحالية حمراء بالكامل عمليًا**، ولا يوجد CI يمنع تراجع الحالة.

## 3. جرد المكونات الفعلي (مقابل ما يعلنه README)

| ما يعلنه README | الواقع في الكود |
|---|---|
| 12 وحدة | 9 وحدات backend فقط (لا يوجد Dashboard ولا Reports module — طلب `/dashboard/stats` يرجع 404) |
| Event-Driven: سحب مخزون وقيد آلي عند إنشاء أمر تشغيل/فاتورة | `emit` في موضعين فقط (inventory/production) **وصفر `@OnEvent` listeners** |
| Redis للتخزين المؤقت | لا يستخدمه الكود إطلاقًا (حاوية docker فقط) |
| RBAC بالصلاحيات | `RolesGuard` موجود كملف **ولا يُستخدم في أي مكان** |
| 34 model و10 enums | مؤكد من `schema.prisma` |

## 4. الفحوصات المعروفة بفشلها (مع أوامر إعادة الإنتاج)

```bash
# 18/19 suite فاشلة — السبب: قوالب spec افتراضية بلا PrismaService mock
cd backend && npm test -- --runInBand
# Suites الفاشلة: accounting/{controller,service}, auth/{controller,service},
# hr/{controller,service}, inventory/{controller,service}, production/{controller,service},
# products/{controller,service}, quality/{controller,service}, sales/{controller,service},
# shipping/{controller,service}
# الناجحة: src/app.controller.spec.ts فقط

# 16 خطأ ESLint + 5 تحذيرات (no-unsafe-assignment على any، unused imports)
cd backend && npm run lint
```

## 5. قيود البيئة والتشغيل

- **المنفذ**: `main.ts` يستخدم `PORT` من البيئة افتراضيًا **3000**، بينما تطبيق Flutter يطلب **3005** — التشغيل الحالي لا يتفق إلا إذا ضُبط `PORT=3005` يدويًا. (تعارض مسجل، الحسم في ADR)
- **قاعدة البيانات**: تتطلب PostgreSQL مطابقًا لـ `docker-compose.yml`، وكلمة المرور مكررة حرفيًا في 3 مواضع (انظر SECURITY_BASELINE P0-03).
- **`prisma generate` إلزامي قبل البناء** — أتمتته داخل CI.

## 6. بروتوكول تحديث هذا الملف

أي مهمة تُغلق يجب أن تحدّث: `Current commit`، `Last completed phase`، `Active task`، `Known failing checks`، `Last handoff`، `Next exact action`. التعديل يتم في نفس commit المهمة، لا في commit منفصل.
