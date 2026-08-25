# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو **مصدر الحقيقة** لحالة المشروع. يحدَّث بعد كل مهمة. لا يبدأ أي نموذج عملًا قبل قراءته.

```text
Project: Garment Factory ERP
Current branch: stabilization/baseline-and-security
Current commit: (التزام GF-0002 — يُحدّث في كل تسليم)
Current release: لا يوجد إصدار معتمد بعد (pre-release)
Last completed phase: المرحلة 1 جزئيًا — GF-0002 منجزة (حماية fail-closed مفعّلة ومختبرة)
Active task: GF-0003 — إصلاح الاختبارات الـ 18 الفاشلة والـ lint
Blocked tasks: لا شيء محظور تقنيًا؛ بقية المهام مشروطة بعبور بوابة G1 (متبقٍ: اختبارات خضراء)
Known failing checks: CI Run #1 على GitHub (2026-08-25، sha 02ec9cb) مثبت: lint ❌ (أخطاء قديمة — GF-0003) + secret-scan ❌ (docker-compose/README/seed — GF-0006)؛ prisma generate/validate ✅ في CI
Database migration state: migration واحدة فقط مطبقة (init 20260823183624)؛ لا توجد بيئة إنتاج
Current API version: 1.0 (غير مقفل — العقد غير مستقر بعد)
Current mobile API base URL: Android emulator http://10.0.2.2:3005 — iOS/Web http://localhost:3005 (مكتوبة داخل الكود، ليست من environment — GF-0010)
Security blockers: P0-05 فقط من الخمس (DTOs) + P1-02..P1-11 — انظر SECURITY_BASELINE.md
Open decisions: ADR-0003 (مصير الأحداث المالية)، ADR-0004 (المنفذ — محسوم عمليًا 3005 عبر env)
Last handoff: docs/handoffs/HANDOFF-002.md
Next exact action: تنفيذ GF-0003 وفق بطاقة المهمة في HANDOFF-002.md
```

---

## 1. طبيعة الحالة الحالية (بعد GF-0002 — تحديث)

المشروع انتقل من **prototype مكشوف بالكامل** إلى **prototype محمي fail-closed**: كل مسارات API تتطلب JWT صالحًا (عدا login والجذر)، الأسرار من البيئة فقط (لا fallback)، والهوية من الجلسة لا من body. المتبقي قبل أي تشغيل حقيقي:

1. **P0-05:** مسارات كتابة بلا DTOs (`@Body() any`) — GF-0004.
2. **docker-compose** ما زال يحمل كلمة مرور منشورة وports مكشوفة — GF-0006.
3. **الاختبارات القديمة حمراء** (18 suite قوالب بلا mocks) — GF-0003.
4. **Flutter لم يوصل بعد**: لا auth interceptor (الخادم سيرفض كل طلباته على المسارات المحمية) ولا secure storage — GF-0010.

### ما تغير في GF-0002 (ملخص)
- `JwtAuthGuard` + `RolesGuard` مسجلان عالميًا (`APP_GUARD`) — كل مسار محمي افتراضيًا.
- `@Public()` فقط على `POST /auth/login` و `GET /`.
- `assertRequiredEnv()` في `main.ts`: فشل إقلاع عند نقص `JWT_SECRET`/`DATABASE_URL` (وأي إنتاج: سر <32 أو CORS `*`).
- `prisma.service.ts`/`seed.ts`: `DATABASE_URL` من البيئة فقط.
- `userId/createdById/creatorId` من `@CurrentUser('id')` في sales/accounting/production.
- إصلاح خلل قديم: `AppController` لم يكن مسجلًا في `AppModule` (كان `/` يرجع 404).
- 31 اختبارًا جديدًا (15 unit + 16 e2e) تثبت 401/403/الهوية-من-الجلسة/fail-closed.

> ملاحظات مفتوحة من القياس الأصلي ما زالت صحيحة: الاختبارات القديمة شكلية (18 suite قوالب بلا PrismaService mock — GF-0003)، ادعاءات README عن الأحداث غير منفذة (ADR-0003)، وFlutter بلا auth interceptor (GF-0010).

## 2. خط الأساس المقاس (Baseline) — 2026-08-24 (وحدّث جزئيًا في GF-0002)

