# HANDOFF-SPRINT1-NAVIGATION-UX: التنقل وتجربة الاستخدام وContact Picker وإنشاء العميل

## 1. Scope and verdict

- **Task ID:** Sprint 1 — navigation/UX وContact Picker وربط إنشاء العميل.
- **Verdict:** complete for the scoped slice; **not a production-readiness certification**.
- **In scope:** إصلاح سجل الرجوع والتنقل من Dashboard، حالات UX المشتركة، اختيار جهة اتصال واحدة وقراءة بياناتها، ربط نموذج إنشاء العميل بـ`POST /sales/customers`، وحفظ البريد الإلكتروني.
- **Out of scope:** إنشاء Supplier API، إنشاء Worker API، ربط Contact Picker بنماذج الموردين والموظفين، إنشاء أمر بيع من الواجهة، قبول ميداني على جهاز Android/iOS، وإكمال دورات ERP الأخرى.
- **Dependencies:** Backend `POST /sales/customers`، عمود `Customer.email` الموجود مسبقًا، صلاحية قراءة جهات الاتصال على Android/iOS، وبيئة Railway التجريبية عند تشغيل التطبيق.

## 2. Repository state

| Item | Value |
|---|---|
| Base branch | `origin/main` |
| Base SHA | `bd3c02eefc404a2110c60c31df3ea405214186e6` |
| Working branch | `feat/sprint1-navigation-ux` |
| Head SHA | يُسجل في رسالة التسليم النهائية بعد commit/push |
| Pull Request | سيُفتح بعد commit وpush؛ لا يوجد PR وقت إنشاء هذا handoff |
| Merge status | غير مدمج؛ الدمج يتطلب موافقة صريحة من المستخدم |
| CI run | غير متاح قبل فتح PR؛ يجب انتظار CI بعد الرفع |

## 3. Implementation

### Backend

تمت إضافة `email?: string` إلى `CreateCustomerDto` وتمريره إلى `SalesService.createCustomer` وحفظه في Customer. أضيف اختبار سلوكي يثبت أن payload إنشاء العميل يحفظ الاسم والهاتف والبريد والعنوان. لم تُضف migration لأن عمود البريد موجود في schema الحالية.

### Mobile client

أصبح `DashboardScreen` Stateful ويستخدم `PopScope` مع `DoubleBackExitGuard`: الضغطة الأولى تعرض رسالة تأكيد، والضغطة الثانية خلال ثانيتين تطلب خروج التطبيق. تحولت انتقالات Drawer وFAB من `go` إلى `push`، مع تجنب push للمسار الحالي. أضيفت مكونات `AppLoadingView` و`AppEmptyView` و`AppErrorView` و`AppAsyncButton` و`confirmAppAction`.

أضيف `ContactImportService` لاختيار جهة اتصال واحدة وطلب إذن القراءة وتطبيع الاسم والهاتف والبريد والعنوان. عند غياب `displayName` يُدمج prefix/first/middle/last/suffix. أضيف `ContactImportButton` مع loading، الإلغاء، رسائل الرفض، ورابط الإعدادات عند الرفض الدائم. أضيف `READ_CONTACTS` إلى Android و`NSContactsUsageDescription` إلى iOS.

أعيد بناء `SalesScreen` حول نموذج إنشاء عميل حقيقي، مع validation، منع الإرسال المكرر، حالة حفظ واضحة، Contact Picker، استدعاء API، وعدم إغلاق الحوار عند فشل الطلب. تم استخراج الحوار إلى Stateful widget لضمان التخلص الآمن من TextEditingController. أضيف حقن اختياري لـSalesCubit وContactImportService لأغراض الاختبار.

### الملفات المتغيرة

- `backend/src/modules/sales/dto/create-customer.dto.ts`
- `backend/src/modules/sales/sales.service.ts`
- `backend/src/modules/sales/sales.service.spec.ts`
- `docs/API_CONTRACT.md`
- `docs/PROJECT_STATE.md`
- `docs/handoffs/HANDOFF-SPRINT1-NAVIGATION-UX.md`
- `mobile_app/android/app/build.gradle.kts`
- `mobile_app/android/app/src/main/AndroidManifest.xml`
- `mobile_app/ios/Runner/Info.plist`
- `mobile_app/lib/core/contacts/contact_import_service.dart`
- `mobile_app/lib/core/navigation/double_back_exit_guard.dart`
- `mobile_app/lib/core/widgets/app_feedback.dart`
- `mobile_app/lib/core/widgets/contact_import_button.dart`
- `mobile_app/lib/features/dashboard/presentation/screens/dashboard_screen.dart`
- `mobile_app/lib/features/sales/presentation/cubit/sales_cubit.dart`
- `mobile_app/lib/features/sales/presentation/screens/sales_screen.dart`
- `mobile_app/pubspec.yaml`
- `mobile_app/test/app_navigation_test.dart`
- `mobile_app/test/contact_import_service_test.dart`
- `mobile_app/test/double_back_exit_guard_test.dart`
- `mobile_app/test/sales_screen_test.dart`

**Migrations:** لا توجد migration. تغيير Gradle كان ضروريًا لإكمال Android build: `compileSdk = 37`، تفعيل core library desugaring، وإضافة `desugar_jdk_libs:2.1.5`.

## 4. Contract changes

يقبل `POST /sales/customers` الآن body بالشكل التالي:

