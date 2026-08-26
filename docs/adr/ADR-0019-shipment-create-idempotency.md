# ADR-0019: Shipment Creation Idempotency

## Context

أصبح انتقال الشحنة إلى `SHIPPED` ذريًا ويصرف المنتج التام عبر `InventoryService` داخل نفس transaction، لكن `POST /shipping` نفسه كان ينشئ شحنة جديدة مع كل retry. هذا يتيح تكرار الشحنات، حتى لو كان الصرف اللاحق محميًا.

## Decision

يدعم إنشاء الشحنة رأس `Idempotency-Key` اختياريًا. يُنشأ سجل المفتاح داخل نفس transaction مع Shipment، وتُخزّن استجابة قابلة للتسلسل بعد نجاح الإنشاء. نفس المفتاح ونفس body وactor يعيدان النتيجة دون سجل جديد، ومحتوى مختلف أو نطاق مختلف يُرفض بـ409. تعارض السباق يعيد replay بعد فحص السجل المكتمل.

لا يُربط هذا المفتاح بانتقال الحالة؛ الانتقال إلى `SHIPPED` يبقى محميًا بتحديث مشروط بالحالة السابقة، ويستخدم مفاتيح مستقلة لكل سطر صرف للمنتج التام. فشل صرف أي سطر يعيد transaction كاملة، فلا تُحفظ حالة SHIPPED جزئية.

## Consequences

حقل `Shipment.idempotencyKeyId` nullable للحفاظ على الشحنات القديمة. actor مطلوب من JWT لمسار الإنشاء ولا يُؤخذ من body. لا يضيف هذا القرار رفع ملفات POD أو تعديل الشحنة بعد الإنشاء أو posting مالي.

## Migration/Rollback

المهاجرة additive، تضيف الحقل الفريد وFK إلى `idempotency_keys` دون تعديل السجلات القديمة. rollback عبر backup/restore أو migration عكسية معتمدة؛ لا تحذف shipments أو ledger entries يدويًا.

## Approved by

Execution baseline وفق MASTER_BACKLOG؛ مراجعة CI وUAT مطلوبة قبل الإنتاج.
