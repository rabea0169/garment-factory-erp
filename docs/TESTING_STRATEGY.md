# TESTING_STRATEGY — استراتيجية الاختبار

## 1. حالة خط الأساس (2026-08-24) → الحالة بعد GF-0003 (2026-08-25)

```text
قبل GF-0003:  19 suite — ناجح 1 — فاشل 18 (قوالب NestJS بلا PrismaService mock)
بعد GF-0003:   22 unit suite — ناجح 22 (89 اختبارًا) + 2 e2e suite (17 اختبارًا)
               lint: صفر أخطاء وصفر تحذيرات
```

**أوامر التشغيل والنتائج الحالية:**
```bash
cd backend && npm test -- --runInBand            # 22/22 suites — 89/89 tests ✅
cd backend && npm run lint                       # 0 errors, 0 warnings ✅
cd backend && npm run test:e2e -- --runInBand    # 2/2 suites — 17/17 tests ✅ (بلا قاعدة بيانات)
cd backend && npm run build                      # ✅
cd backend && npx prisma validate                # ✅
```

## 2. القواعد الملزمة

1. **لا اختبار شكلي** — كل قاعدة أعمال لها اختبار سلوكي (رفض بيع أقل من المتاح، منع انتقال حالة غير صحيح، توازن قيد…).
2. **لا إخفاء فشل** — ممنوع `|| true` أو skip جماعي أو خفض strictness لإخضاع CI.
3. كل bug fix يصاحبه اختبار يفشل قبله وينجح بعده.
4. المخزون/الإنتاج/المالية: اختبار فشل في منتصف transaction وعدم تكرار الأثر (idempotency).

## 3. بنية الاختبارات الحالية (بعد GF-0003)

| المجموعة | الملفات | ما تختبره |
|---|---|---|
| Guards unit | `auth/jwt-auth.guard.spec.ts`, `auth/roles.guard.spec.ts` | تمرير @Public، مصفوفة الأدوار، تجاوز SUPER_ADMIN |
| Env fail-closed | `main.spec.ts` (6 اختبارات) | رفض الإقلاع عند نقص/قصر الأسرار في الإنتاج |
| الخدمات (9 modules × service.spec) | حسابات فعلية: إجمالي الفاتورة في الخادم (225 لسيناريو 2×100+1×50−25)، أجر القطعة (100×5.5=550) مع snapshot للسعر، تراكم الرصيد (150+50=200)، فلترة low-stock (بما فيها حد المساواة)، توليد الأكواد (CUST-/SO-/WO-/VCH-/SHP-)، إطلاق الأحداث الصحيحة، حالات 404 |
| الـ Controllers (9 × controller.spec) | تمرير الهوية من الجلسة (`user-from-session` لا من body)، **اختبارات انحدار للحماية**: @Roles و@Public metadata لكل مسار حساس (لا يمكن إزالتها دون فشل أحمر) |
| e2e حماية | `test/auth-guard.e2e-spec.ts` (16) | 7×401 + 3×403 + تجاهل HACKED-USER-ID + المسارات العامة |
| e2e جذر | `test/app.e2e-spec.ts` (1) | GET / يعمل بعد إصلاح تسجيل AppController |

**Helpers مشتركة** (تُعاد استخدامها، لا تُكرر):
- `test/helpers/prisma-mock.ts` — مصنع mock موحد لـ PrismaService (كل استدعاء يصبح jest.fn()).
- `test/helpers/method-metadata.ts` — قراءة metadata الـ decorators (@Roles/@Public) بطريقة آمنة (NestJS يخزنها على descriptor.value — الشكل ثلاثي المعاملات `getMetadata(key, proto, 'method')` **لا** يجدها).

## 4. قرارات GF-0003 الموثقة

1. **فصل `lint` عن `lint:fix`** في package.json — `npm run lint` فحص نقي لا يعدل الملفات (أنهى حادثة الـ `--fix` التي وثقت في GF-0001).
2. **تطبيع prettier على src/test كاملة** — كان CI يصلح تنسيقات 61 خطأ prettier خفيةً داخل بيئته المؤقتة عبر `--fix`؛ بعد الفصل صار التطبيع ملتزمًا في المستودع (تغيير تنسيقي فقط، صفر سلوك).
3. **`ignoreRestSiblings: true`** في eslint — الإعداد القياسي لنمط الحذف المتعمد `const { password, ...result } = user` (مستخدم في auth.service وjwt.strategy).
4. **typing فقط في services/controllers** (PaymentType/AccountType/VoucherType وinterfaces) لإغلاق أخطاء unsafe-any — **الـ DTOs مع class-validator وفرض 400 تبقى نطاق GF-0004**.
5. **قيم اختبارية لا تطابق secret-scan**: قيم URL/سر في ملفات الاختبار أعيدت صياغتها (بلا user:pass@، والسر عبر متغير وسيط) كي لا تولد إنذارات كاذبة في فحص CI.

## 5. ملاحظات secret-scan (لكل من ينفذ GF-0006)

الفحص الحالي في CI سيبقى أحمر حتى GF-0006 بسبب (المقصود):
- `docker-compose.yml` — `erp_password_2024` + `Admin@123` في README/seed/login.dto.

**False positives موثقة** (قيم توثيقية placeholder وليست أسرارًا):
- `backend/.agents/**` و`.claude/**` و`.windsurf/**` — ملفات مهارات Prisma تحتوي أمثلة مثل `postgresql://USER:PASSWORD@HOST` — يلزم في GF-0006 إما استثناء هذه المسارات في فحص CI أو ضبط النمط ليستهدف قيمًا فعلية.

## 6. مصفوفة الاختبارات المطلوبة حسب النوع (تظل مرجعًا للمهام القادمة)

### مسارات محمية (لكل endpoint حساس)
```text
no token → 401 | expired token → 401 | wrong role → 403 |
correct role → 2xx | invalid input → 400 | invalid UUID → 400 |
duplicate request → idempotent
```

### Flutter
Cubit states (loading/loaded/empty/error/unauthorized) · repository · widgets · RTL · انقطاع شبكة + retry بلا ازدواج.

## 7. تعريف "الاختبارات خضراء"

- `npm test -- --runInBand` نجاح كامل. ✅ محقق (89/89)
- `npm run lint` صفر أخطاء. ✅ محقق (صفر تحذيرات أيضًا — لا قائمة تحذيرات مؤجلة حاليًا)
- `npm run test:e2e` نجاح بلا قاعدة بيانات. ✅ محقق (17/17 — حتى بلا ملف .env)
- CI أحمر فقط عند فشل حقيقي — حاليًا secret-scan أحمر فقط لنطاق GF-0006 الموثق أعلاه.
