# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو **مصدر الحقيقة** لحالة المشروع. يحدَّث بعد كل مهمة. لا يبدأ أي نموذج عملًا قبل قراءته.

```text
Project: Garment Factory ERP
Current branch: phase2/domain-foundation (متفرعة من stabilization/baseline-and-security @ 3ebf6a7)
Current commit: 553fe9e (ci trigger fix بعد GF-0007؛ التنفيذ 9ab9baa)
Current release: لا يوجد إصدار معتمد بعد (pre-release)
Last completed phase: **المرحلة 1 مكتملة — بوابة G1 معبورة** (GF-0001..GF-0006 على stabilization/baseline-and-security، CI أخضر بالكامل — Run #8/#9) — **PR #1 مفتوح للدمج في main: https://github.com/rabea0169/garment-factory-erp/pull/1 (mergeable، الفحوص خضراء)**
Last completed task: GF-0007 — Domain Foundation (Warehouse + Stock Ledger + Idempotency + Indexes) — أول مهمة المرحلة 2
Active task: GF-0008 — BOM versions + ربط WorkOrder بالـ variant/SKU (بطاقتها في HANDOFF-006.md)
Blocked tasks: لا شيء
Known failing checks: **لا شيء في CI** (backend + secret-scan أخضران على stabilization)؛ ملاحظة موثقة: خطأان TS تاريخيان في ملفات اختبار قديمة (quality spec + method-metadata helper) يظهران فقط مع tsc --noEmit الخام ولا يراهما باب CI (nest build يستثني specs) — يُعالجان عند لمس ملفاتهما
Database migration state: migration ثنتان: init + domain_foundation (GF-0007) — غير مطبقتين على بيئة مشتركة بعد؛ التطبيق المحلي: docker compose up -d db ثم prisma migrate deploy ثم seed
Current API version: 1.0 (غير مقفل — العقد غير مستقر بعد)
Current mobile API base URL: Android emulator http://10.0.2.2:3005 — iOS/Web http://localhost:3005 (مكتوبة داخل الكود، ليست من environment — GF-0010)
Security blockers: لا P0 ولا P1 مفتوحة في البنية التحتية — المتبقي P1-03/04/05 (Flutter — GF-0010) وP1-08..12 (موثقة بجدولها)
Open decisions: ADR-0003 (مصير الأحداث المالية — اتجاه معتمد عمليًا في GF-0007: الآثار داخل transaction + أحداث للتنبيهات غير المالية فقط، يُحسم نهائيًا في المرحلة 7)
Last handoff: docs/handoffs/HANDOFF-006.md
Next exact action: تنفيذ GF-0008 وفق بطاقتها في HANDOFF-006.md (الفرع مدفوع إلى GitHub وCI أخضر بالكامل — Run #10 على phase2/domain-foundation؛ ودمج PR #1 في main بقرار من المالك)
```

---

## 0. ما أنجزته GF-0007 (أساس المجال)

أول مهمة تلمس قاعدة البيانات منذ init: **مخزون قابل للتدقيق من اليوم الأول**.

1. **ثلاثة نماذج جديدة:** `Warehouse` (خامات/تام/عام) · `StockLedgerEntry` (سجل موحد append-only بحركة موقعة `quantityDelta` + لقطة `balanceAfter` + تكلفة وقيمة + روابط خامة/variant/مخزن/مفتاح idempotency/منشئ) · `IdempotencyKey` (مفتاح + نطاق + بصمة SHA-256 + استجابة مخزنة).
2. **القاعدة المركزية (معيار القبول 2):** لا تحديث لـ `currentStock` خارج InventoryService، وداخلها حصريًا عبر UPDATE ذري واحد (`increment`) + سطر ledger واحد داخل `prisma.$transaction` واحدة — المسار القديم `add-stock` موجّه عبر نفس القناة.
3. **Idempotency كامل:** ترويسة `Idempotency-Key` اختيارية؛ نفس المفتاح + نفس المحتوى = نفس الاستجابة المخزنة (`replayed: true`) بلا أثر جديد؛ محتوى مختلف أو نطاق مختلف = 409؛ سباق P2002 = استرجاع استجابة الفائز.
4. **سياسات معتمدة:** ADR-0007 منع الرصيد السالب بثلاث طبقات (فحص الخدمة + CHECK في القاعدة + ledger موقعة) · ADR-0008 متوسط مرجح للتكلفة داخل transaction الاستلام.
5. **9 indexes جديدة** (أكواد/تواريخ/حالات) + قيدا CHECK يدويان موثقان في ملف الـ migration.
6. **مسارات API جديدة:** `GET /inventory/warehouses` · `GET /inventory/ledger` (مرشحات + حد 200) · `POST /inventory/movements/{receive,issue,adjust,waste}` — كلها INVENTORY_MANAGER والهوية من الجلسة.
7. **اختبارات:** 37 اختبار inventory (كانت 7) — idempotency (نفس المفتاح مرتين = أثر واحد) · فشل منتصف transaction (كل الكتابات tx-scoped ولا استجابة مخزنة) · منع السالب · متوسط مرجح 46.13 من 150@45.5+50@48 · تحقق المخازن. المجموع الكلي: 116 unit + 36 e2e كلها خضراء.

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
| `npm test -- --runInBand` | ✅ **22/22 suites — 89/89 اختبارات** (بعد GF-0003؛ كانت 18 فاشلة) |
| `npm run lint` | ✅ **صفر أخطاء وصفر تحذيرات** (بعد GF-0003 + فصل lint/lint:fix + تطبيع prettier) |
| `npm run format:check` | غير معرف كسكربت — يوجد `format` فقط |
| Flutter checks | غير مشغّلة في هذه البيئة (لا Flutter SDK مثبت) — مهمة CI |
| Docker Compose | ⚠️ healthcheck لـ postgres **مكسور** (انظر SECURITY_BASELINE P1-07) |

