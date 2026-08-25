# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الرئيسي | `main` |
| آخر commit على main | `b714a61` — دمج GF-0010 Flutter عبر PR #5 |
| الإصدار | لا يوجد إصدار مؤسسي معتمد بعد — `pre-release` |
| آخر مهمة مكتملة | `GF-0011` — المبيعات: منع البيع فوق المتاح وحساب الإجماليات خادمياً |
| المهمة التالية الرسمية | `GF-0012` — Pagination لكل القوائم |
| حالة CI على main | أخضر — Run `32855115583` |
| حالة قاعدة البيانات | خمس migrations: init، GF-0007، GF-0008، GF-0009، GF-0011 |
| API version | 1.0 — العقد ما زال يحتاج تثبيتًا قبل الإصدار المؤسسي |

## المهام المكتملة

| المهمة | الوصف | الحالة |
|---|---|---|
| GF-0001..GF-0006 | الحوكمة، fail-closed auth، DTOs، الاختبارات، الأسرار وCI | مكتملة وموجودة في التاريخ |
| GF-0007 | Warehouse، Stock Ledger، idempotency، indexes ومنع الرصيد السالب | مكتملة |
| GF-0008 | BOM versioning، ربط WorkOrder بالـ SKU، واستهلاك الخامات داخل transaction | مكتملة |
| GF-0009 | Purchasing Module، أوامر الشراء، الاستلام والمرتجعات عبر InventoryService | مكتملة ومُدمجة في main |
| GF-0010 | Flutter secure storage، Authorization interceptor، 401، logout، إزالة mock، Flutter CI | مكتملة ومُدمجة في main |
| GF-0011 | المبيعات: منع البيع فوق المتاح، وحساب الإجماليات على الخادم وتأمين الخصم | مكتملة |

## نتائج آخر فحص كامل للمبيعات (GF-0011)

| الفحص | النتيجة |
|---|---|
| `npm ci` | ناجح |
| `npx prisma generate` | ناجح |
| `npx prisma validate` | ناجح |
| `npm run typecheck` | ناجح |
| `npm run lint` | ناجح |
| `npm run build` | ناجح |
| Unit tests | 24 suite و118 اختبارًا ناجحة |
| E2E tests | 2 suite و36 اختبارًا ناجحة |

## الفجوات المعروفة قبل الاستخدام المؤسسي

1. Endpoint التقارير `/dashboard/stats` غير منفذ في Backend، ولذلك التقارير تعرض خطأً صريحًا بدل mock.
2. اختبارات E2E الحالية تستخدم Prisma mock ولا تثبت runtime على PostgreSQL حقيقية. يلزم اختبار migrations والتزامن على قاعدة فعلية قبل pilot.
3. `npm audit` يكتشف ثلاث ثغرات عالية عبر `deepmerge-ts` ضمن سلسلة Prisma الحالية، والإصلاح المقترح تلقائيًا يتضمن downgrade breaking لـ Prisma؛ لا يُنفذ `npm audit fix --force` قبل قرار واعٍ وترقية متوافقة.

## المهمة التالية الرسمية

`GF-0012` — Pagination لكل القوائم:
- وضع حدود افتراضية (مثلاً 20 عنصراً للصفحة).
- استجابة مخصصة تحتوي على العدد الكلي، الصفحة الحالية، وغيرها.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة.
