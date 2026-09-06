# SECURITY_BASELINE — Garment Factory ERP

> سجل الثغرات المعروفة مرتبة بالخطورة. يُحدَّث مع كل مهمة. أي P0 مفتوح يعني أن النظام **غير صالح للتشغيل ببيانات حقيقية**.

**تاريخ القياس:** 2026-08-24 · **آخر تحديث:** GF-IMP-W3 / CC-7 (2026-09-06) — تخزين حدود المعدل: الذاكرة للنشر أحادي النسخة، وREDIS_URL يفعّل التخزين الدائم فوق Redis

---

## P3 — تقييم مخاطر موثق (GF-IMP-W2 / INF-1): تبعيات mysql2 عبر Prisma

**الحالة الحالية (قياس 2026-09-06):** `npm audit --omit=dev` يرصد ثغرتين (1 moderate + 1 high) في سلسلة `mysql2 ≤ 3.23.0` (GHSA-3f6p-5ww8-9rcr وGHSA-rgwj-5xj2-c3m3) تصل عبر `prisma ≥ 6.20.0-dev.1`:

- **التعرض التشغيلي الفعلي: معدوم تقريبًا.** المحول الفعلي في هذا المشروع هو `@prisma/adapter-pg` (PostgreSQL) — سلسلة mysql2 محمّلة ضمن تبعيات محرك Prisma ولا تُستخدم في أي مسار اتصال: لا connection string واحد يشير إلى MySQL في الكود أو البيئة، وCI يرفع أي عودة لذلك عبر فحص DATABASE_URL.
- **لماذا لا نُصلح الآن:** الإصلاح الوحيد المتاح من npm يفرض خفض `prisma` إلى `6.19.3` — خفض كاسر (breaking) يعيد انحرافات توليد العميل التي أصلحتها الموجة 7 ويتراجع عن ميزات يعتمد عليها الكود الحالي (Decimal في القيود من PRD-5 مثلًا).
- **خطة الإغلاق:** تتبع إصدارات Prisma وترقية فورية عند رفع mysql2 فوق 3.23.0 (متوقع في إصدار قادم)؛ عند صدوره تُقاس البوابات كاملة قبل الدمج. يُعاد القياس مع كل موجة ويُحدَّث هذا القسم بتاريخ قياس جديد.
- **الحكم:** ثغرة ورقية في سياق هذا النشر (paper vulnerability) — مقيمة وموثقة الخطر هنا بدل تجاهلها في تقارير الحوكمة.

---

## GF-IMP-W3 / CC-7: تخزين حدود المعدل (Rate-Limit Storage) — موثّق

**الحالة الحالية:** الحدود تعمل داخل ذاكرة كل نسخة (ThrottlerStorageService الافتراضي). هذا **كافٍ ومقصود** للنشر الحالي على Railway (نسخة واحدة): التصفير مع كل نشر تأثيره محدود، والحدود تحمي داخل عمر العملية.

- **التمكين الموزع جاهز بلا تغيير كود:** ضبط `REDIS_URL` في بيئة النشر يفعّل `RedisThrottlerStorage` (backend/src/common/redis-throttler.storage.ts) فوق ioredis — عدّاد INCR/PEXPIRE ذري بسكربت Lua واحد فلا سباق بين النسخ، والحجب بمفتاح منفصل بمدته. الإخفاق لين: سقوط Redis يُحوِّل العدّ مؤقتًا إلى الذاكرة الداخلية (مع تحذير) فلا تُسقط الخدمة ولا حدودها.
- **متطلب التوسع الأفقي:** أي نشر بأكثر من نسخة **يتطلب من المالك توفير خدمة Redis** (مثل Redis Cloud / Railway Redis plugin) وضبط `REDIS_URL` — بدونها تعمل حدود كل نسخة مستقلة (الحجم الفعلي للحماية = الحد × عدد النسخ).
- **الإثبات:** 7 اختبارات وحدة في redis-throttler.storage.spec.ts (توقيع increment v6، ذراعية EVAL، الاحتياط اللين، قاطع الدائرة، إغلاق الاتصال).
- **مرتبط:** P1-08/P2-08 — الوضع الافتراضي موثّق هنا بدل تركه مفترضًا.