| البند | القيمة |
|---|---|
| البيئة | Node v24.18.0 / npm 11.16.0 / Prisma 7.9.1 / NestJS 11 |
| نقطة البداية | فرع `main` @ commit `2023acf` — شجرة نظيفة بلا تغييرات |
| `npm ci --no-audit --no-fund` | ✅ نجاح |
| `npx prisma generate` | ✅ نجاح (شرط مسبق للبناء) |
| `npx prisma validate` | ✅ نجاح — المخطط صالح |
| `npm run build` | ✅ نجاح (يفشل إذا لم يُسبق بـ `prisma generate`) |
| `npm test -- --runInBand` | ❌ 18 فاشلة قديمة / 4 ناجحة (أصلية 1 + جديدة GF-0002: 3) — الإصلاح GF-0003 |
| `npm run lint` | ❌ 16 خطأ قديمة (معظمها unsafe-any يعالجها GF-0003/GF-0004) — الملفات الجديدة في GF-0002 صفر أخطاء |
| `npm run format:check` | غير معرف كسكربت — يوجد `format` فقط |
| Flutter checks | غير مشغّلة في هذه البيئة (لا Flutter SDK مثبت) — مهمة CI |
| Docker Compose | ⚠️ healthcheck لـ postgres **مكسور** (انظر SECURITY_BASELINE P1-07) |

النتيجة: البناء قابل للتكرار، وحماية GF-0002 مثبتة باختبارات جديدة، لكن **حزمة الاختبارات القديمة ما زالت حمراء** بانتظار GF-0003، وCI secret-scan أحمر بانتظار GF-0006 (docker-compose/README/seed).

### دليل CI الفعلي (Run #1 — GitHub Actions)
- الفرع مدفوع إلى GitHub في 2026-08-25 (بعد GF-0002).
- Backend job: npm ci ✅ → prisma generate ✅ → prisma validate ✅ → **lint ❌** (الأخطاء القديمة الـ 13 — تحقق سجلها: كلها unused/unsafe-any قديمة، لا شيء من ملفات GF-0002).
- Secret Scan job: ❌ كما هو مقصود — يلتقط كلمات المرور المنشورة (docker-compose/README/seed — نطاق GF-0006).
- الخلاصة: CI يعمل ويحمي المستودع؛ يخضرّ تدريجيًا مع GF-0003 ثم GF-0006.

## 3. جرد المكونات الفعلي (مقابل ما يعلنه README)

| ما يعلنه README | الواقع في الكود |
|---|---|
| 12 وحدة | 9 وحدات backend فقط (لا يوجد Dashboard ولا Reports module — طلب `/dashboard/stats` يرجع 404) |
| Event-Driven: سحب مخزون وقيد آلي عند إنشاء أمر تشغيل/فاتورة | `emit` في موضعين فقط (inventory/production) **وصفر `@OnEvent` listeners** |
| Redis للتخزين المؤقت | لا يستخدمه الكود إطلاقًا (حاوية docker فقط) |
| RBAC بالصلاحيات | `RolesGuard` موجود كملف **ولا يُستخدم في أي مكان** |
| 34 model و10 enums | مؤكد من `schema.prisma` |

## 4. الفحوصات المعروفة بفشلها (مع أوامر إعادة الإنتاج — بعد GF-0002)

```bash
# 18 suite فاشلة (قديمة، دون تغيير بعد GF-0002) — السبب: قوالب spec افتراضية بلا PrismaService mock
cd backend && npm test -- --runInBand
# الناجحة الآن: app.controller.spec + roles.guard.spec + jwt-auth.guard.spec + main.spec (جديدة GF-0002)

# 16 خطأ ESLint قديمة (unsafe-any / unused imports) — لا أخطاء في ملفات GF-0002 الجديدة
cd backend && npm run lint

# اختبارات الحماية الجديدة (خضراء) — تثبيت سلوك GF-0002:
cd backend && npx jest --config ./test/jest-e2e.json --runInBand test/auth-guard.e2e-spec.ts

# فحص الإقلاع fail-closed (خضراء — يجب أن تفشل العملية برمز 1):
NODE_ENV=production node dist/src/main.js   # من مجلد بلا .env
```

## 5. قيود البيئة والتشغيل (بعد GF-0002)

- **المنفذ**: `PORT` من البيئة — `.env` المحلي و`.env.example` يوثقان **3005** (ADR-0004 محسوم عمليًا).
- **التشغيل أصبح يتطلب `.env`**: `JWT_SECRET` و`DATABASE_URL` إلزاميان (فشل إقلاع بدونهما — fail-closed). انسخ `backend/.env.example` إلى `backend/.env`.
- **قاعدة البيانات**: كلمة المرور لم تبق إلا في `docker-compose.yml` (GF-0006) — الكود وseed يقرآن من البيئة فقط.
- **`prisma generate` إلزامي قبل البناء** — مُتمَت داخل CI.

## 6. بروتوكول تحديث هذا الملف

أي مهمة تُغلق يجب أن تحدّث: `Current commit`، `Last completed phase`، `Active task`، `Known failing checks`، `Last handoff`، `Next exact action`. التعديل يتم في نفس commit المهمة، لا في commit منفصل.
