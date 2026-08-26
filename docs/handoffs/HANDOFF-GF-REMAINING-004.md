# Handoff — GF-REMAINING-004: Real Dashboard and Reports

## 1. Scope and verdict

- **Task ID:** GF-REMAINING-004
- **Verdict:** complete on branch; ready for PR review, with Flutter and PostgreSQL integration verification required in CI.
- **In scope:** إنشاء `GET /dashboard/stats` محمي، تجميع KPIs فعلية من PostgreSQL ضمن `from/to`، إزالة الاعتماد على قوائم رقمية ثابتة في شاشة التقارير، وإضافة بطاقات مخزون ورسوم زمنية قابلة للفراغ.
- **Out of scope:** تصدير PDF/Excel، تقارير مالية رسمية مثل الميزانية وقائمة الدخل، قيود محاسبية جديدة، migration، وتطبيق سطح المكتب.
- **Base:** `origin/main@3d28b0f` بعد دمج PR #50 ونجاح CI.

## 2. Repository state

| Item | Value |
|---|---|
| Working branch | `fix/gf-remaining-004-dashboard-reports` |
| Base SHA | `3d28b0fb933b1ee9c9652c8ef749c2bfef509d9b` |
| Implementation commit | `1bb96c7` — database-backed dashboard and mobile reports |
| Pull Request | pending push and PR creation |
| Merge status | not merged |
| Database impact | no schema or migration change |

## 3. Implementation summary

أضيف `DashboardModule` و`DashboardController` و`DashboardService`. المسار `GET /dashboard/stats` يستفيد من الحماية العامة JWT، ويقبل `from` و`to` اختياريين بصيغة ISO-8601، ويرفض التاريخ غير الصالح أو الفترة المعكوسة بـ400.

مصدر `sales` هو مجموع `SalesOrder.totalAmount` للطلبات غير الملغاة مجمعة حسب شهر الإنشاء. مصدر `production` هو مجموع `DailyProduction.piecesCount` حسب اليوم. مصدر `topWorkers` هو أعلى خمسة عمال حسب الإنتاج داخل الفترة. مصدر `inventory` هو جداول الخامات والمخزون التام مع عدّ النقص من `currentStock <= minStockLevel`. الاستعلامات bounded بالفترة ولا توجد mock/static fallback.

تم تعديل `ReportsCubit` ليتحقق من shape الاستجابة ووجود period/amount/pieces وinventory قبل عرضها. تم تعديل `ReportsScreen` لعرض بطاقات المخزون، التسميات الزمنية الفعلية، حالات عدم وجود البيانات، وإعادة المحاولة/السحب للتحديث.

## 4. Tests and documentation

- `backend/src/modules/dashboard/dashboard.service.spec.ts`: مصادر KPIs والفترة المعكوسة.
- `backend/src/modules/dashboard/dashboard.controller.spec.ts`: تمرير query.
- `backend/test/dashboard.integration-spec.ts`: PostgreSQL حقيقية بطلب بيع وإنتاج عامل ضمن فترة محددة.
- `mobile_app/lib/features/reports/**`: validation وعرض contract الجديد.
- `docs/API_CONTRACT.md`: endpoint وحقول response وتعريفات KPIs.
- `backend/test/INTEGRATION_TESTS.md`: توثيق integration scenario.

## 5. Verification evidence

| Gate | Command or run | Result | Notes |
|---|---|---|---|
| Prisma format/validate/generate | `npx prisma format`, `npx prisma validate`, `npx prisma generate` | PASS | لا تغييرات schema |
| Backend format | `npm run format:check` | PASS | كل ملفات backend منسقة |
| Typecheck | `npm run typecheck` | PASS | لا أخطاء TypeScript |
| Lint | `npm run lint` | PASS | لا أخطاء |
| Build | `npm run build` | PASS | Nest build ناجح |
| Unit tests | `npm test -- --runInBand` | PASS | 32 suites / 191 tests |
| E2E tests | `npm run test:e2e -- --runInBand` | PASS | 3 suites / 60 tests |
| Integration tests | `npm run test:integration -- --runInBand` | SKIPPED LOCALLY | 8 suites / 30 tests؛ لا `GF_INTEGRATION_DATABASE_URL` |
| Flutter pub/analyze/test | `flutter pub get`, `flutter analyze`, `flutter test` | UNAVAILABLE LOCALLY | أوامر Flutter/Dart غير مثبتة في sandbox؛ CI required |
| Diff check | `git diff --check` | PASS | no whitespace errors |
| Secret scan | required on PR CI | PENDING | لا أسرار مضافة معروفة |

## 6. Known limitations and risks

أرقام inventory هي snapshot عام وليست تقرير قيمة مخزون مالي؛ لا ينبغي استخدامها كبديل عن ledger أو قائمة مالية. مبيعات Dashboard تستخدم `totalAmount` للطلبات غير الملغاة، ولا تفصل المدفوع والمتبقي أو VAT في هذه المهمة. الإنتاج يعتمد DailyProduction، ولذلك لا يعرض مخرجات مراحل الإنتاج التي لم تُسجل في ذلك الجدول.

الاختبارات التكاملية وFlutter لم تُشغّل محلياً بسبب غياب PostgreSQL/Docker وFlutter/Dart. لا تُغلق المرحلة نهائياً قبل نجاح CI، بما في ذلك الاختبار الجديد على PostgreSQL وتحليل Flutter واختباراته.

الاستعلامات الأربع تُنفذ بالتوازي داخل الطلب الواحد؛ يجب مراقبة pool saturation في مهمة الأداء GF-REMAINING-007 قبل رفع حد الاستخدام أو إضافة caching.

## 7. Next agent instructions

بعد دمج هذا الفرع والتحقق من main، المهمة التالية هي `GF-REMAINING-005`: ربط استلام المشتريات بالترحيل المالي داخل transaction واحدة مع idempotency وقيد متوازن. ابدأ من `docs/PROJECT_STATE.md`, `docs/MASTER_BACKLOG.md`, `docs/API_CONTRACT.md`, `backend/src/modules/purchasing/**`, و`backend/src/core/financial/**`.
