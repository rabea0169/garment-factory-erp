# MASTER_BACKLOG — Garment Factory ERP

> الترتيب ملزم. `P0` يمنع التشغيل الحقيقي، و`P1` مطلوب قبل pilot، و`P2` مطلوب قبل الإطلاق المؤسسي. كل مهمة تُنفذ بفرع وPR وhandoff مستقلين، ولا تُغلق بالترجمة أو البناء وحدهما.

## التسلسل التنفيذي المعتمد بعد GF-0013

هذه القائمة توحّد أرقام المراحل التي تعتمدها الخطة المرجعية مع قائمة `GF-REMAINING`. عناصر `GF-REMAINING` أدناه تبقى أعمال سلامة عابرة للمراحل، ولا تُلغى بمجرد تنفيذ مرحلة وظيفية.

| ID | النطاق المعتمد | الملفات الأساسية | التبعيات | معيار القبول | الحالة |
|---|---|---|---|---|---|
| GF-0014 | الجودة والهالك وربط الفحص بـstageRun وKPI | `backend/src/modules/quality/**`، migration، اختبارات، docs | GF-0013 | conservation، هالك مصنف وتكلفة خادمية، فحص واحد لكل stageRun، KPI حقيقي، PostgreSQL integration | ✅ مدمجة في `main@9e8ffcc` |
| GF-0015 | HR وPayroll: حساب الأجر بالقطعة، السلف، حالات المسودة/الاعتماد، والتدقيق | `backend/src/modules/hr/**`، schema/migration، اختبارات، docs | PR #24 attendance، ADR-0015 | حساب خادمي من الإنتاج والسلف، snapshot للسعر، عدم قبول total من العميل، actor/idempotency، اعتماد غير قابل للتعديل | ✅ draft/approval مدمجان؛ payment posting في PR #54 |
| GF-0016 | المشتريات والاستلام والفاتورة والدفع والمرتجعات | `backend/src/modules/purchasing/**`، inventory/financial posting، schema عند الحاجة، اختبارات، docs | GF-0015 عند ربط الأجور فقط؛ عقد المخزون والمالية | فصل PO عن receipt، الاستلام يغير ledger داخل transaction، تحقق المورد/الخامة/الكمية/التكلفة، payment/return idempotent، قيد مالي متوازن عند اعتماد التكامل | 🟡 receipt/return hardening في PR #52/#54؛ ينتظر الدمج |
| GF-0017 | الشحن والتتبع وإثبات التسليم والإرجاع | `backend/src/modules/shipping/**`، sales/inventory، schema عند الحاجة، اختبارات، docs | عقد المبيعات والمخزون | lifecycle واضح، tracking وشركة/تكلفة شحن، منع شحن أمر غير مؤكد أو كمية غير محجوزة، POD وreturn audit | ✅ منفذة ومختبرة؛ مراجعة duplicate issue موثقة |
| GF-0018 | المحاسبة والخزينة والفترات والقيود متعددة الأسطر وآثار التشغيل | `backend/src/modules/accounting/**`، financial posting، schema/migration، التقارير، اختبارات، docs | GF-0015 إلى GF-0017 حسب مصدر القيود | كل قيد متوازن، period مغلقة تمنع الترحيل، القيد المرحل append-only، source reference، ربط الشراء/البيع/الأجر/الهالك بالتسوية | 🟡 محرك الترحيل قائم؛ payroll payment في PR #54؛ يحتاج اعتماد محاسبي |

لا يبدأ تنفيذ GF-0015 قبل مراجعة PR #24 وقراءة `docs/adr/ADR-0015-hr-payroll-scope-and-calculation.md`. لا تُستبدل عناصر `GF-REMAINING` بإعادة ترقيم صامتة؛ إذا تعارض عنصر داعم مع مرحلة، يسجل التعارض في ADR قبل الكود.

## P0 — الأمن وسلامة البيانات

| ID | المهمة | الملفات الأساسية | التبعيات | معيار القبول | الحالة |
|---|---|---|---|---|---|
| GF-REMAINING-001 | حماية ProductsController الحساسة واختبار RBAC | `backend/src/modules/products/products.controller.ts`، الاختبارات، `docs/API_CONTRACT.md` | خط الأساس `ab8f87d` | كل مسار تعديل/حذف/BOM يحمل دورًا مناسبًا؛ `401` بلا token و`403` للدور الخطأ ونجاح للدور الصحيح، مع تحقق DTO | 🟡 منفذة على فرع `fix/gf-remaining-001-products-rbac`؛ تنتظر PR/CI |
| GF-REMAINING-002 | إصلاح رصيد المستودع في القراءة والـledger | `backend/src/modules/inventory/**`، اختبارات التكامل، `docs/DATA_AND_MIGRATIONS.md` | GF-0007 وGF-REMAINING-001 بعد الدمج والتحقق | حركات في مستودعين تعطي رصيد كل مستودع بدقة؛ لا كتابة رصيد مباشر؛ اختبار PostgreSQL على CI | ✅ مدمجة في `main@c18a2aa`؛ PR #49 وCI أخضر |

## P1 — المسار التشغيلي والـPilot

| ID | المهمة | الملفات الأساسية | التبعيات | معيار القبول | الحالة |
|---|---|---|---|---|---|
| GF-REMAINING-003 | ضمان idempotency لمخرجات المراحل | `backend/src/modules/production/**`، الاختبارات، `docs/API_CONTRACT.md` | GF-0013 وGF-REMAINING-002 بعد الدمج والتحقق | نفس المفتاح والمحتوى يعيدان النتيجة دون أثر ثانٍ؛ payload مختلف يرد `409`؛ replay متزامن آمن | 🟡 PR #50؛ CI أخضر؛ ينتظر الدمج |
| GF-REMAINING-004 | Backend Dashboard/Reports حقيقي | وحدة جديدة محدودة أو `dashboard` حسب البنية الحالية، Flutter، docs، اختبارات | GF-REMAINING-003 بعد الدمج والتحقق؛ تثبيت تعريفات KPI | `/dashboard/stats` محمي ويعيد KPIs من قاعدة البيانات مع فترة ومصدر واضحين؛ لا static/mock fallback | 🟡 منفذة في PR #54؛ تنتظر الدمج والتحقق على main |
| GF-REMAINING-005 | ربط استلام المشتريات بالترحيل المالي | `backend/src/modules/purchasing/**`، financial posting، schema إن لزم، اختبارات | GF-0018 أو قرار transaction موثق | `receiveOrder` يغيّر المخزون ويسجل قيدًا متوازنًا داخل transaction واحدة وبـidempotency؛ rollback عند الفشل | 🟡 مرتجع المورد يملك عكس قيد في PR #54؛ استلام GRN الكامل يحتاج مراجعة منفصلة |
| GF-REMAINING-006 | توسيع اختبارات PostgreSQL الحقيقية وRBAC | `backend/test/**`، CI | GF-REMAINING-001 إلى 005 بحسب المسار | migration deploy وintegration suites على PostgreSQL 16؛ اختبارات 401/403 والتكرار والrollback، مع عدم إخفاء فشل | 🟡 CI يدوي `32949124244`: 7 suites/32 tests integration و61 E2E؛ يلزم إعادة التحقق على main |
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
