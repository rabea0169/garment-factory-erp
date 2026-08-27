# Release Readiness — Garment Factory ERP

**تاريخ المراجعة:** 2026-08-27

**فرع المراجعة:** `feat/full-remediation`

**الحالة:** Release Candidate للتجربة المنضبطة، وليست شهادة جاهزية إنتاجية نهائية.

## نطاق الإصلاح المنفذ

تتضمن النسخة الحالية إصلاح session/profile و`/auth/me`، parsing آمن لقوائم API، إنشاء المنتج الكامل داخل transaction واحدة، إنشاء أوامر التشغيل وتسجيل مخرجات المرحلة مع `Idempotency-Key`، حركات المخزون الأساسية، دورة البيع والتحصيل والإلغاء والمرتجع، اختيار أوامر البيع المؤكدة للشحن، الاستلام ومرتجع المورد، السندات والخزائن المحاسبية، تحسين البحث في المخزون، فحص readiness، وتحسين حالات الحفظ والفشل في واجهات Flutter.

## بوابات التحقق

| البوابة | النتيجة | الدليل |
|---|---:|---|
| Flutter analyze | ناجح | `flutter analyze --no-fatal-infos` — No issues found |
| Flutter tests | ناجح | 33 اختبارًا ناجحًا |
| Android Debug APK | ناجح | `build/app/outputs/flutter-apk/app-debug.apk` |
| Prisma generate | ناجح | `npx prisma generate` |
| Backend format check | ناجح | `npm run format:check` |
| Backend typecheck | ناجح | `npm run typecheck` |
| Backend lint | ناجح | لا توجد أخطاء؛ أي تحذيرات قائمة يجب فصلها عن Sprint |
| Backend build | ناجح | `npm run build` |
| Backend unit | ناجح | 35 suite / 246 اختبارًا |
| Backend E2E | ناجح | 3 suites / 64 اختبارًا |
| Git whitespace | ناجح | `git diff --check` |
| PostgreSQL integration | لم تُشغّل | `GF_INTEGRATION_DATABASE_URL` غير موجود في البيئة الحالية |

## قيود تمنع إعلان Production Ready

لم تُشغّل اختبارات PostgreSQL integration على قاعدة اختبار منفصلة في هذه البيئة. يجب تنفيذها بعد ضبط `GF_INTEGRATION_DATABASE_URL`، مع التأكد من أن الرابط لا يشير إلى قاعدة الإنتاج.

لم يُنفذ قبول ميداني على هاتف Android فعلي. لذلك ما زالت صلاحيات Contacts، سلوك لوحة المفاتيح، أحجام الشاشات، back gesture، وقياس أداء Contact Picker بحاجة إلى UAT فعلي.

ملف APK الحالي Debug وليس Release signed. قبل التوزيع يجب إعداد keystore خارج Git، وبناء Release، والتحقق من عدم وجود أسرار أو رموز داخل الحزمة، ثم إجراء smoke test على جهاز فعلي.

أظهر بناء Android تحذيرًا متعلقًا بانتقال بعض الإضافات إلى Built-in Kotlin. البناء ناجح حاليًا، لكن يجب متابعة توافق الإضافات وترقية ما يلزم قبل إصدار طويل الأمد.

## شرط الدمج النهائي

لا يُنصح بإعلان الإصدار إنتاجيًا إلا بعد نجاح اختبار integration بقاعدة اختبار، وUAT على جهاز فعلي، وبناء Release signed، والتحقق من مراقبة Railway وhealth/readiness، ومراجعة الحسابات التجريبية والصلاحيات ونسخ PostgreSQL الاحتياطية.

## أوامر إعادة التحقق

```bash
cd mobile_app
flutter analyze --no-fatal-infos
flutter test --no-pub
flutter build apk --release --target-platform android-arm64 \
  --dart-define=API_BASE_URL=https://garment-factory-erp-production.up.railway.app

cd ../backend
npx prisma generate
npm run format:check
npm run typecheck
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run test:integration:required
```

> لا تُشغّل `migrate reset` أو اختبارات التكامل على قاعدة fulfilling-serenity الإنتاجية. استخدم قاعدة اختبار منفصلة فقط.
