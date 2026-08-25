# 🏭 Garment Factory ERP — نظام إدارة مصنع الملابس الجاهزة

نظام ERP متخصص لمصانع الملابس الجاهزة، مبني بـ **Flutter** (تطبيق ميداني عربي) و **NestJS + PostgreSQL** (Backend).

> **حالة المشروع:** مرحلة التثبيت والأمان (Phase 1) — الحماية الأساسية والتحقق من المدخلات مكتملان ومختبران، وبقية الوظائف قيد التطوير وفق `docs/MASTER_BACKLOG.md`. لا يزال النظام **غير جاهز للتشغيل ببيانات حقيقية** حتى اكتمال المراحل الموثقة.

---

## 📦 هيكل المشروع

```
garment-factory-erp/
├── backend/          # خادم NestJS + PostgreSQL (Prisma)
├── mobile_app/       # تطبيق Flutter (Android)
├── docs/             # حوكمة المشروع (الحالة، الأمان، العقد، المهام)
└── docker-compose.yml
```

## 🛠️ التقنيات

| الجانب | التقنية |
|--------|---------|
| تطبيق الموبايل | Flutter 3.44 + Bloc/Cubit |
| الخادم | NestJS 11 (Node.js) |
| قاعدة البيانات | PostgreSQL 16 |
| ORM | Prisma 7 (driver adapter) |
| المصادقة | JWT Bearer + RBAC (8 أدوار) |
| توثيق API | Swagger على `/api/docs` |

## 🔐 الحماية المفعّلة حاليًا (GF-0002 → GF-0004)

- **كل مسارات API محمية fail-closed** بـ JWT عبر حارس عالمي — المسارات العامة فقط: `POST /auth/login` و `GET /`.
- **مصفوفة أدوار مفعّلة ومختبرة** لكل مسار حساس (401/403 مختبرة سلوكيًا).
- **لا أسرار في الكود**: الإقلاع يفشل فورًا بدون `JWT_SECRET` و`DATABASE_URL` (وفشل أشد في الإنتاج عند سر قصير أو CORS مفتوح).
- **الهوية من الجلسة فقط**: حقول `userId/createdById/creatorId` في body تُرفض بـ 400.
- **تحقق شامل من المدخلات** (class-validator): حقول غير معروفة، enums، كميات/أسعار موجبة، UUIDs، تواريخ ISO — 400 برسائل عربية.
- **اختبارات سلوكية**: 89 unit + 36 e2e (بلا قاعدة بيانات) + CI على GitHub.

## ⚠️ ما هو غير مكتمل بعد (صادق)

- تطبيق Flutter لم يُربط بالمصادقة بعد (لا auth interceptor — `GF-0010`)، وبعض شاشاته تعرض بيانات وهمية (Reports).
- لوحة التحكم والتقارير Backend غير موجودين (9 وحدات فقط — لا Dashboard/Reports).
- أحداث EventEmitter موصولة في موضعين فقط **بلا أي listeners** — التكامل المحاسبي الآلي المخطط معلق على قرار ADR-0003.
- Redis موجود في docker-compose لكن الكود لا يستخدمه بعد.
- لا pagination بعد، ولا ledger موحد للمخزون (المراحل 2–3 في الخطة).

## 🚀 التشغيل (التطوير)

### 1. قاعدة البيانات

```bash
# انسخ قالب المتغيرات ثم املأ القيم (لا يوجد أي سر افتراضي)
cp .env.example .env        # بجذر المستودع: POSTGRES_USER/PASSWORD/DB

docker compose up -d        # postgres + redis (pgAdmin اختياري: --profile tools)
```

### 2. الـ Backend

```bash
cd backend
cp .env.example .env        # ثم اضبط: DATABASE_URL, JWT_SECRET (عشوائي 32+), SEED_ADMIN_PASSWORD
npm install

npx prisma migrate dev      # تطبيق المهاجرات
npx prisma db seed          # بيانات أولية (admin + خامات + منتج تجريبي)
npm run start:dev           # يعمل على PORT من .env (مثال 3005)
```

**توليد سر JWT للتطوير:** `openssl rand -base64 48`

**الدخول الأولي:** البريد `admin@factory.com` وكلمة المرور هي التي حددتها في `SEED_ADMIN_PASSWORD` — لا توجد كلمة مرور منشورة.

> الخادم **يرفض الإقلاع** بدون `.env` مكتمل — هذا مقصود (fail-closed).

### 3. تطبيق Flutter

```bash
cd mobile_app
flutter pub get
flutter run
```

> ملاحظة: التطبيق يطلب `http://10.0.2.2:3005` (محاكي Android) — وطابقه backend على `PORT=3005`. ربط المصادقة قيد التنفيذ (`GF-0010`).

## 📚 التوثيق والحوكمة

كل وثائق المشروع داخل `docs/`:

| الملف | الغرض |
|---|---|
| `PROJECT_STATE.md` | مصدر الحقيقة لحالة المشروع |
| `SECURITY_BASELINE.md` | سجل الثغرات (P0/P1/P2) وحالة إغلاقها |
| `API_CONTRACT.md` | عقد الـ API الكامل + قواعد التحقق + مصفوفة الأدوار |
| `MASTER_BACKLOG.md` | المهام المرتبة GF-0001…GF-0022 |
| `handoffs/` | بطاقات التسليم بين المهام |

## 🧪 الفحوصات

```bash
cd backend
npm run lint               # فحص نقي (lint:fix للإصلاح التلقائي)
npm test -- --runInBand    # 22 suite — 89 اختبارًا
npm run test:e2e -- --runInBand  # 2 suite — 36 اختبارًا (بلا قاعدة بيانات)
npm run build
```

CI على GitHub يشغّل: prisma generate/validate + lint + build + unit + e2e + secret scan.

## 🗺️ خارطة الطريق

المراحل الكاملة في الخطة المرجعية: التثبيت والأمان (حاليًا) ← أساس المجال وقاعدة البيانات ← المنتجات والمخزون (ledger) ← الإنتاج ← الجودة والموارد البشرية ← التجارية ← المحاسبة والتقارير ← تجربة Flutter ← QA ← Pilot ← الإطلاق.