النتيجة بعد GF-0003: كل فحوصات backend خضراء (22 unit suite + 2 e2e + lint + build) وBackend job في CI أخضر بالكامل.

### دليل CI الفعلي
- **Run #1 (2026-08-25، sha 02ec9cb بعد GF-0002):** backend job فشل في lint (الأخطاء القديمة) + secret-scan فشل (مقصود).
- **Run #3 (بعد GF-0003):** Backend job أخضر — secret-scan أحمر (مقصود).
- **Run #6 (بعد GF-0006):** Secret Scan ✅ لأول مرة — لكن فشل Build بخطأ TS في seed.ts (narrowing عبر process.exit لا يثبت تحت نسخة TS في CI؛ أخفاه كاش تزايدي محلي).
- **Run #7 (2026-08-25، sha 119653c):** 🎉 **CI أخضر بالكامل — الوظيفتان معًا**: Backend (generate→validate→lint→build→unit 89→e2e 36) ✅ + Secret Scan ✅.
- الخلاصة: **بوابة G1 معبورة رسميًا** — الالتزام 119653c هو خط الأساس الأخضر القابل لإعادة الإنتاج.

## 3. جرد المكونات الفعلي (مقابل ما يعلنه README)

| ما يعلنه README | الواقع في الكود |
|---|---|
| 12 وحدة | 9 وحدات backend فقط (لا يوجد Dashboard ولا Reports module — طلب `/dashboard/stats` يرجع 404) |
| Event-Driven: سحب مخزون وقيد آلي عند إنشاء أمر تشغيل/فاتورة | `emit` في موضعين فقط (inventory/production) **وصفر `@OnEvent` listeners** |
| Redis للتخزين المؤقت | لا يستخدمه الكود إطلاقًا (حاوية docker فقط) |
| RBAC بالصلاحيات | `RolesGuard` موجود كملف **ولا يُستخدم في أي مكان** |
| 34 model و10 enums | مؤكد من `schema.prisma` |

## 4. الفحوصات المعروفة بفشلها (مع أوامر إعادة الإنتاج — بعد GF-0003)

```bash
# كل فحوصات backend خضراء الآن — لا فحص فاشل معروف في الكود
# الوحيد الأحمر: CI secret-scan (مقصود حتى GF-0006):
#   - docker-compose.yml: erp_password_2024
#   - README.md + prisma/seed.ts + login.dto.ts: Admin@123
#   - false positives موثقة في .agents/.claude/.windsurf (أمثلة توثيقية placeholder)
# التفاصيل في TESTING_STRATEGY.md §5
```

## 5. قيود البيئة والتشغيل (بعد GF-0003)

- **المنفذ**: `PORT` من البيئة — `.env` المحلي و`.env.example` يوثقان **3005** (ADR-0004 محسوم عمليًا).
- **التشغيل يتطلب `.env`**: `JWT_SECRET` و`DATABASE_URL` إلزاميان (فشل إقلاع بدونهما — fail-closed). انسخ `backend/.env.example` إلى `backend/.env`.
- **`npm run lint` الآن فحص نقي** (بلا `--fix`) — للإصلاح التلقائي استخدم `npm run lint:fix`.
- **قاعدة البيانات**: كلمة المرور لم تبق إلا في `docker-compose.yml` (GF-0006).
- **`prisma generate` إلزامي قبل البناء** — مُتمَت داخل CI.

## 6. بروتوكول تحديث هذا الملف

أي مهمة تُغلق يجب أن تحدّث: `Current commit`، `Last completed phase`، `Active task`، `Known failing checks`، `Last handoff`، `Next exact action`. التعديل يتم في نفس commit المهمة، لا في commit منفصل.