## GF-IMP-W3 / INF-6: وصل OriginCheckGuard عالميًا

كان الحارس (SEC-F07 — دفاع CSRF بالعمق لطلبات التعديل) كودًا مكتملًا ومختبرًا **وغير موصول** — انطباع حماية لا يقدمها النظام. صار الآن APP_GUARD رابعًا في app.module.ts (بعد throttler ← auth ← roles). دلالته: POST/PUT/PATCH/DELETE من متصفح بأصل خارج `CORS_ORIGINS` → 403؛ الطلبات **بلا Origin** (تطبيق الجوال Dio، curl، خادم-خادم) تمر عمدًا — فالحارس دفاع ضد المتصفحات العابرة لا ضد العملاء الأصليين. 11 اختبار وحدة + e2e auth-guard خضراء بعد الوصل.

---

## P0 — حرجة: تمنع أي تشغيل ببيانات حقيقية

### P0-01: جميع مسارات API بلا مصادقة إطلاقًا — ✅ **مغلقة في GF-0002**
- **الإصلاح المنفذ:** `JwtAuthGuard` عالمي عبر `APP_GUARD` في `app.module.ts` + `@Public()` على `/auth/login` و `/` فقط + تفعيل `RolesGuard` مع `@Roles()` على كل مسار حساس (المصفوفة في `API_CONTRACT.md`).
- **الإثبات:** `backend/test/auth-guard.e2e-spec.ts` — 16 اختبارًا: 7 سيناريوهات 401 (بلا توكن/توكن فاسد/مستخدم موقوف) + 3 سيناريوهات 403 + نجاح الدور الصحيح + تجاوز SUPER_ADMIN.

### P0-02: سر JWT له fallback ثابت `'secret'` — ✅ **مغلقة في GF-0002**
- **الإصلاح المنفذ:** أُزيل الـ fallback من `jwt.strategy.ts` (رمي خطأ واضح عند الغياب) + `assertRequiredEnv()` في `main.ts`: فشل إقلاع exit 1 عند غياب `JWT_SECRET`/`DATABASE_URL` في أي بيئة، وعند سر <32 حرفًا أو CORS مفتوح في الإنتاج.
- **الإثبات:** اختبار سلوكي فعلي — `NODE_ENV=production node dist/src/main.js` بلا env → exit 1 برسائل عربية واضحة؛ سر بطول 5 → رفض "أقصر من 32". + 6 اختبارات unit في `src/main.spec.ts`.

### P0-03: بيانات اعتماد قاعدة البيانات مكررة وثابتة في الكود — ✅ **مغلقة بالكامل في GF-0006**
- ✅ `prisma.service.ts` + `prisma/seed.ts` (GF-0002): `DATABASE_URL` من البيئة فقط.
- ✅ `docker-compose.yml` (GF-0006): صفر كلمات مرور ثابتة — كل القيم من `.env` بجذر المستودع بصيغة `${VAR:?msg}` (فشل تشغيل فوري عند النقص).
- **الإثبات:** `git grep -nE "erp_password_2024|Admin@123" -- ':!docs/*' ':!.github/*'` → صفر نتائج + CI secret-scan يمر.

### P0-04: هوية المنشئ تُقبل من جسم الطلب — ✅ **مغلقة في GF-0002**
- **الإصلاح المنفذ:** `@CurrentUser('id')` decorator يستخرج الهوية من الجلسة؛ `sales.service.createSalesOrder(body, userId)` و`accounting.service.createVoucher(body, createdById)` و`production.service.createWorkOrder(dto, creatorId)` تستقبل الهوية كمعامل من الـ controller وتتجاهل أي قيمة واردة من body.
- **الإثبات:** اختبار سلوكي في e2e: إرسال `createdById: 'HACKED-USER-ID'` في body لإنشاء سند → المحفوظ فعليًا هو id المستخرج من التوكن.

