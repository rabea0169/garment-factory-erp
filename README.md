# 🏭 Garment Factory ERP — نظام إدارة مصنع الملابس الجاهزة

نظام ERP متكامل لإدارة مصانع الملابس الجاهزة، مبني بـ **Flutter** (موبايل) و **NestJS + PostgreSQL** (Backend).

---

## 📦 هيكل المشروع

```
garment-factory-erp/
├── backend/          # خادم NestJS + PostgreSQL
├── mobile_app/       # تطبيق Flutter (Android)
└── docker-compose.yml
```

---

## 🛠️ التقنيات المستخدمة

| الجانب | التقنية |
|--------|---------|
| تطبيق الموبايل | Flutter 3.44 |
| إدارة الحالة | Bloc / Cubit |
| الخادم | NestJS (Node.js) |
| قاعدة البيانات | PostgreSQL 16 |
| ORM | Prisma |
| المصادقة | JWT + Bcrypt |
| الأحداث | EventEmitter2 (Event-Driven) |
| التخزين المؤقت | Redis |
| توثيق API | Swagger |

---

## 🚀 تشغيل المشروع

### 1. تشغيل قاعدة البيانات

```bash
docker-compose up -d
```

### 2. تشغيل الـ Backend

```bash
cd backend
npm install
npx prisma migrate dev --name init
npx prisma generate
npm run start:dev
```

الخادم يعمل على: http://localhost:3000  
توثيق API: http://localhost:3000/api/docs

### 3. تشغيل تطبيق Flutter

```bash
cd mobile_app
flutter pub get
flutter run
```

---

## 📱 الموديولات الـ 12

| # | الموديول | الوصف |
|---|---------|-------|
| M-01 | Core | الأساسيات والـ Widgets المشتركة |
| M-02 | Auth & RBAC | تسجيل الدخول والصلاحيات |
| M-03 | Product Catalog | كتالوج المنتجات والموديلات |
| M-04 | Inventory | إدارة المخزون |
| M-05 | Production | أوامر الإنتاج والتصنيع |
| M-06 | Quality Control | مراقبة الجودة والهدر |
| M-07 | HR & Payroll | العمالة والأجور بنظام القطعة |
| M-08 | Sales & Purchasing | المبيعات والمشتريات والديون |
| M-09 | Shipping | الشحن والتوزيع |
| M-10 | Accounting | شجرة الحسابات وأوامر الصرف |
| M-11 | Reports & Printing | التقارير والطباعة |
| M-12 | Dashboard | لوحة التحكم والـ KPIs |

---

## 📱 ميزات Android المستخدمة

- 📷 **مسح الباركود والـ QR** — لإدخال المنتجات والمواد الخام
- 🔊 **الإدخال الصوتي** — إدخال الكميات بالصوت
- 🔔 **الإشعارات** — تنبيهات الديون والمخزون المنخفض
- 🖨️ **طباعة البلوتوث** — طباعة الفواتير على طابعات حرارية
- 📡 **NFC** — مسح بطاقات العمال لتسجيل الإنتاجية

---

## 🔗 Event-Driven Architecture

```
إنشاء أمر تشغيل  →  سحب المواد من المخزون تلقائياً
                  →  توليد قيد محاسبي آلي

إنشاء فاتورة بيع →  سحب المنتجات من المخزون تلقائياً
                  →  توليد قيد (مدين: ذمم، دائن: إيرادات)

قطع مرفوضة       →  تسجيل مصروف هالك آلياً
                  →  تحديث KPI الجودة
```

---

## 👤 بيانات الدخول الأولية

```
البريد: admin@factory.com
كلمة المرور: Admin@123
```
