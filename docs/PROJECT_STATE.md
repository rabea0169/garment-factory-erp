# PROJECT_STATE — Garment Factory ERP

> هذا الملف هو مصدر الحقيقة لحالة المشروع. يجب تحديثه في نفس commit كلما أُغلقت مهمة، ولا يبدأ أي نموذج مهمة جديدة قبل قراءته.

## الحالة الحالية

| البند | القيمة |
|---|---|
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الأساسي المرجعي | `main` |
| خط أساس التنفيذ | `main@d15b2ef` — دمج PR20 ثم PR19، وCI الأخضر Run [32920719412](https://github.com/rabea0169/garment-factory-erp/actions/runs/32920719412) |
| فرع العمل الحالي | `maintenance/gf-state-reconcile` — مزامنة وثائق غير مدمجة |
| الإصدار | `pre-release`؛ غير معتمد لتشغيل مؤسسي |
| آخر مرحلة مكتملة على main | الأساس التشغيلي لـ GF-0013 مع إصلاحات PR20 وطبقات Flutter الإنتاجية من PR19 |
| حالة CI على main | ناجحة على `d15b2ef`؛ لا تعني اكتمال المسارات التجارية أو الجاهزية المؤسسية |
| حالة قاعدة البيانات | Migrations additive مدمجة حتى خط الأساس الحالي؛ لا تغيير schema بلا migration واختبار restore/rollback |
| إصدار API | `1.0`؛ عقد المسارات الحالية موثق في `docs/API_CONTRACT.md` |
| قاعدة البيانات المحلية | لا يوجد PostgreSQL/Docker أو Flutter SDK في بيئة الفحص الحالية؛ اختبارات التكامل وFlutter تعتمد على CI عند الحاجة |

## الفحوص المكررة على خط الأساس

| الفحص | النتيجة | الدليل أو القيد |
|---|---|---|
| `npm ci --no-audit --no-fund` | ناجح | ثُبتت 884 حزمة في `backend` |
| `npx prisma validate` | ناجح | محليًا على `main@d15b2ef` |
| `npx prisma generate` | ناجح | Prisma Client `7.9.1` |
| `npm run format:check` | ناجح | كل الملفات مطابقة |
| `npm run typecheck` | ناجح | لا أخطاء TypeScript |
| `npm run lint` | ناجح | لا أخطاء ESLint |
| `npm run build` | ناجح | Nest build ناجح |
| `npm test -- --runInBand` | ناجح | `27 suites / 136 tests` |
| `flutter analyze` و`flutter test` | غير متاح محليًا | Flutter SDK غير مثبت؛ آخر تحقق ناجح في CI حسب Run `32920719412` |
| PostgreSQL integration محليًا | غير متاح | لا PostgreSQL/Docker في البيئة؛ لا تُحسب نتيجة نجاح |

## المنفذ فعليًا

| النطاق | الحالة |
|---|---|
| GF-0001..GF-0006 | الحوكمة، fail-closed auth، DTOs، CI والأسرار مدمجة |
| GF-0007..GF-0012 | المخازن وStock Ledger وBOM والمبيعات وpagination مدمجة |
| GF-0013 | منطق مراحل الإنتاج واستهلاك الخامات والتكلفة ومخزون المنتج التام مدمج، مع إصلاحات PR20 للتحقق النهائي |
| PR19 / GF-0020 الجزئي | طبقات Flutter للإنتاج مدمجة؛ لا يعني اكتمال UX أو barcode أو offline queue |

## الفجوات المثبتة قبل التوسع

| الأولوية | الفجوة | الأثر | المهمة المقترحة |
|---|---|---|---|
| P0 | بعض مسارات `ProductsController` لا تحمل `@Roles()` مناسبًا | تصعيد صلاحيات لتعديل المنتجات وBOM من مستخدم موثق | GF-REMAINING-001 |
| P0 | `getMaterialBalanceByWarehouse` يقرأ snapshot عالميًا على أنه رصيد مستودع | تقارير مخزون غير صحيحة عند تعدد المستودعات | GF-REMAINING-002 |
| P1 | `recordStageOutput` يحتاج ضمان idempotency صريحًا | احتمال تكرار أثر مخرج المرحلة عند retry | GF-REMAINING-003 |
| P1 | لا يوجد Backend endpoint لـ`/dashboard/stats` | شاشة التقارير/لوحة التحكم لا تعمل على بيانات حقيقية | GF-REMAINING-004 |
| P1 | استلام المشتريات لا ينشئ قيدًا ماليًا تلقائيًا | انفصال المخزون عن الأستاذ العام والذمم | GF-REMAINING-005 |
| P1 | اختبارات E2E الأساسية mock-backed | لا تثبت كل المسارات على PostgreSQL الحقيقي | GF-REMAINING-006 |
| P1 | غياب اختبار أداء قابل للتكرار | لا توجد أدلة p95 أو pool saturation | GF-REMAINING-007 |
| P2 | barcode في Flutter غير موصول بالكامل وoffline queue غير موجودة | المسارات الميدانية غير مكتملة | GF-REMAINING-008 |
| P2 | backup/restore وpilot وGo/No-Go غير منفذة | لا جاهزية إطلاق مؤسسي | GF-REMAINING-009 |

## المهمة التالية الرسمية

`GF-REMAINING-001`: حماية كل مسارات ProductsController الحساسة بـ`@Roles()` واختبار `401/403/success`، ثم تحديث عقد API. لا يبدأ إصلاح الرصيد أو التقارير أو الترحيل المالي قبل اجتياز بوابة هذه المهمة ومراجعة diff.

## بروتوكول التسليم

كل مهمة يجب أن تحتوي على migration عند الحاجة، اختبارات سلوكية، تحديثًا لهذا الملف، بطاقة handoff، ونتائج `format:check` و`typecheck` و`lint` و`build` وunit وE2E وCI. لا تُعتبر المهمة مكتملة لمجرد نجاح build أو وجود شاشة واجهة، ولا يُعتبر PR مدمجًا قبل تنفيذ الدمج بطلب صريح والتحقق من CI على `main`.

## آخر تحديث توثيقي

تمت مزامنة هذا الملف على فرع `maintenance/gf-state-reconcile` بعد التحقق من `main@d15b2ef`، ودمج PR20 وPR19، وإعادة تشغيل بوابات Backend محليًا. لا تُعتبر المزامنة مدمجة حتى تُراجع وتُرفع في PR مستقل.
