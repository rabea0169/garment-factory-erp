# ARCHITECTURE — معمارية Garment Factory ERP

## 1. البنية الحالية كما هي في الكود (كما-هي)

```text
mobile_app/ (Flutter 3.44, Android-first, عربي RTL)
  Cubit/Bloc لكل feature
  Dio (ApiClient singleton) ── بلا auth interceptor، base URL مكتوب في الكود
  SharedPreferences للتوكن (غير آمن)
        │ HTTP JSON
        ▼
backend/ (NestJS 11, منفذ افتراضي 3000)
  main.ts: ValidationPipe عالمي (whitelist+forbidNonWhitelisted) + CORS '*' + Swagger /api/docs
  AppModule: ConfigModule + EventEmitterModule + PrismaModule + 9 feature modules
    ├── auth: JwtStrategy + RolesGuard (غير مفعّلين) + /auth/login فقط
    ├── products / inventory / production / quality / hr / sales / shipping / accounting
  EventEmitter2: emit فقط في inventory + production — صفر listeners
        │ Prisma (adapter-pg → Pool)
        ▼
PostgreSQL 16 (docker-compose) + Redis 7 (غير مستخدم) + pgAdmin (منشور على 5050)
```

**نقاط الضعف المعمارية المسجلة في Baseline:**
1. طبقة النقل بلا حماية (لا guard عالمي) — التفاصيل في `SECURITY_BASELINE.md`.
2. لا توجد طبقة domain/application واضحة — الـ services تستدعي Prisma مباشرة وتخلط القواعد بالـ persistence.
3. الأحداث (EventEmitter2 in-process) غير موثوقة للاستخدامات المالية المعلنة في README — لا outbox ولا retry.
4. لا توجد وحدات Dashboard/Reports في backend رغم وجود شاشتين في Flutter تطلبانها.
5. الـ schema يربط `WorkOrder.productId` بالمنتج لا بالـ variant، وBOM بلا إصدارات — يعقد دورة الإنتاج الصحيحة.

## 2. البنية الهدف (وفق الخطة المرجعية)

```text
Flutter (RTL-first)
  core/{config,theme,router,network,storage,permissions,widgets}
  features/*/{data repositories + domain + presentation (Cubit)}
       │
       ▼ REST + JWT Bearer
NestJS
  Guards: JwtAuthGuard (APP_GUARD) ← Public() فقط للـ login، RolesGuard + @Roles()
  Controllers (DTOs + validation) → Application Services (قواعد المجال والـ transactions)
  Inventory Application Service موحد (ledger) — كل تغيير رصيد يمر منه
  Event outbox (أو events مبسطة موثوقة) للقيود المحاسبية الآلية
       │
       ▼
PostgreSQL (Prisma + migrations) — Redis (cache/rate-limit عند الحاجة) — Object storage للصور
```

## 3. تدفق البيانات للمسار الذهبي (الهدف)

```text
تعريف Product/SKU → BOM version → استلام خامة (receipt → ledger)
  → أمر تشغيل (SKU + BOM version) → حجز خامات → صرف (issue → ledger → إنتاج تحت التشغيل)
  → مراحل (قص/خياطة/تشطيب/كي/تغليف) → جودة (ناجح/مرفوض/هالك)
  → إدخال المنتج التام مرة واحدة (ledger منتج تام + تكلفة)
  → أمر بيع (تحقق متاح + حجز) → شحن → تحصيل → قيود آلية + KPIs حقيقية
```

## 4. قرارات معمارية مفتوحة (تحتاج ADR عند تنفيذها)

| القرار | الخيارات | الحالة |
|---|---|---|
| موثوقية الأحداث المالية | outbox pattern / الاستغناء عن events ونفس الـ transaction | ADR-0003 قيد الاقتراح |
| سياسة التكلفة | Weighted Average / Standard Cost | تُعتمد في المرحلة 4 |
| المصادقة على الويب مستقبلًا | Bearer فقط / cookie + CSRF | مؤجل |
| تعدد المصانع/الشركات (tenancy) | إضافة companyId لاحقًا / عزل قواعد | مؤجل — قرار قبل المرحلة 7 |
