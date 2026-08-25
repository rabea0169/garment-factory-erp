# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الرئيسي | `main` |
| آخر commit على main | `b714a61` — دمج GF-0010 Flutter عبر PR #5 |
| الإصدار | لا يوجد إصدار مؤسسي معتمد بعد — `pre-release` |
| آخر مهمة مكتملة | `GF-0010` — Secure Flutter Integration |
| المهمة التالية الرسمية | `GF-0011` — منع البيع فوق المتاح وحساب الإجماليات على الخادم |
| حالة CI على main | أخضر — Run `32855115583` |
| حالة قاعدة البيانات | أربع migrations: init، GF-0007، GF-0008، GF-0009 |
| API version | 1.0 — العقد ما زال يحتاج تثبيتًا قبل الإصدار المؤسسي |

## المهام المكتملة

| المهمة | الوصف | الحالة |
|---|---|---|
| GF-0001..GF-0006 | الحوكمة، fail-closed auth، DTOs، الاختبارات، الأسرار وCI | مكتملة وموجودة في التاريخ |
| GF-0007 | Warehouse، Stock Ledger، idempotency، indexes ومنع الرصيد السالب | مكتملة |
| GF-0008 | BOM versioning، ربط WorkOrder بالـ SKU، واستهلاك الخامات داخل transaction | مكتملة |
| GF-0009 | Purchasing Module، أوامر الشراء، الاستلام والمرتجعات عبر InventoryService | مكتملة ومُدمجة في main عبر PR #4 |
| GF-0010 | Flutter secure storage، Authorization interceptor، 401، logout، إزالة mock، Flutter CI | مكتملة ومُدمجة في main عبر PR #5 |

## ما تم إنجازه في GF-0010

تم نقل تخزين JWT في Flutter من `SharedPreferences` إلى `flutter_secure_storage`، وربط `ApiClient` بإضافة Bearer token مركزيًا ومسح الجلسة عند HTTP 401. أصبح `AuthCubit` مركزيًا على مستوى التطبيق، وأصبح logout يمسح الجلسة قبل إعادة التوجيه إلى login، مع حماية تنقل للمسارات المحمية.

تمت إزالة fallback الوهمي من التقارير؛ عند غياب `/dashboard/stats` أو رجوع payload غير صالح تعرض الواجهة خطأً وزر إعادة المحاولة بدل بيانات مضللة. كما تم تفعيل Flutter quality gate في CI، وتشغيل `flutter pub get` و`flutter analyze` و`flutter test`.

## نتائج آخر فحص كامل

| الفحص | النتيجة |
|---|---|
| `npm ci` | ناجح |
| `npx prisma generate` | ناجح |
| `npx prisma validate` | ناجح |
| `npm run format:check` | ناجح بعد تنسيق `prisma/seed.ts` |
| `npm run typecheck` | ناجح |
| `npm run lint` | ناجح |
| `npm run build` | ناجح |
| Unit tests | 24 suite و121 اختبارًا ناجحة |
| E2E tests | 2 suite و36 اختبارًا ناجحة |
| Flutter CI | `pub get` و`analyze` و`test` ناجحة على GitHub |
| Secret scan | ناجح |

## الفجوات المعروفة قبل الاستخدام المؤسسي

1. مخزون المنتج التام `FinishedGood.quantity` لم يُدمج بعد بصورة كاملة في Stock Ledger متعدد المخازن؛ يجب حسم نموذج `FinishedGoodStock` أو ما يعادله قبل تنفيذ المبيعات المؤسسية.
2. Endpoint التقارير `/dashboard/stats` غير منفذ في Backend، ولذلك التقارير تعرض خطأً صريحًا بدل mock.
3. اختبارات E2E الحالية تستخدم Prisma mock ولا تثبت runtime على PostgreSQL حقيقية. يلزم اختبار migrations والتزامن على قاعدة فعلية قبل pilot.
4. NFC والإشعارات وبعض العمليات الميدانية ما زالت جزئية أو stub، ويجب ربطها بالمسارات التشغيلية عند الوصول إلى GF-0020 أو المهمة المحددة لها.
5. `npm audit` يكتشف ثلاث ثغرات عالية عبر `deepmerge-ts` ضمن سلسلة Prisma الحالية، والإصلاح المقترح تلقائيًا يتضمن downgrade breaking لـ Prisma؛ لا يُنفذ `npm audit fix --force` قبل قرار واعٍ وترقية متوافقة.
6. لا يوجد إصدار أو release candidate أو خطة rollback تنفيذية مجربة على بيئة مؤسسة.

## المهمة التالية الرسمية

`GF-0011` — منطق المبيعات:

- رفض البيع عندما تكون كمية المنتج التام المتاحة غير كافية.
- حساب إجمالي أمر البيع على الخادم دائمًا.
- ربط العملية بمخزون المنتج التام وStock Ledger بعد حسم نموذج الرصيد.
- إضافة اختبارات validation، authorization، insufficient stock، total tampering، وtransaction rollback.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة.
