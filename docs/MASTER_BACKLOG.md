# MASTER_BACKLOG — السجل المرتب بالأولويات

> الترتيب ملزم. كل مهمة تُنفذ وفق `AI_WORKFLOW.md` وتُغلق بـ handoff. `P0` = يمنع أي تشغيل حقيقي · `P1` = قبل pilot · `P2` = قبل الإطلاق المؤسسي.

## P0 — تثبيت وأمان (المرحلة 0–1)

| ID | المهمة | الملفات الأساسية | معيار القبول | الحالة |
|---|---|---|---|---|
| GF-0001 | Baseline + Governance + CI | docs/**، .env.example، .gitignore، ci.yml | 13 ملف docs + CI يشتغل + baseline موثق | ✅ منجزة |
| GF-0002 | **Fail-closed auth + حماية كل المسارات** | auth/**، app.module.ts، main.ts، prisma.service.ts، seed.ts، docker-compose.yml | 401/403 مختبرة، لا fallback لسر، DB من env فقط، CORS من env | ⏳ التالية |
| GF-0003 | إصلاح الاختبارات + lint | backend/src/**/*.spec.ts، test/** | 19/19 suites تمر أو تستبدل بسلوكية، lint صفر errors | ⏳ |
| GF-0004 | DTOs لكل مسارات الكتابة | controllers + dto/ | صفر `@Body() any`، 400 على مدخل غير صالح | ⏳ |
| GF-0005 | CurrentUser من الجلسة + إزالة userId من body | sales/accounting/production services | الحقول تُستخرج من JWT، تجاهل قيم العميل | ⏳ |
| GF-0006 | إصلاح docker-compose (healthcheck/env/ربط داخلي) + README الصادق | docker-compose.yml، README.md | healthcheck يمر، لا كلمات مرور ثابتة، README يطابق الواقع | ⏳ |

## P1 — أساس المجال والمخزون (المرحلة 2–3)

| ID | المهمة | الملفات | معيار القبول |
|---|---|---|---|
| GF-0007 | Domain Foundation: Warehouse + Stock Ledger + idempotency + indexes | schema.prisma + migration + inventory | كل حركة عبر ledger، رصيد قابل للتدقيق، migration + rollback موثقة |
| GF-0008 | BOM versions + ربط WorkOrder بالـ variant/SKU | schema.prisma + production | أمر تشغيل يستهدف SKU + إصدار BOM مجمد |
| GF-0009 | Inventory Application Service (receive/issue/reserve/transfer/adjust/waste/return/count) | inventory service | لا تعديل رصيد مباشر، transaction إلزامية، اختبارات تزامن |
| GF-0010 | Flutter: secure storage + auth interceptor + 401 handling + إزالة mock | api_client.dart، auth/**، reports_cubit.dart | لا mock صامت، انتهاء الجلسة يعيد للدخول |
| GF-0011 | منع البيع فوق المتاح + حساب الإجماليات في الخادم | sales service | فشل بيع غير المتاح، الإجمالي من الخادم دائمًا |
| GF-0012 | Pagination لكل القوائم | controllers | حدود افتراضية + استجابة paged |

## P2 — الإنتاج والجودة والمالية (المرحلة 4–7)

| ID | المهمة | معيار القبول |
|---|---|---|
| GF-0013 | State machine لأوامر التشغيل + استهلاك الخامات + تكلفة الإنتاج | انتقالات مقيدة، إتمام مرة واحدة، تكلفة موثقة |
| GF-0014 | الجودة: checked=passed+rejected + هالك مصنف بتكلفة | KPIs جودة حقيقية |
| GF-0015 | HR: رواتب من قواعد الخادم + snapshot للأسعار + اعتماد ودفع | لا راتب من الهاتف |
| GF-0016 | المشتريات: فصل الأمر عن الاستلام | الاستلام وحده يغير المخزون |
| GF-0017 | الشحن: lifecycle + منع شحن أمر غير مؤكد | transitions محكومة |
| GF-0018 | Double-entry journal متعدد الأسطر + fiscal periods + منع حذف المرحل | قيود متوازنة مربوطة بالمصادر |
| GF-0019 | Dashboard/Reports backend حقيقي + إزالة آخر mock | KPI بتعريف ومصدر وفترة |
| GF-0020 | Flutter UX الكامل (حالات الشاشات، offline queue محدودة، barcode) | المسارات الذهبية من الهاتف |
| GF-0021 | QA/Security/Performance (rate limit، helmet، npm audit، RBAC matrix tests) | بوابة G9 |
| GF-0022 | Pilot + backup/restore + تدريب + Go/No-Go | بوابة G10–G11 |

## قرارات مؤجلة (تحتاج ADR قبل التنفيذ)
- ADR-0003: مصير الأحداث المالية (outbox مقابل transaction).
- ADR-0004: توحيد المنفذ 3005.
- سياسة التكلفة (Weighted Average مقابل Standard).
- سياسة الرصيد السالب في البيع.
- تعدد الشركات/الفروع (tenancy) قبل المرحلة 7.
