# GF-REMAINING-007 — Repeatable performance benchmark

يقيس `dashboard-load.mjs` ثلاثة مسارات تمثل طبقات مختلفة من الحمل: `GET /health` كخط أساس للعملية، و`GET /health/ready` كمسار قاعدة البيانات الأدنى، و`GET /dashboard/stats` كمسار ERP ثقيل نسبياً يجمع مؤشرات المبيعات والإنتاج والمخزون من PostgreSQL ومحمى بالمصادقة.

## الحمل الموثق

الإعداد الافتراضي هو 120 طلباً لكل مسار، و20 عاملاً متزامناً، و10 طلبات warm-up، ومهلة 10 ثوانٍ لكل طلب. هذه قيم تصميم للحمل وليست حدود قبول؛ يجب الاحتفاظ بها ثابتة عند مقارنة تشغيلين على بيئة متقاربة.

يُقاس لكل مسار عدد الطلبات الناجحة والفاشلة، توزيع status codes، throughput بالطلبات/الثانية، وmin/p50/p95/p99/max latency بالمللي ثانية. ويُجمع أثناء التشغيل عدد الاتصالات النشطة في `pg_stat_activity`، ثم تُعرض أعلى قيمة ونسبتها إلى `DB_POOL_MAX` بوصفها مؤشراً على pool saturation.

## التشغيل

```bash
export DATABASE_URL='postgresql://...'
export PERF_LOGIN_PASSWORD='...'
export PERF_LOGIN_EMAIL='admin@factory.com'
export DB_POOL_MAX=20
npm run test:performance
```

يحتاج التشغيل إلى خادم backend يعمل على `PERF_BASE_URL` (الافتراضي `http://127.0.0.1:3000`) وقاعدة اختبار تحتوي الحساب الإداري. يقوم workflow CI بإنشاء PostgreSQL 16، يطبق migrations، يشغل seed ببيانات اختبارية، يبني الخادم، ثم يشغل benchmark ويرفع JSON كـartifact.

## حدود القبول

لا يفرض benchmark عتبة p95 أو throughput ثابتة من تلقاء نفسه حتى لا تتحول بيئة CI إلى قرار أداء غير موثق. يمكن لمالك البيئة تحديدها صراحة عبر `PERF_MAX_P95_MS` أو `PERF_MIN_THROUGHPUT_RPS` أو `PERF_MAX_ERROR_RATE`؛ عند ضبط أي منها يفشل التشغيل إذا خالفها أي مسار. أما الحد الأدنى غير القابل للتفاوض فهو إتمام المسارات بلا أخطاء HTTP، وإنتاج ملف JSON يحتوي المقاييس الثلاثة المطلوبة: latency وthroughput وpool saturation.

نتائج benchmark ليست دليلاً وحدها على جاهزية الإنتاج؛ يجب تفسيرها مع حجم قاعدة البيانات، عدد نسخ الخدمة، حدود pool، مواصفات runner، ووجود cache أو rate limiting، ثم اعتماد thresholds في قرار UAT/Go-No-Go.
