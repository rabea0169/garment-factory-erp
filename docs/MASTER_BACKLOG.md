# MASTER_BACKLOG — Garment Factory ERP

> الترتيب ملزم. `P0` يمنع التشغيل الحقيقي، و`P1` مطلوب قبل pilot، و`P2` مطلوب قبل الإطلاق المؤسسي. كل مهمة تُنفذ بفرع وPR وhandoff مستقلين، ولا تُغلق بالترجمة أو البناء وحدهما.

## P0 — الأمن وسلامة البيانات

| ID | المهمة | الملفات الأساسية | التبعيات | معيار القبول | الحالة |
|---|---|---|---|---|---|
| GF-REMAINING-001 | حماية ProductsController الحساسة واختبار RBAC | `backend/src/modules/products/products.controller.ts`، الاختبارات، `docs/API_CONTRACT.md` | خط الأساس `d15b2ef` | كل مسار تعديل/حذف/BOM يحمل دورًا مناسبًا؛ `401` بلا token و`403` للدور الخطأ ونجاح للدور الصحيح، مع تحقق DTO | ⏳ التالية |
| GF-REMAINING-002 | إصلاح رصيد المستودع في القراءة والـledger | `backend/src/modules/inventory/**`، اختبارات التكامل، `docs/DATA_AND_MIGRATIONS.md` | GF-0007 وGF-REMAINING-001 | حركات في مستودعين تعطي رصيد كل مستودع بدقة؛ لا كتابة رصيد مباشر؛ اختبار PostgreSQL على CI | 📅 مخططة |

## P1 — المسار التشغيلي والـPilot

| ID | المهمة | الملفات الأساسية | التبعيات | معيار القبول | الحالة |
|---|---|---|---|---|---|
| GF-REMAINING-003 | ضمان idempotency لمخرجات المراحل | `backend/src/modules/production/**`، الاختبارات، `docs/API_CONTRACT.md` | GF-0013 وGF-REMAINING-001 | نفس المفتاح والمحتوى يعيدان النتيجة دون أثر ثانٍ؛ payload مختلف يرد `409`؛ replay متزامن آمن | 📅 مخططة |
| GF-REMAINING-004 | Backend Dashboard/Reports حقيقي | وحدة جديدة محدودة أو `dashboard` حسب البنية الحالية، Flutter، docs، اختبارات | تثبيت تعريفات KPI وGF-REMAINING-002 | `/dashboard/stats` محمي ويعيد KPIs من قاعدة البيانات مع فترة ومصدر واضحين؛ لا static/mock fallback | 📅 مخططة |
| GF-REMAINING-005 | ربط استلام المشتريات بالترحيل المالي | `backend/src/modules/purchasing/**`، financial posting، schema إن لزم، اختبارات | GF-0018 أو قرار transaction موثق | `receiveOrder` يغيّر المخزون ويسجل قيدًا متوازنًا داخل transaction واحدة وبـidempotency؛ rollback عند الفشل | 📅 مخططة |
| GF-REMAINING-006 | توسيع اختبارات PostgreSQL الحقيقية وRBAC | `backend/test/**`، CI | GF-REMAINING-001 إلى 005 بحسب المسار | migration deploy وintegration suites على PostgreSQL 16؛ اختبارات 401/403 والتكرار والrollback، مع عدم إخفاء فشل | 📅 مخططة |
| GF-REMAINING-007 | اختبار الأداء القابل للتكرار | `backend/test/performance/**` أو أداة معتمدة، CI/docs | استقرار API وبيئة PostgreSQL | قياس p95 وthroughput وpool saturation لحمل موثق؛ العتبات تعتمد قرارًا لا تخمينًا | 📅 مخططة |

## P2 — تجربة الهاتف والإطلاق

| ID | المهمة | الملفات الأساسية | التبعيات | معيار القبول | الحالة |
|---|---|---|---|---|---|
| GF-REMAINING-008 | ربط barcode وإكمال حالات Flutter وoffline المحدودة | `mobile_app/lib/features/inventory/**`، `core/network/**`، اختبارات Flutter | عقد API مستقر وFlutter CI | زر المسح يفتح scanner حقيقيًا ويرجع SKU؛ حالات loading/empty/error/401/offline مختبرة؛ لا mock صامت | 📅 مخططة |
| GF-REMAINING-009 | backup/restore وpilot وGo/No-Go | `docs/RELEASE_GATES.md`، runbooks، CI/operations | GF-REMAINING-001 إلى 008 | rehearsal موثق للنسخ والاستعادة، reconciliation على المسارات الذهبية، تدريب، monitoring، وقرار إطلاق موقع | 📅 مخططة |

## الأرشيف المكتمل

| المهمة | النطاق | المرجع |
|---|---|---|
| GF-0001..GF-0006 | الحوكمة والأمان وDTOs وCI | التاريخ المدمج حتى `02ec9cb` |
| GF-0007..GF-0012 | المخازن والledger وBOM والمبيعات وpagination | التاريخ المدمج حتى `7e73cf75` |
| GF-0013 | دورة الإنتاج واستهلاك الخامات والتكلفة | `cfe3254` وPR20 |
| GF-0020 الجزئي | طبقات Flutter للإنتاج | PR19 و`d15b2ef` |

## قرارات قبل المهام التابعة

تحتاج المهام المالية والتقارير قرارًا موثقًا حول حدود transaction ومصدر KPI. لا يُضاف `companyId` أو tenancy أو migration جديدة إلا بمهمة مستقلة وADR وخطة backfill/rollback. لا يُنفذ `npm audit fix --force` دون مراجعة توافق Prisma والـlockfile.
