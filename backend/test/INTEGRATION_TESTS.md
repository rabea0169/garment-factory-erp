# GF-0013 Integration Tests

تختبر `production-workflow.integration-spec.ts` دورة الإنتاج على PostgreSQL حقيقية، ولا تستبدل `PrismaService` بـ mock.

## المتطلبات

يجب توفير قاعدة PostgreSQL مخصصة للاختبار، وتطبيق كل migrations بما فيها GF-0013. لا تستخدم قاعدة تطوير أو إنتاج تحتوي على بيانات مهمة؛ الاختبارات تنفذ `TRUNCATE ... CASCADE` قبل كل حالة.

```bash
export PGPASSWORD='<database-password>'
export GF_INTEGRATION_DATABASE_URL='postgresql://<database-user>@<database-host>:<database-port>/<database-name>'
export DATABASE_URL="$GF_INTEGRATION_DATABASE_URL"
cd backend
npx prisma migrate deploy
npm run test:integration
```

عند عدم وجود `GF_INTEGRATION_DATABASE_URL` تُعلَّم suite كـ skipped عمدًا، حتى لا تتصل الاختبارات بقاعدة غير معروفة أو تفشل بيئة لا تحتوي PostgreSQL. في CI يجب تشغيل PostgreSQL service وتعيين المتغير قبل `npm run test:integration`.

## السيناريوهات

تغطي الاختبارات الانتقال المتسلسل من البداية إلى `CUTTING` ثم `SEWING`، رفض القفز إلى `PACKING`، منع الانتقال قبل إكمال المرحلة الحالية، وإعادة الطلب نفسه عبر idempotency دون إنشاء transition إضافي.

كما تثبت حفظ split الكمية وفق `inputQty = acceptedQty + rejectedQty + wasteQty`، وتتحقق من استهلاك الخامة داخل transaction، وحساب `totalCost` و`wasteCost` من Weighted Average، وإعادة تشغيل العملية دون ledger إضافي، وrollback الكامل عند عدم كفاية الرصيد.

## حدود التغطية

هذه الاختبارات لا تغطي بعد API/RBAC الخاص بواجهات مراحل الإنتاج ولا استلام المنتج التام حسب `FinishedGoodStock`. هذان المساران يحتاجان endpoints وخدمة مخزون المنتج التام في مراحل GF-0013 اللاحقة.
