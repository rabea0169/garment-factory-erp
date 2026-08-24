# SECURITY_BASELINE — Garment Factory ERP

> سجل الثغرات المعروفة مرتبة بالخطورة. يُحدَّث مع كل مهمة. أي P0 مفتوح يعني أن النظام **غير صالح للتشغيل ببيانات حقيقية**.

**تاريخ القياس:** 2026-08-24 · **نطاق الفحص:** فرع `main` @ `2023acf` + فرع `stabilization/baseline-and-security` (توثيق فقط)

---

## P0 — حرجة: تمنع أي تشغيل ببيانات حقيقية

### P0-01: جميع مسارات API بلا مصادقة إطلاقًا
- **الأثر:** قراءة/كتابة كاملة لبيانات المصنع (عملاء، مخزون، رواتب، قيود محاسبية، عمال) لأي فرد على الشبكة.
- **الجذر:** `backend/src/app.module.ts` لا يسجل `APP_GUARD`، ولا يوجد `@UseGuards(JwtAuthGuard)` على أي controller من الـ 30 endpoint. `RolesGuard` مكتوب في `backend/src/modules/auth/roles.guard.ts` ولا يُستخدم.
- **الإصلاح (GF-0002):** `JwtAuthGuard` عالمي عبر `APP_GUARD` + `@Public()` على `/auth/login` فقط + تفعيل `RolesGuard` مع `@Roles()` لكل مسار حساس.

### P0-02: سر JWT له fallback ثابت `'secret'`
- **الجذر:** `backend/src/modules/auth/jwt.strategy.ts:16` — `secretOrKey: configService.get('JWT_SECRET') || 'secret'`.
- **الأثر:** بدون `JWT_SECRET` في البيئة، يمكن تزوير أي token والمرور كأي مستخدم (بمجرد GF-0002 يعمل هذا كثغرة صلاحيات كاملة).
- **الإصلاح:** رفض الإقلاع (fail-closed) عند غياب `JWT_SECRET` أو قصره (32+ حرفًا) في الإنتاج. لا fallback مطلقًا.

### P0-03: بيانات اعتماد قاعدة البيانات مكررة وثابتة في الكود
- **المواضع:**
  - `backend/src/prisma/prisma.service.ts:16` — connection string كاملة بكلمة مرور `erp_password_2024` كـ fallback.
  - `backend/prisma/seed.ts:6` — نفس الـ connection string مكتوبة حرفيًا.
  - `docker-compose.yml:10` — `POSTGRES_PASSWORD: erp_password_2024`.
- **الإصلاح:** `DATABASE_URL` من البيئة فقط، رفض الإقلاع عند غيابها؛ seed يقرأ من `.env`؛ docker-compose يستخدم `${POSTGRES_PASSWORD}` من `.env` خارج Git.

### P0-04: هوية المنشئ تُقبل من جسم الطلب (Client-side identity)
- **المواضع:**
  - `backend/src/modules/sales/sales.service.ts:52` — `userId` من body.
  - `backend/src/modules/accounting/accounting.service.ts:41` — `createdById` من body.
  - `backend/src/modules/production/production.service.ts:31` — `creatorId` من dto.
- **الأثر:** تزوير هوية منشئ الفواتير وأوامر الصرف وأوامر التشغيل — يدمر audit trail بالكامل.
- **الإصلاح:** `CurrentUser` decorator يستخرج الهوية من الجلسة، والخدمات تتجاهل أي حقل هوية قادم من العميل.

### P0-05: نقاط نهاية مالية بلا DTO أو تحقق (`@Body() any`)
- **المواضع:** `backend/src/modules/sales/sales.controller.ts:30` (`createOrder`) وعدة مواضع أخرى تستقبل objects خام.
- **الأثر:** الـ ValidationPipe العالمي لا يحمي ما لا يملك DTO له؛ إجماليات الفواتير تُحسب من مدخلات عميل دون إعادة تحقق.
- **الإصلاح:** DTO مع `class-validator` لكل مسار كتابة + إعادة حساب الخادم للإجماليات.

## P1 — عالية: يجب إغلاقها قبل أي pilot

### P1-01: CORS مفتوح بالكامل مع credentials
- `backend/src/main.ts:22-26` — `origin: '*'` مع `credentials: true`. الإصلاح: قائمة origins من environment.

### P1-02: بيانات دخول admin منشورة في README وseed
- `README.md` (admin@factory.com / Admin@123) + `backend/prisma/seed.ts:14`. الإصلاح: إزالة من README، توليد كلمة مرور عشوائية عند أول إقلاع أو فرض تغييرها.

