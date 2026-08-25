# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الرئيسي | `main` |
| آخر commit على main | `7e73cf7` — دمج PR #9 وتصحيح GF-0012 |
| الإصدار | لا يوجد إصدار مؤسسي معتمد بعد — `pre-release` |
| آخر مهمة مكتملة | `GF-0012` — Pagination موحد لكل قوائم الوحدات وعقد `data/meta` |
| المهمة التالية الرسمية | `GF-0013` — مراحل الإنتاج واستهلاك الخامات والتالف والتكلفة |
| حالة CI على main | أخضر — Run `32876384343` بعد دمج PR #9 |
| حالة قاعدة البيانات | خمس migrations: init، GF-0007، GF-0008، GF-0009، GF-0011 |
| API version | 1.0 — عقد Pagination الموحد مثبت في `API_CONTRACT.md` |

## المهام المكتملة

| المهمة | الوصف | الحالة |
|---|---|---|
| GF-0001..GF-0006 | الحوكمة، fail-closed auth، DTOs، الاختبارات، الأسرار وCI | مكتملة وموجودة في التاريخ |
| GF-0007 | Warehouse، Stock Ledger، idempotency، indexes ومنع الرصيد السالب | مكتملة |
| GF-0008 | BOM versioning، ربط WorkOrder بالـ SKU، واستهلاك الخامات داخل transaction | مكتملة |
| GF-0009 | Purchasing Module، أوامر الشراء، الاستلام والمرتجعات عبر InventoryService | مكتملة ومُدمجة في main |
| GF-0010 | Flutter secure storage، Authorization interceptor، 401، logout، إزالة mock، Flutter CI | مكتملة ومُدمجة في main |
| GF-0011 | المبيعات: منع البيع فوق المتاح، وحساب الإجماليات على الخادم وتأمين الخصم | مكتملة |
| GF-0012 | Pagination موحد لكل قوائم الوحدات مع data/meta وقيود page/limit | مكتملة بعد PR التصحيح |

## نتائج آخر فحص كامل على main بعد GF-0012

| الفحص | النتيجة |
|---|---|
| `npm ci` | ناجح |
| `npx prisma generate` | ناجح |
| `npx prisma validate` | ناجح |
| `npm run typecheck` | ناجح |
| `npm run lint` | ناجح |
| `npm run build` | ناجح |
| Unit tests | 25 suite و120 اختبارًا ناجحة |
| E2E tests | 2 suite و36 اختبارًا ناجحة |

## الفجوات المعروفة قبل الاستخدام المؤسسي

1. Endpoint التقارير `/dashboard/stats` غير منفذ في Backend، ولذلك التقارير تعرض خطأً صريحًا بدل mock.
2. اختبارات E2E الحالية تستخدم Prisma mock ولا تثبت runtime على PostgreSQL حقيقية. يلزم اختبار migrations والتزامن على قاعدة فعلية قبل pilot.
3. `npm audit` يكتشف ثلاث ثغرات عالية عبر `deepmerge-ts` ضمن سلسلة Prisma الحالية، والإصلاح المقترح تلقائيًا يتضمن downgrade breaking لـ Prisma؛ لا يُنفذ `npm audit fix --force` قبل قرار واعٍ وترقية متوافقة.

## المهمة التالية الرسمية

`GF-0013` — مراحل الإنتاج واستهلاك الخامات والتالف:
- نقل أوامر التشغيل بين مراحل محددة.
- تسجيل الكميات المنتجة والمرفوضة والهدر لكل مرحلة.
- ربط الاستهلاك الفعلي للخامات بمراحل التشغيل داخل transactions.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة.

## آخر تحديث توثيقي

تم دمج PR #9 وتثبيت عقد Pagination. أُنشئ تقرير `docs/CURRENT_STATUS_2026-08-25-GF0012.md` وبطاقة `docs/handoffs/HANDOFF-013.md` لتوجيه تنفيذ مراحل الإنتاج.