```json
{
  "name": "مصنع النور",
  "phone": "+201001234567",
  "email": "sales@example.com",
  "address": "القاهرة"
}
```

`name` إلزامي، والحقول الأخرى اختيارية كنصوص. المسار محمي بـJWT ومتاح لدوري `CASHIER` و`GENERAL_MANAGER`. الحقول غير المعروفة مرفوضة وفق قواعد DTO العامة. لا يتغير response shape أو pagination. العميل يرسل البريد فقط عند وجوده، ولا يدّعي نجاح الحفظ إلا بعد اكتمال POST ثم إعادة تحميل القائمة.

## 5. Verification evidence

| Gate | Command or run | Result | Notes |
|---|---|---|---|
| Flutter dependency resolution | `flutter test --no-pub` بعد وجود lockfile | PASS | lockfile يحتوي `flutter_contacts`؛ لم يتغير diff للـlockfile |
| Prisma generate | `npx prisma generate` | PASS | Prisma Client 7.9.1 |
| Backend format | `npm run format:check` | PASS | جميع الملفات منسقة |
| Backend typecheck | `npm run typecheck` | PASS | لا أخطاء |
| Backend lint | `npm run lint` | PASS with 6 pre-existing warnings | لا أخطاء؛ التحذيرات في payroll/inventory specs القديمة |
| Backend build | `npm run build` | PASS | `prebuild` شغّل Prisma generate |
| Backend unit tests | `npm test -- --runInBand` | PASS — 33 suites / 219 tests | يتضمن اختبار البريد الجديد |
| Backend E2E tests | `npm run test:e2e -- --runInBand` | PASS — 3 suites / 64 tests | mock-backed API E2E |
| Flutter analyze | `flutter analyze --no-fatal-infos` | PASS | لا issues؛ Flutter يعدل analysis_options وملفات generated تلقائيًا وتمت استعادتها من diff |
| Flutter tests | `flutter test --no-pub` | PASS — 17 tests | يتضمن navigation, controller, contact mapping, customer form |
| Android APK | `flutter build apk --debug --target-platform android-arm64 --dart-define=API_BASE_URL=https://garment-factory-erp-production.up.railway.app` مع Gradle منخفض الذاكرة | PASS | الناتج Debug؛ لا يثبت القبول على جهاز فعلي |
| PostgreSQL integration | `npm run test:integration:required -- --runInBand` | NOT RUN | `GF_INTEGRATION_DATABASE_URL` غير مضبوط؛ لا توجد قاعدة اختبار منفصلة |
| iOS build | — | NOT RUN | لا توجد بيئة macOS/Xcode في sandbox |
| Secret/diff scan | `git diff --check` وgrep لأنماط الأسرار | PASS | لا أسرار أو tokens أو build-generated files مقصودة في النطاق |

## 6. Known limitations and risks

هذا التسليم لا يثبت عمل Contact Picker على هاتف فعلي، ولا يثبت إعدادات الأذونات على كل إصدارات Android/iOS. كما أن APK الناتج Debug وليس إصدارًا موقّعًا للنشر.

لا توجد اختبارات PostgreSQL تكاملية محلية في هذه الجولة، لذلك لا ينبغي تفسير نجاح الاختبارات mock-backed أو E2E على أنه إثبات لقاعدة بيانات Railway. يجب استخدام قاعدة اختبار منفصلة وتشغيل migrations قبل أي اعتماد تشغيلي.

توجد ستة تحذيرات lint قديمة في `payroll.service.spec.ts` و`inventory.service.spec.ts` فقط. لا توجد أخطاء lint جديدة في ملفات Sprint 1.

لا توجد واجهة حفظ حقيقية للموردين أو الموظفين لأن Backend لا يوفر حاليًا endpoints إنشاء موثوقة لهما. يجب عدم إضافة حفظ وهمي في السبرنت التالي.

بيئة Railway الحالية تجريبية؛ يجب تغيير أو حذف الحساب التجريبي قبل أي استخدام حقيقي، وعدم وضع كلمات مرور أو access tokens في Git أو سجلات CI.

## 7. Next agent instructions

- **Next task:** إضافة Supplier master-data APIs وWorker create API، ثم ربط ContactImportButton بنماذج المورد والموظف.
- **First files to read:** `docs/PROJECT_STATE.md`, `docs/API_CONTRACT.md`, `docs/handoffs/HANDOFF-SPRINT1-NAVIGATION-UX.md`, schema Supplier/Worker، controllers/services/DTOs الخاصة بـpurchasing وhr، وCI workflows.
- **Baseline to verify:** `git fetch origin --prune` ثم تأكيد أن PR Sprint 1 مبني على `bd3c02eefc404a2110c60c31df3ea405214186e6` وأن CI للفرع أخضر قبل بدء السبرنت التالي.
- **Acceptance criteria:** DTOs مع validation وRBAC، GET/POST APIs حقيقية، اختبارات unit/E2E وPostgreSQL عند توافر قاعدة اختبار، توثيق API، ثم إعادة استعمال Contact Picker دون تخزين محلي أو صلاحية WRITE_CONTACTS.
- **Must not change:** لا تدمج إلى `main` دون موافقة صريحة، لا تعيد stash تغييرات APK المحلية كاملًا، لا تقبل actor IDs أو secrets من body، ولا تبنِ وظائف UI تدّعي نجاحًا قبل اكتمال API.
