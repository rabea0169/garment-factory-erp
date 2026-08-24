# TESTING_STRATEGY — استراتيجية الاختبار

## 1. حالة خط الأساس (2026-08-24)

```text
Suites: 19 — ناجح 1 (app.controller.spec.ts) — فاشل 18
السبب الجذري الموحد: ملفات spec هي قوالب NestJS الافتراضية
(beforeEach ينشئ TestingModule بلا توفير mock لـ PrismaService)
→ Nest can't resolve dependencies of XService (PrismaService, +)
```

**أوامر إعادة الإنتاج:**
```bash
cd backend && npm test -- --runInBand   # 18 failed / 1 passed
cd backend && npm run lint              # 16 errors / 5 warnings
```

## 2. القواعد الملزمة

1. **لا اختبار شكلي** — كل قاعدة أعمال لها اختبار سلوكي (رفض بيع أقل من المتاح، منع انتقال حالة غير صحيح، توازن قيد…).
2. **لا إخفاء فشل** — ممنوع `|| true` أو skip جماعي أو خفض strictness لإخضاع CI.
3. كل bug fix يصاحبه اختبار يفشل قبله وينجح بعده.
4. المخزون/الإنتاج/المالية: اختبار فشل في منتصف transaction وعدم تكرار الأثر (idempotency).

## 3. مصفوفة الاختبارات المطلوبة حسب النوع

### مسارات محمية (لكل endpoint حساس)
```text
no token → 401 | expired token → 401 | wrong role → 403 |
correct role → 2xx | invalid input → 400 | invalid UUID → 400 |
duplicate request → idempotent
```

### طبقات Backend
| الطبقة | ماذا يختبر | أدوات |
|---|---|---|
| Unit (guards/DTO/حسابات) | قواعد صرفة بلا DB | jest |
| Service | منطق المجال مع Prisma mock + transactions | jest + mocks |
| API/E2E | 401/403/validation/pagination على HTTP حقيقي | supertest (test/app.e2e-spec.ts) |
| Golden paths | دورة SKU→BOM→استلام→أمر→صرف→إنتاج→تام→بيع→قيد | e2e |

### Flutter
Cubit states (loading/loaded/empty/error/unauthorized) · repository · widgets · RTL · انقطاع شبكة + retry بلا ازدواج.

### Security (من المرحلة 9، وبعضها مبكرًا)
secret scan في CI (مباشر من الآن) · npm audit · JWT expiry/توقيع غير صالح · RBAC matrix · rate-limit · error redaction.

## 4. خطة إصلاح الاختبارات الحالية (GF-0003)

1. استبدال القوالب الـ 18 الفاشلة بـ specs فعلية: `Test.createTestingModule` مع `overrideProvider(PrismaService)` + mocks مركزية في `test/` تُعاد استخدامها.
2. أخطاء lint الـ 21 تُصنف: إصلاح آمن ضمن المهمة (unused imports) مقابل مؤجل (no-unsafe-assignment يحتاج DTOs — يرتبط بـ GF-0004+).
3. CI (`.github/workflows/ci.yml`) يشغّل: prisma generate → validate → lint → build → test. فشل أي خطوة = فشل CI — لا continue-on-error.

> ⚠️ **تحذير مهم للنماذج اللاحقة:** سكربت `npm run lint` في `backend/package.json` يحتوي `--fix` — تشغيله **يعدّل ملفات المصدر تلقائيًا** وينتج diff خارج نطاق المهمة. حدث فعليًا خلال GF-0001 ورُوجع يدويًا. عند الحاجة للفحص فقط بدون تعديل استخدم:
> ```bash
> npx eslint "{src,apps,libs,test}/**/*.ts"   # فحص بلا --fix
> ```
> ويفضل لاحقًا فصل `lint` (فحص) عن `lint:fix` (إصلاح) في package.json (مهمة GF-0003).

## 5. تعريف "الاختبارات خضراء"

- `npm test -- --runInBand` نجاح كامل.
- `npm run lint` صفر errors (التحذيرات الموثقة مسموحة مؤقتًا بقائمة في هذا الملف).
- CI أحمر فقط عند فشل حقيقي.
