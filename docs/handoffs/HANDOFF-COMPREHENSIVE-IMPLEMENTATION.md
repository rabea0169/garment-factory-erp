# Handoff — التنفيذ الشامل لخطة Garment Factory ERP

## الحالة

تم تنفيذ مجموعة الشرائح التشغيلية على الفرع `feat/sprint1-navigation-ux` فوق `origin/main@bd3c02eefc404a2110c60c31df3ea405214186e6`. لا توجد تغييرات مباشرة على `main`، ولم تُرفع commits ما بعد `b868087` إلى GitHub حتى اكتمال هذا التدقيق. لا يجوز الدمج قبل مراجعة الإصدار وموافقة المالك.

## ما تم تنفيذه

تتضمن السلسلة إصلاح سجل التنقل والخروج المزدوج من Dashboard، ومكونات UX مشتركة، وContact Picker مع مراجعة قبل التعبئة، وإنشاء العميل والمورد والعامل عبر API حقيقية. كما تتضمن دورة المبيعات من إنشاء الأمر إلى التحصيل والإلغاء والمرتجع، ودورة الشحن مع إثبات التسليم، ودورة أوامر الشراء والاستلام وتحديث المخزون.

تم تحويل شاشة الجودة من placeholder إلى تسجيل فحص فعلي مرتبط بـ`stageRunId`، مع كميات السليم والمرفوض والهالك وقاعدة conservation. وتم تحويل شاشة المحاسبة من زر سند فارغ إلى إنشاء سند قبض/صرف بخزينة نشطة، مع إضافة `GET /accounting/treasuries`. كما تم توحيد حالات التحميل والخطأ والفراغ في واجهات متعددة، وإصلاح تدفق تسجيل إنتاج العامل حتى لا يعرض نجاحًا قبل اكتمال الطلب.

## قواعد المجال المحمية

يأخذ الخادم هوية actor من JWT ولا يقبلها من body. تدعم العمليات الحساسة `Idempotency-Key` حيث يلزم، وتتم العمليات المالية وحركات المخزون داخل transactions القائمة. لا يسمح مسار المحاسبة الحالي بتأثير تشغيلي على ذمم العمال؛ صرف الرواتب يبقى عبر دورة Payroll. لا توجد واجهات وهمية للموردين أو العمال، ولا يتم الادعاء بأن Contact Picker يعمل على جهاز فعلي قبل اختبار الجهاز.

## أدلة التحقق

| البوابة | النتيجة |
|---|---|
| Flutter analyze | PASS — لا توجد issues |
| Flutter tests | PASS — 29 اختبارًا |
| Android Debug APK arm64 | PASS — `mobile_app/build/app/outputs/flutter-apk/app-debug.apk` |
| Prisma generate | PASS |
| Backend format check | PASS |
| Backend typecheck | PASS |
| Backend build | PASS |
| Backend lint | PASS — 0 errors و6 warnings قديمة في payroll/inventory specs |
| Backend unit tests | PASS — 35 suites / 241 tests |
| Backend E2E | PASS — 3 suites / 64 tests |
| Secret/build audit | PASS — لا أسرار أو build artifacts متتبعة في Git |
| PostgreSQL integration محليًا | NOT RUN — `GF_INTEGRATION_DATABASE_URL` غير مضبوط |
| iOS build | NOT RUN — لا توجد بيئة Xcode على Linux |
| Android device/UAT | NOT RUN — لا يوجد جهاز أو محاكي متصل |

## القيود قبل الإنتاج

الإصدار ما يزال `pre-release`. يجب تشغيل PostgreSQL integration على قاعدة اختبار منفصلة، تنفيذ UAT على هاتف Android فعلي مع صلاحيات Contacts، اختبار signing وrelease build، مراجعة backup/restore وmonitoring، وتدوير أو حذف أي حسابات تجريبية قبل الاستخدام الحقيقي. نجاح build والاختبارات لا يثبت الجاهزية المؤسسية أو سلامة بيانات production.

## التسليم التالي

بعد اكتمال هذا handoff، تُراجع الشجرة وcommit history، ثم يُرفع الفرع النهائي إلى GitHub ويُفتح أو يُحدّث Pull Request شامل. بعد نجاح CI ومراجعة diff يطلب المالك صراحةً الدمج إلى `main`. لا تُنفذ عملية الدمج تلقائيًا.
