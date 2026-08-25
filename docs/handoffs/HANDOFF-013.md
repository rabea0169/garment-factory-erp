# HANDOFF-013 — GF-0013 مراحل الإنتاج واستهلاك الخامات والتكلفة

## معلومات التسليم

| الحقل | القيمة |
|---|---|
| المشروع | Garment Factory ERP |
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع الأساس | `main` |
| commit الأساس | [`7e73cf7`](https://github.com/rabea0169/garment-factory-erp/commit/7e73cf75a61c0e275337d2e604de44453a43342a) |
| آخر مرحلة مكتملة | GF-0012 — Pagination الموحد |
| المرحلة المسلّمة | GF-0013 |
| نوع المرحلة | P2 — الإنتاج والجودة والمالية |
| الحالة | جاهزة للتنفيذ، غير منفذة |

## الهدف

تنفيذ دورة تشغيل مؤسسية لأمر التشغيل تبدأ من التخطيط، ثم نقل الأمر بين مراحل المصنع، وتسجيل الإنتاج المقبول والمرفوض والهدر في كل مرحلة، وربط استهلاك الخامات الفعلي بمرحلة التشغيل، وحساب تكلفة الإنتاج وفق سياسة موثقة.

المراحل الأولية المقترحة هي: القص `CUTTING`، الخياطة `SEWING`، الكي `IRONING`، والتعبئة `PACKING`. يجب اعتبار هذه القائمة قرارًا قابلًا للتأكيد قبل تثبيتها في schema أو الكود، لأن قيم `WorkOrderStatus` الحالية قد تجمع بين حالة الأمر واسم المرحلة.

## حدود العمل

يتضمن العمل نموذجًا واضحًا لحالة أمر التشغيل وانتقالاته، مع منع الانتقال غير المسموح ومنع إكمال الأمر أكثر من مرة. يتضمن أيضًا سجلًا لكل تحديث مرحلة، وكميات planned/produced/rejected/waste، والتحقق من العلاقة الحسابية:

```text
checked quantity = accepted quantity + rejected quantity + waste quantity
```

عند تسجيل استهلاك خامة، يجب أن يتم الخصم عبر `InventoryService` و`StockLedger` داخل transaction واحدة مع ربط الحركة بـ WorkOrder ومرحلة الإنتاج. يجب أن تكون العملية idempotent عند إعادة إرسال المفتاح نفسه، وأن تفشل بالكامل عند عدم كفاية الرصيد أو وجود كمية غير صالحة.

يتضمن العمل حساب تكلفة الخامة المستهلكة والتكلفة المتراكمة لأمر التشغيل، مع تسجيل مصدر كل قيمة وسياسة التقريب. لا يجوز أن تحسب Flutter التكلفة أو تفرض حالة الأمر؛ الخادم هو مصدر الحقيقة.

## الملفات المتوقعة

| المسار | الغرض |
|---|---|
| `backend/prisma/schema.prisma` | نماذج stage transitions والاستهلاك والتكلفة عند الحاجة |
| `backend/prisma/migrations/` | migration متوافقة مع البيانات الموجودة، مع expand/backfill/contract إذا تغيرت حقول إلزامية |
| `backend/src/modules/production/production.service.ts` | قواعد الانتقال والإكمال والاستهلاك والتكلفة |
| `backend/src/modules/production/production.controller.ts` | المسارات والصلاحيات وDTOs |
| `backend/src/modules/production/dto/` | DTOs للانتقال والإنتاج والاستهلاك والتالف |
| `backend/src/modules/inventory/inventory.service.ts` | إعادة استخدام قناة ledger وعدم كتابة الرصيد مباشرة |
| `backend/src/events/event-types.ts` | أحداث غير مالية بعد نجاح المعاملة فقط |
| `backend/src/modules/production/*.spec.ts` | اختبارات القواعد والمعاملات وidempotency |
| `backend/test/*.e2e-spec.ts` | اختبارات HTTP والصلاحيات والعقد |
| `docs/API_CONTRACT.md` | توثيق الطلبات والردود والأخطاء |
| `docs/PROJECT_STATE.md` | تحديث الحالة بعد إغلاق المهمة |

لا تعدل ملفات GF-0016 أو GF-0017 أو GF-0018 إلا إذا ظهر اعتماد موثق ومراجع في PR. لا تضف شاشات Flutter قبل تثبيت عقد Backend واختبار قواعد المجال.

## قرارات يجب تثبيتها قبل التنفيذ

يجب إنشاء ADR أو قرار موثق يحدد ما إذا كان `WorkOrderStatus` سيمثل الحالة lifecycle فقط، بينما يمثل `ProductionStage` المرحلة الحالية، أو سيتم استخدام enum واحد يجمع الاثنين. كما يجب تثبيت سياسة التكلفة: المتوسط المرجح من ledger، أو تكلفة معيارية، وكيفية التعامل مع الهدر والمرتجع.

يجب تحديد ما إذا كان التالف جزءًا من الكمية الخارجة من المرحلة أو حركة مخزون مستقلة، وتحديد ما إذا كان المنتج التام يُستلم في كل مرحلة أم عند التعبئة النهائية فقط. يجب كذلك تحديد المخزن الافتراضي للاستهلاك والمنتج التام، وآلية ربط الحركات بأمر التشغيل والمرحلة.

## معايير القبول

| المعيار | شرط القبول |
|---|---|
| انتقالات الحالة | لا انتقال غير معرف، ولا رجوع غير مصرح، وكل انتقال له دور واضح |
| الإكمال | لا يمكن إكمال أمر التشغيل مرتين، والإكمال يعيد نتيجة ثابتة عند إعادة الطلب idempotently |
| الكميات | لا قيم سالبة، والعلاقة الحسابية بين المقبول والمرفوض والهدر مفروضة على الخادم |
| الاستهلاك | كل خصم يتم عبر `InventoryService` وledger داخل transaction |
| الرصيد | فشل العملية عند الرصيد غير الكافي مع rollback كامل |
| التكلفة | التكلفة من الخادم، وسياسة الحساب والتقريب موثقة ومختبرة |
| الصلاحيات | القراءة للأدوار المسموحة، والانتقال/الاستهلاك/الإكمال لأدوار تشغيلية محددة |
| API | DTOs مع `class-validator`، وعقد Swagger و`API_CONTRACT.md` متطابق |
| الاختبارات | Unit وE2E تشمل النجاح والفشل والـ rollback والتكرار والتزامن |
| الترحيل | Prisma validate وmigration على PostgreSQL حقيقية، دون حذف بيانات قائمة |
| Flutter | لا يعتمد على منطق محلي مخالف للخادم، ويعرض حالات الخطأ والتحميل والنجاح بوضوح |

## بوابات التسليم

يجب أن تمر الأوامر التالية في Backend:

```bash
npx prisma generate
npx prisma validate
npm run format:check
npm run typecheck
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

ويجب أن تمر بوابات GitHub Actions الثلاث: Backend، Flutter، وSecret Scan. لا تُعتبر المهمة مكتملة إذا نجح build وفشلت اختبارات القواعد أو إذا تم اختبار migration نظريًا فقط دون PostgreSQL فعلية.

## مخاطر يجب تجنبها

لا تستخدم تحديثات مباشرة لـ `RawMaterial.currentStock` أو `FinishedGood.quantity` خارج مسار المخزون المعتمد. لا تمرر `createdById` أو `userId` أو هوية المنفذ من body. لا تستخدم `any` بدل DTO. لا تعتمد على أول Product Variant أو أول مخزن ضمنيًا عندما يكون الأمر يستهدف Variant أو مخزنًا محددًا.

لا تنفذ migration تحذف `productId` أو جدولًا قائمًا أو تضيف حقولًا إلزامية بلا backfill على قاعدة بيانات تحتوي بيانات. لا تعتبر E2E المبنية على mocks دليلًا كافيًا للتزامن أو القيود؛ يجب إضافة اختبار PostgreSQL حقيقي قبل Pilot.

## صيغة التسليم للنموذج التالي

يجب أن يعيد النموذج التالي تقريرًا يتضمن commit الأساس والفرع وملخص الملفات، وقرارات ADR، وشكل schema النهائي، وتفاصيل قواعد الانتقال، ونتائج كل بوابة، وأرقام Unit/E2E، وأي فجوات أو مخاطر لم تُغلق. يجب تحديث `PROJECT_STATE.md` وإنشاء Handoff جديد للمهمة التالية فقط بعد نجاح CI.

## المراجع

1. [main بعد GF-0012](https://github.com/rabea0169/garment-factory-erp/tree/main)
2. [PR #9 — عقد Pagination](https://github.com/rabea0169/garment-factory-erp/pull/9)
3. [`docs/API_CONTRACT.md`](https://github.com/rabea0169/garment-factory-erp/blob/main/docs/API_CONTRACT.md)
4. [`docs/MASTER_BACKLOG.md`](https://github.com/rabea0169/garment-factory-erp/blob/main/docs/MASTER_BACKLOG.md)
