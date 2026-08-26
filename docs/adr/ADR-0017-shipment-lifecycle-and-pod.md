# ADR-0017: Shipment Lifecycle and Proof of Delivery

## Context

كان تنفيذ GF-0017 على main يفرض انتقالات الحالة الأساسية، لكنه لا يسجل إثبات التسليم ولا الفاعل، وكان تحديث الحالة يعتمد على `update` غير مشروط بالحالة السابقة. هذا يترك فجوة تدقيق ومخاطرة سباق عند إعادة الطلب.

## Decision

تُقبل الانتقالات بالترتيب `PREPARING → SHIPPED → IN_TRANSIT → DELIVERED`، مع السماح بـ`IN_TRANSIT → RETURNED` و`DELIVERED → RETURNED` فقط. يتطلب الانتقال إلى `DELIVERED` قيمة `proofOfDelivery` غير فارغة وبحد أقصى 200 حرف، ويسجل `deliveredById` من JWT و`deliveredAt` من الخادم.

ينفذ تحديث الحالة داخل transaction باستخدام optimistic guard على `(id, status)`؛ إذا تغيرت الحالة بالتزامن يعاد 409 ولا يُسجل audit. كل انتقال ناجح يسجل ActivityLog. لا تنشئ هذه المرحلة journal أو payment ولا تغير مخزونًا؛ الربط المالي مؤجل إلى GF-0018.

## Consequences

حقلا POD والفاعل nullable للتوافق مع الشحنات القديمة. يحتاج مسار الرفع أو تعديل إثبات التسليم إلى قرار مستقل، ولا يسمح بتعديل شحنة مسلّمة خارج انتقال موثق.

## Migration/Rollback

المهاجرة additive وتضيف حقلي POD وdeliveredById وفهارسهما وFK إلى users. rollback يكون عبر revert أو backup/restore؛ لا تُحذف سجلات الشحن القديمة.

## Approved by

Owner approval: execution baseline وفق MASTER_BACKLOG؛ مراجعة CI مطلوبة قبل الإنتاج.
