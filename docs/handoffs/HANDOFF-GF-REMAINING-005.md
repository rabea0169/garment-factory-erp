# Handoff — GF-REMAINING-005: Purchasing receipt financial posting

## 1. Scope and verdict

- **Task ID:** GF-REMAINING-005
- **Verdict:** implementation complete on branch; ready for PR review and PostgreSQL CI.
- **Base:** `origin/main@dd200c5` after merge of PR #51.
- **In scope:** ربط استلام المشتريات بالمخزون والقيد المالي والذمم داخل transaction واحدة، حماية الاستلامات المتزامنة، وإثبات idempotency والمرتجعات المالية.
- **Out of scope:** اعتماد فواتير الموردين، الدفع النقدي، VAT على المشتريات، وإغلاق الفترات المالية خارج ما يفرضه FinancialPostingService.

## 2. Implementation summary

كان مسار `createReceipt` يملك ترحيلاً مالياً داخل transaction، لكنه لم يكن يثبت بالاختبارات محتوى القيد وأرصدة الحسابات/المورد، ولم يكن يحجز أمر الشراء قبل حساب الكمية المتبقية. أضيف قفل `SELECT ... FOR UPDATE` على أمر الشراء داخل transaction قبل إعادة قراءة receipt items، بحيث لا يستطيع استلامان بمفتاحين مختلفين تجاوز الكمية المتبقية.

تُحسب قيمة الاستلام من `PurchaseOrderItem.quantity` و`unitCost` المخزنين، ثم تُنفذ في transaction واحدة: إنشاء receipt، حركة `RECEIVE` عبر InventoryService، قيد مدين للمخزون ودائن للحسابات الدائنة، تحديث رصيد المورد، وتحديث حالة أمر الشراء. نفس المفتاح والمحتوى يعيدان الاستجابة دون receipt أو ledger أو journal إضافي، والمحتوى المختلف يرد 409.

تم جعل legacy `receiveOrder` يعيد حساب المتبقي بمفتاح مشتق من حالة المتبقي، حتى لا يعيد replay لإذن قديم بعد استلام جزئي. كما حُمي مرتجع المورد بقفل الأمر وترحيل عكسي للمخزون والقيد والذمة مع idempotency.

## 3. Tests added or updated

- `backend/test/purchasing.integration-spec.ts`: قيد receipt المتوازن، أرصدة حساب المخزون والحسابات الدائنة، رصيد المورد، replay، legacy remaining receipt، ومرتجع supplier مع أثر مالي واحد.
- `backend/src/modules/purchasing/purchasing.service.spec.ts`: عقد replay والـtransaction passthrough.
- `backend/src/modules/purchasing/purchasing.service.audit.spec.ts`: تغطية مسار المرتجع المعدّل.
- `docs/API_CONTRACT.md`: contract مالي واستقرار idempotency.

## 4. Verification evidence

| Gate | Result | Notes |
|---|---|---|
| Prisma format/validate/generate | PASS | no schema change in this task |
| Backend format/typecheck/lint/build | PASS locally | after cherry-pick and test additions |
| Purchasing unit tests | PASS locally | 3 suites / 15 tests |
| Full unit/e2e | PASS before final assertion extension | rerun required before PR |
| PostgreSQL integration | skipped locally | no `GF_INTEGRATION_DATABASE_URL`; mandatory on CI |
| Secret scan | pending PR CI | no secret added |

## 5. Risks and acceptance criteria

يجب أن يمر CI على PostgreSQL من الصفر، ويثبت أن receipt واحدة تُنشئ journal واحداً متوازناً، وتزيد `supplier.balance` بالقيمة، وتحدّث `RawMaterial.currentStock`، وأن replay لا يضيف أي أثر. يجب أن يثبت legacy full receive الكمية المتبقية فقط، وأن مرتجعين متزامنين لا يتجاوزان الكمية المستلمة.

القيد يستخدم الحسابين الثابتين من `CHART_OF_ACCOUNTS`: `INVENTORY` مدين و`ACCOUNTS_PAYABLE` دائن. قيمة receipt الكلية يجب أن تتبع Decimal/precision سياسة النظام قبل اعتماد عملات أو VAT في مهمة مستقلة.

## 6. Next agent instructions

بعد الدمج، المهمة التالية هي `GF-REMAINING-006`: توسيع بوابات PostgreSQL/RBAC والتأكد من أن suites لا يمكن أن تتجاوز الفشل بصمت، ثم إعداد GF-REMAINING-007 لاختبار الأداء القابل للتكرار. يجب عدم اعتماد النظام للإنتاج قبل تنفيذ reconciliation للبيانات القديمة ومراجعة سياسة الموردين/الضرائب.
