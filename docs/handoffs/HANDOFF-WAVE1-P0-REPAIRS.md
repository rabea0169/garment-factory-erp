# Handoff — Wave 1 P0 Repairs

## Status

تم تنفيذ وفحص موجة سلامة المخزون الأولى على فروع مستقلة، ودمج الإصلاحات الناجحة في `main`. آخر SHA موثق بعد الدمج هو `ab8f87d` في لحظة إعداد البطاقة، ويجب إعادة التحقق من `origin/main` قبل بدء الشريحة التالية.

## Completed

أزيل الخصم المزدوج للمنتج التام، ووُحّد seed المنتج التام على `FinishedGoodStock` مع سجل افتتاحي في `StockLedgerEntry` دون الكتابة فوق الرصيد عند إعادة seed، وأُغلق مسار إكمال الإنتاج legacy، وأُصلح مسار الاستلام legacy ومرتجعات الموردين حسب PRs التي اجتازت CI.

تم أيضًا تثبيت ربط الشحن بالمخزون وترحيل GRN إلى Inventory وAccounts Payable في شرائح سابقة.

## Verification

اجتازت الشرائح المدمجة Backend Prisma/Lint/Build/Unit/E2E/Integration وFlutter Analyze/Test وSecret Scan في CI. لا يثبت ذلك وحده نجاح load testing أو backup/restore أو UAT.

## Remaining P0/P1

ما زالت مرتجعات المبيعات، الدفعات الجزئية، إكمال payroll وGL، Dashboard/Reports، وتحسينات Flutter/offline/device خارج الموجة. يجب إضافة اختبار تكامل Sale → Confirm → Ship يثبت خصمًا واحدًا وقيد COGS واحدًا، واختبار seed على قاعدة نظيفة، واختبار reconciliation للمخزون والـ GL.

## Next Exact Task

تشغيل baseline كامل على `origin/main` بعد دمج الموجة، ثم تنفيذ مرتجعات المبيعات الجزئية مع COGS الأصلي والقيد العكسي وإعادة المنتج إلى `WH-FG` داخل transaction، أو إغلاق أي blocker مجال قبل لمس schema.

## Rollback

الرجوع يتم عبر revert للـ merge commit أو استعادة backup مع عدم حذف سجلات ledger أو القيود المالية. يجب إجراء migration rehearsal وbackup/restore قبل الإنتاج.
