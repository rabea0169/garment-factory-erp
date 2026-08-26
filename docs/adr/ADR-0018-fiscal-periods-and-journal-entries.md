# ADR-0018: Fiscal Periods and Journal Entries

## Context

كان محرك الترحيل يفرض التوازن على مستوى كل سطر ويحدّث الحسابات ذريًا، لكنه لا يربط القيد بفترة مالية ولا يمنع الترحيل بعد إغلاقها. كما لم توجد واجهة typed مستقلة للفترة أو القيد متعدد البنود.

## Decision

تُنشأ `FiscalPeriod` بتاريخ بداية ونهاية وحالة `OPEN` أو `CLOSED`. يمنع النظام تداخل الفترات الجديدة في الخدمة، ويمنع القيد المرتبط بفترة غير مفتوحة أو بتاريخ خارج حدودها داخل `FinancialPostingService` وفي نفس transaction. إغلاق الفترة يتم بتحديث مشروط بالحالة ويسجل actor في ActivityLog.

ينشئ `POST /accounting/journal-entries` قيدًا متعدد البنود عبر المحرك المالي، ويأخذ التاريخ والفترة من DTO موثّق. تبقى صيغة `JournalLine` الحالية (مدين/دائن في كل سطر) متوافقة مع النماذج الموجودة؛ إعادة تصميمها إلى debit/credit entries منفصلة قرار لاحق لا يُخلط بهذه المرحلة.

## Consequences

حقول `fiscalPeriodId` nullable للتوافق مع القيود القديمة. لا تُرحّل الرواتب أو المشتريات تلقائيًا في هذا slice، ولا تُقبل أرصدة أو totals من العميل. الدفع، VAT posting، والتسويات الآلية تبقى مهام مستقلة.

## Migration/Rollback

المهاجرة additive، تنشئ جدول الفترات وتضيف FK وفهرسًا إلى journal_entries. rollback عبر `git revert` للشفرة وbackup/restore أو migration عكسية معتمدة؛ لا تُحذف القيود القديمة.

## Approved by

Owner approval: execution baseline وفق MASTER_BACKLOG؛ مراجعة CI وUAT مطلوبة قبل الإنتاج.
