# HANDOFF-012: Pagination لكل القوائم

## 1. نقطة التسليم

المستودع هو `rabea0169/garment-factory-erp`، والفرع المرجعي هو `main` عند commit `2af57ea8`. هذا commit يحتوي على GF-0001 إلى GF-0011 وPR #7. آخر CI أخضر هو Run `32861199071`.

المرحلة التالية الرسمية حسب `docs/MASTER_BACKLOG.md` هي `GF-0012`، ولا ينبغي تغيير ترقيمها إلى مبيعات أو Flutter؛ المبيعات هي GF-0011 وتكامل Flutter هو GF-0010.

## 2. الهدف

إضافة pagination موحدة، آمنة، وقابلة للتوثيق إلى كل القوائم التي يمكن أن تنمو في الحجم، مع الحفاظ على ترتيب ومرشحات القوائم الحالية قدر الإمكان، ومنع استهلاك ذاكرة الخادم بتحميل سجلات غير محدودة.

## 3. نطاق التنفيذ

يجب إنشاء عقد query مشترك يحتوي على:

```text
page: رقم الصفحة، يبدأ من 1، default=1
pageSize: حجم الصفحة، default=20، maximum=100
```

ويجب أن تكون الاستجابة الموحدة:

```json
{
  "items": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

يجب استخدام `skip=(page-1)*pageSize` و`take=pageSize`، وتشغيل `count` بالتوازي مع `findMany` عندما يكون ذلك آمنًا، مع تطبيق نفس `where` على الاستعلامين.

## 4. الملفات المتوقعة

```text
backend/src/common/dto/pagination-query.dto.ts
backend/src/common/pagination/pagination.util.ts
backend/src/modules/*/*.controller.ts
backend/src/modules/*/*.service.ts
backend/src/modules/*/*.service.spec.ts
backend/test/*.e2e-spec.ts
docs/API_CONTRACT.md
docs/PROJECT_STATE.md
```

يمكن تغيير المسارات إذا كان تنظيم المشروع الحالي يتطلب ذلك، لكن يجب عدم تكرار DTO وmetadata في كل وحدة.

## 5. الوحدات ذات الأولوية

ابدأ بالقوائم التالية، ثم وسّع التطبيق بعد نجاح الاختبارات:

| الوحدة | القوائم |
|---|---|
| Products | المنتجات، المواسم |
| Inventory | الخامات، المنتجات التامة، ledger |
| Purchasing | أوامر الشراء |
| Sales | أوامر البيع، العملاء |
| Quality | فحوصات الجودة |
| Shipping | الشحنات |
| HR | العمال والسجلات ذات الحجم المتوقع |

يجب تحديد endpoints القائمة فعليًا قبل تعديلها، وعدم افتراض أسماء غير موجودة.

## 6. قواعد الأمان والعقد

يجب رفض `page <= 0` و`pageSize <= 0` و`pageSize > 100` وquery غير الرقمي بواسطة ValidationPipe. لا تقبل أسماء أعمدة أو اتجاهات ترتيب من العميل دون whitelist صريحة. لا تستخدم string interpolation لبناء SQL. يجب توثيق أي تغيير في شكل response، وإذا كان التغيير breaking فأنشئ نسخة API أو migration واضحة بدل تغييره بصمت.

## 7. الاختبارات المطلوبة

يجب إضافة اختبارات تثبت page 1، صفحة وسطية، page خارج نطاق النتائج، pageSize الافتراضي، pageSize الأقصى، pageSize الأكبر من الحد، query سالب أو نصي، تطبيق نفس المرشحات على `count` و`findMany`، والحالة الفارغة.

يجب أن تشمل اختبارات E2E endpoint واحدًا على الأقل من كل مجموعة رئيسية، وألا تعتمد فقط على فحص metadata أو `should be defined`.

## 8. معايير القبول

تُعتبر GF-0012 مكتملة فقط إذا تحققت الشروط التالية:

1. DTO مشترك وحدود page/pageSize واضحة.
2. metadata موحدة ومكتوبة في Swagger والعقد.
3. لا توجد قوائم رئيسية غير محدودة دون قرار موثق.
4. `format:check` و`typecheck` و`lint` و`build` ناجحة.
5. جميع Unit وE2E tests ناجحة.
6. Flutter client يتعامل مع response paged أو توجد طبقة توافق موثقة قبل تغيير API.
7. CI على Pull Request وعلى main بعد الدمج أخضر.
8. تحديث `PROJECT_STATE.md` و`API_CONTRACT.md` وفتح بطاقة handoff التالية.

## 9. المخاطر التي يجب عدم إخفائها

اختبارات E2E الحالية تستخدم Prisma mock في أجزاء مهمة، لذلك يجب عدم الادعاء بأن pagination اختُبرت على PostgreSQL حقيقية ما لم يتم تشغيل ذلك فعليًا. كذلك يجب الانتباه إلى أن `findMany` و`count` قد يعطيان نتائج مختلفة إذا اختلف `where` أو حدثت تغييرات متزامنة؛ يجب توثيق مستوى الاتساق المقبول.

## 10. تسليم النموذج التالي

يجب على النموذج الذي ينفذ GF-0012 أن يبدأ بتعليق يذكر commit الأساس، الملفات التي سيعدلها، endpoints التي سيشملها، وشكل response قبل وبعد. يجب أن يبقى نطاقه محصورًا في pagination ولا يبدأ GF-0013 قبل إغلاق هذا التسليم.
