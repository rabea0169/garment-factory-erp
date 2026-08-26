# ADR-0020: P0 Financial Reconciliation Controls

## Status
Proposed for implementation on `fix/p0-financial-reconciliation`.

## Context
اختبار PostgreSQL لمسارات البيع والسندات والمشتريات أثبت فروقًا بين الأرصدة التشغيلية والقيود المحاسبية: البيع النقدي يرحّل إلى حساب CASH دون تحديث خزينة التشغيل، وعكس قيد Voucher يقلب البنود لكنه لا يستطيع عكس الأرصدة التشغيلية إذا لم تُحفظ updates داخل `JournalEntry.metadata`، كما أن مرتجع المورد يخرج المخزون دون قيد AP عكسي.

## Decisions

1. **Cash sales require a treasury.** تأكيد `SalesOrder` من نوع `CASH` يتطلب `treasuryId` من body موثّقًا كـUUID. الخادم يعيد استخدام `order.totalAmount` المحسوب سابقًا ولا يقبل مبلغًا من العميل. يتم تمرير `{ treasuryId, delta: totalAmount }` إلى `FinancialPostingService` داخل نفس transaction، ويُحفظ التحديث داخل metadata حتى يكون قابلاً للعكس.

2. **Credit sales cannot select a treasury.** لا يُسمح بتمرير `treasuryId` للبيع الآجل؛ يبقى الأثر على Customer/AR فقط. يُضمّن `treasuryId` أو `null` في request hash حتى لا يعيد idempotency نتيجة بخزينة مختلفة.

3. **Voucher reversals depend on persisted operational metadata.** ينشئ `AccountingService` metadata تحتوي على `treasuryUpdates` و`customerUpdates` أو `supplierUpdates` نفسها التي تُطبق في posting. يقوم محرك العكس بقلب deltas داخل نفس transaction. القيود التاريخية التي لا تحتوي metadata لا تُخمن آثارها ويجب تسويتها بمهمة reconciliation مستقلة.

4. **Supplier returns use actual stock issue value.** يستخدم مرتجع المورد `StockLedgerEntry.totalValue` الناتج عن weighted-average issue، ويرحل قيدًا مدينًا لـAP ودائنًا للمخزون، مع `supplierUpdates: delta = -returnValue` داخل transaction واحدة. فشل الترحيل يلغي حركة المخزون والمرتجع كليًا.

5. **Production entrypoint is explicit.** يطابق `start:prod` مسار Nest الناتج `dist/src/main.js` بدل `dist/main`.

## Consequences
تُصبح Treasury وGL وCustomer/Supplier balances قابلة للمطابقة بعد المعاملة. ستحتاج طلبات cash confirmation القديمة إلى إرسال `treasuryId`، وهو breaking contract مقصود لمنع تحصيل نقدي بلا خزينة. لن تُعالج القيود التاريخية الناقصة metadata تلقائيًا.

## Rollback
يمكن إرجاع commit التطبيق قبل الدمج. لا توجد migration في هذا القرار. لا تُنفذ أي عملية rollback على بيانات الإنتاج؛ تُستخدم حركة عكسية أو reconciliation معتمد.

## Required Evidence
- Unit tests للتحديثات والـmetadata والعكس.
- PostgreSQL integration للـcash sale، supplier return، وvoucher reversal.
- `npm run start:prod` بعد build.
- CI كامل قبل الدمج.