### P0-05: نقاط نهاية مالية بلا DTO أو تحقق (`@Body() any`) — ✅ **مغلقة في GF-0004**
- **الإصلاح المنفذ:** 13 DTO مع class-validator لكل مسار كتابة (products/inventory/production×2/quality/hr×2/sales×2/shipping/accounting×2): forbidNonWhitelisted يرفض الحقول غير المعروفة بـ 400 (بما فيها حقول الهوية المزورة — تعزيز إضافي لـ P0-04)، enums محققة، كميات/أسعار @IsPositive، تواريخ ISO محققة مع تحويل آمن، UUIDs محققة في الحقول ومعاملي مسار الكتابة (ParseUUIDPipe)، بنود أمر البيع متحققة nested مع ArrayMinSize(1).
- **الإثبات:** 19 اختبار 400 سلوكيًا في `test/auth-guard.e2e-spec.ts` (describe "DTO validation — GF-0004") + إبقاء كل الاختبارات السابقة خضراء (89 unit + 36 e2e).
- **ملاحظة:** قاعدة المجال `checked = passed + rejected` مؤجلة عمدًا لـ GF-0014 (قاعدة أعمال وليست تحقق مدخلات).

## P1 — عالية: يجب إغلاقها قبل أي pilot

### P1-01: CORS مفتوح بالكامل مع credentials — ✅ **مغلقة في GF-0002**
- `CORS_ORIGINS` من البيئة (قائمة مفصولة بفواصل)؛ في الإنتاج: غيابها أو `*` → فشل إقلاع. في التطوير فقط تبقى `*` عند غياب القيمة.

### P1-02: بيانات دخول admin منشورة في README وseed — ✅ **مغلقة في GF-0006**
- README أُعيدت كتابته بالكامل: صفر بيانات دخول، وحالة صادقة (9 وحدات، المفعّل وغير المفعّل).
- seed يقرأ `SEED_ADMIN_PASSWORD` من البيئة ويفشل بدونها (fail-closed).
- login.dto example لم يعد يحمل كلمة المرور المنشورة.

### P1-03: token الجلسة في SharedPreferences — ❌ مفتوحة → GF-0010
### P1-04: ApiClient بلا auth interceptor ولا معالجة 401 — ❌ مفتوحة → GF-0010
- الخادم محمي الآن؛ التطبيق يحتاج إرفاق التوكن ومعالجة 401 وإلا سترفضه كل الـ endpoints.

### P1-05: mock data صامتة في مسار إنتاجي (Reports) — ❌ مفتوحة → GF-0010/GF-0019
### P1-06: Redis وpgAdmin منشوران على الشبكة بكلمات مرور ضعيفة — ✅ **مغلقة في GF-0006**
- الربط الخارجي أصبح `127.0.0.1` فقط لكل الخدمات (postgres/redis/pgAdmin) — لا نشر على الشبكة الخارجية.
- pgAdmin تحت profile اختياري `tools` (لا يعمل افتراضيًا) وبيانات اعتماده من `.env`.

### P1-07: healthcheck لـ Postgres مكسور — ✅ **مغلق في GF-0006**
- أصبح `pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}` — المستخدم وقاعدة البيانات من env الحاوية (كان `erp_user` غير المعرف).
### P1-08: لا rate limiting ولا helmet ولا correlation IDs — ❌ مفتوحة → GF-0021
### P1-09: صلاحيات بلا مصفوفة معتمدة — 🟡 **منفذة تقنيًا في GF-0002** (مصفوفة `API_CONTRACT.md` مفعّلة ومختبرة 403) — تبقى موافقة مالك المنتج الرسمية على المصفوفة.
### P1-10: لا pagination في أي قائمة — ❌ مفتوحة → GF-0012
### P1-11: أحداث بلا listeners — ❌ مفتوحة → ADR-0003
### P1-12: تعارض المنفذ backend/mobile — 🟡 **محلول جزئيًا:** `.env` محلي بـ PORT=3005 + `.env.example` يوثق 3005؛ يُستكمل مع Flutter config في GF-0010.

## P2 — متوسطة: قبل الإطلاق المؤسسي