### P1-03: token الجلسة في SharedPreferences وليس secure storage
- `mobile_app/lib/features/auth/presentation/cubit/auth_cubit.dart:27-54`. الإصلاح: `flutter_secure_storage`.

### P1-04: ApiClient بلا auth interceptor ولا معالجة 401
- `mobile_app/lib/core/network/api_client.dart:33` — "Add JWT token here later". عنوان الـ base URL مكتوب داخل الكود لا من environment.

### P1-05: mock data صامتة في مسار إنتاجي
- `mobile_app/lib/features/reports/presentation/cubit/reports_cubit.dart:14-26` — فشل طلب `/dashboard/stats` (endpoint غير موجود أصلًا) يعرض بيانات وهمية كمичные. يخفي الفشل عن المستخدم.

### P1-06: Redis وpgAdmin منشوران على الشبكة بكلمات مرور ضعيفة
- `docker-compose.yml` — pgAdmin (admin@factory.com/admin123) على 5050، Redis مكشوف على 6379 بلا كلمة مرور. الإصلاح: ربط داخلية فقط `expose` بدل `ports`، أو شبكة داخلية.

### P1-07: healthcheck لـ Postgres مكسور
- `docker-compose.yml:16` — `pg_isready -U erp_user` لكن `POSTGRES_USER` غير معرّف (المستخدم الفعلي `postgres`)، فالـ healthcheck يفشل دائمًا وقد يعلّق `depends_on` مستقبلًا.

### P1-08: لا rate limiting ولا helmet ولا correlation IDs
- لا توجد أي طبقات حماية transport في `main.ts`.

### P1-09: صلاحيات بلا مصفوفة معتمدة
- 8 أدوار في enum `UserRole` دون أي mapping موثق endpoint→role. تُبنى المصفوفة في GF-0002.

### P1-10: لا pagination في أي قائمة
- كل `GET` للقوائم يعيد الجدول كاملًا (عملاء، مخازن، أوامر…) — خطر أداء وتسريب بيانات جملةً.

### P1-11: أحداث بلا listeners (ادعاء README)
- `emit` موجود في inventory/production فقط، وصفر `@OnEvent` — الادعاءات المحاسبية التلقائية في README غير منفذة.

### P1-12: تعارض المنفذ backend/mobile
- backend افتراضي 3000 (`main.ts:39`)، mobile يطلب 3005 (`api_client.dart:14-16`). يُحسم بـ env موحدة.

## P2 — متوسطة: قبل الإطلاق المؤسسي

- P2-01: لا password policy ولا session expiry قصير (الافتراضي 7 أيام في `auth.module.ts:16`).
- P2-02: لا audit logging للعمليات الحساسة (جدول `ActivityLog` موجود وغير مستخدم).
- P2-03: `verboseMemoryLeak: true` مفعل في `app.module.ts:26` — لا يليق بالإنتاج.
- P2-04: لا تقييم اعتماديات (`npm audit`) ولا secret scanning في CI.
- P2-05: بيانات حساسة محتملة في رسائل الأخطاء (تفاصيل Prisma تصل للعميل كما هي).
- P2-06: Swagger مكشوف للجمهور بلا حماية (`/api/docs`).
- P2-07: أسرار خدمة pgAdmin مكتوبة نصًا في compose.

---

## مصفوفة الحالة

| ID | الخطورة | الملف الأساسي | الحالة | المهمة المخططة |
|---|---|---|---|---|
| P0-01 | حرجة | app.module.ts + كل الـ controllers | مفتوحة | GF-0002 |
| P0-02 | حرجة | jwt.strategy.ts:16 | مفتوحة | GF-0002 |
| P0-03 | حرجة | prisma.service.ts / seed.ts / docker-compose.yml | مفتوحة | GF-0002 |
| P0-04 | حرجة | sales/accounting/production services | مفتوحة | GF-0002 |
| P0-05 | حرجة | sales.controller.ts وغيرها | مفتوحة | GF-0003+ |
| P1-01..12 | عالية | متعددة | مفتوحة | GF-0002..GF-0006 |
| P2-01..07 | متوسطة | متعددة | مفتوحة | المراحل 7-9 |

**قاعدة الحوكمة:** لا تُغلق أي ثغرة في هذا الملف دون إشارة إلى commit الإغلاق واختبار يثبت السلوك (401/403/إقلاع فاشل…).
