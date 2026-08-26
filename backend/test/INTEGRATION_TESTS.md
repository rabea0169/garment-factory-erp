# GF-0013 Integration Tests

تختبر `production-workflow.integration-spec.ts` دورة الإنتاج على PostgreSQL حقيقية، ولا تستبدل `PrismaService` بـ mock.

## المتطلبات

يجب توفير قاعدة PostgreSQL مخصصة للاختبار، وتطبيق كل migrations بما فيها GF-0013. لا تستخدم قاعدة تطوير أو إنتاج تحتوي على بيانات مهمة؛ الاختبارات تنفذ `TRUNCATE ... CASCADE` قبل كل حالة.

```bash
export PGPASSWORD='<database-password>'
export GF_INTEGRATION_DATABASE_URL='postgresql://<database-user>@<database-host>:<database-port>/<database-name>'
export DATABASE_URL="$GF_INTEGRATION_DATABASE_URL"
export GF_REQUIRE_INTEGRATION=1
cd backend
npx prisma migrate deploy
npm run test:integration:required
```

عند عدم وجود `GF_INTEGRATION_DATABASE_URL` تُعلَّم suite كـ skipped في الأمر التطويري الاختياري `npm run test:integration`، حتى لا تتصل الاختبارات بقاعدة غير معروفة. أما `npm run test:integration:required` فيضبط `GF_REQUIRE_INTEGRATION=1` ويفشل صراحة برسالة واضحة إذا غاب URL؛ ويستخدمه CI بعد تشغيل PostgreSQL service، لذلك لا يُقبل نجاح متجاوز بصمت.

## السيناريوهات

تغطي الاختبارات الانتقال المتسلسل من البداية إلى `CUTTING` ثم `SEWING`، رفض القفز إلى `PACKING`، منع الانتقال قبل إكمال المرحلة الحالية، وإعادة الطلب نفسه عبر idempotency دون إنشاء transition إضافي.

كما تثبت حفظ split الكمية وفق `inputQty = acceptedQty + rejectedQty + wasteQty`، وتتحقق من استهلاك الخامة داخل transaction، وحساب `totalCost` و`wasteCost` من Weighted Average، وإعادة تشغيل العملية دون ledger إضافي، وrollback الكامل عند عدم كفاية الرصيد.

يضيف `inventory-warehouse.integration-spec.ts` سيناريو GF-REMAINING-002: استلام وصرف خامة في مستودعين، التحقق من أن `SUM(quantityDelta)` يعطي رصيد كل مستودع وأن الإجمالي يطابق `RawMaterial.currentStock`، ثم تنفيذ صرفين متزامنين للتأكد من نجاح واحد فقط وتراجع الآخر دون ledger زائد أو رصيد سالب.

يضيف `dashboard.integration-spec.ts` سيناريو GF-REMAINING-004: إنشاء طلب بيع وإنتاج عامل في يوم محدد، ثم التحقق من أن `/dashboard/stats` service يعيد المبيعات الشهرية والإنتاج اليومي وأفضل عامل من PostgreSQL ضمن `from/to`، مع مؤشرات المخزون ورفض الفترة المعكوسة في طبقة DTO/service.

## GF-REMAINING-006 — بوابات PostgreSQL وRBAC

يضيف الإصلاح بوابة `integration-gate.ts` مركزية مرتبطة بإعداد Jest، وأمراً صارماً `test:integration:required` في `package.json`، ويشغله workflow CI مع `GF_REQUIRE_INTEGRATION=1`. كما تغطي E2E حالات 401 لمسار Dashboard واستلام المشتريات و403 لمنع VIEWER من إنشاء إذن استلام.

## حدود التغطية

هذه الاختبارات لا تغطي بعد API/RBAC الخاص بواجهات مراحل الإنتاج ولا استلام المنتج التام حسب `FinishedGoodStock`. هذان المساران يحتاجان endpoints وخدمة مخزون المنتج التام في مراحل GF-0013 اللاحقة.