- P2-01: لا password policy ولا session expiry قصير (الافتراضي 7 أيام في `auth.module.ts`).
- P2-02: لا audit logging للعمليات الحساسة (جدول `ActivityLog` موجود وغير مستخدم).
- P2-03: `verboseMemoryLeak: true` مفعل في `app.module.ts` — لا يليق بالإنتاج.
- **P2-04: ثغرات سلسلة Prisma في `deepmerge-ts` — 🟡 مخففة بالـoverride في GF-SEC-001**
- **الأصل:** `prisma@7.9.1` → `@prisma/config@7.9.1` يثبت `deepmerge-ts@7.1.5`، المتأثر بـ`GHSA-ggr8-5vv4-36mx / CVE-2026-40345` (uncontrolled recursion، High).
- **الإجراء:** `backend/package.json` يفرض override scoped إلى `@prisma/config > deepmerge-ts = 8.0.2`، مع تحديث `package-lock.json` وعدم تغيير Prisma major.
- **الإثبات:** `npm audit --omit=dev --audit-level=high` أعاد صفر vulnerabilities في اختبار توافق معزول، و`prisma generate`, `prisma validate`, `typecheck`, `build`، و197 unit tests نجحت.
- **الحدود:** هذا workaround مؤقت لأن upstream ما زال يثبت 7.1.5؛ يجب إزالته بعد إصدار Prisma رسمي يعتمد `deepmerge-ts >= 8.0.0` مع إعادة كل البوابات.
- **المراجع:** [GitHub Advisory GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) و[Prisma ORM issue #30052](https://github.com/prisma/orm/issues/30052).
- P2-04b: لا يوجد secret scanning إضافي خارج بوابة CI الحالية.
- P2-05: بيانات حساسة محتملة في رسائل الأخطاء (تفاصيل Prisma تصل للعميل كما هي).
- P2-06: Swagger مكشوف للجمهور بلا حماية (`/api/docs`).
- P2-07: أسرار خدمة pgAdmin مكتوبة نصًا في compose.
- P2-08 (جديد بعد GF-0002): `/auth/login` بلا rate limiting — هدف سهل لهجمات القوة الغاشمة (يرتبط بـ P1-08).

---

## مصفوفة الحالة

| ID | الخطورة | الحالة | أُغلقت في | الإثبات |
|---|---|---|---|---|
| P0-01 | حرجة | ✅ مغلقة | GF-0002 | e2e: 7×401 + 3×403 + مصفوفة أدوار |
| P0-02 | حرجة | ✅ مغلقة | GF-0002 | fail-closed boot + main.spec.ts |
| P0-03 | حرجة | ✅ **مغلقة بالكامل** | GF-0002+GF-0006 | grep صفر نتائج + CI secret-scan يمر |
| P0-04 | حرجة | ✅ مغلقة (ومقواة في GF-0004: حقن الهوية في body يُرفض 400) | GF-0002+0004 | e2e: تجاهل ثم رفض HACKED-USER-ID |
| P0-05 | حرجة | ✅ مغلقة | GF-0004 | 19 اختبار 400 + 13 DTO |
| P1-01 | عالية | ✅ مغلقة | GF-0002 | assertRequiredEnv + CORS_ORIGINS |
| P1-02 | عالية | ✅ مغلقة | GF-0006 | README صادق + seed من env |
| P1-06/07 | عالية | ✅ مغلقة | GF-0006 | localhost فقط + profile tools + healthcheck مصلح |
| P1-03/04/05/08..12 | عالية | ❌ مفتوحة | — | Flutter/GF-0010، rate-limit/GF-0021، pagination/GF-0012، ADR-0003 |
| P2-01..03, P2-05..08 | متوسطة | ❌ مفتوحة | — | المراحل 7-9 |
| P2-04 | متوسطة | 🟡 مخففة مؤقتًا | GF-SEC-001 | override scoped + audit صفر؛ انتظار إصلاح Prisma الرسمي |

**قاعدة الحوكمة:** لا تُغلق أي ثغرة في هذا الملف دون إشارة إلى commit الإغلاق واختبار يثبت السلوك (401/403/إقلاع فاشل…). الـoverride في GF-SEC-001 يمثل تخفيفًا مؤقتًا موثقًا، وليس إغلاقًا نهائيًا للسبب الجذري.
