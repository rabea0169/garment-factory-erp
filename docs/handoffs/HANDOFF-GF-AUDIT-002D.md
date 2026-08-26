# Handoff GF-AUDIT-002D

## Status
- Branch: `direct/gf-audit-002d-payroll-payment`
- Commit: `4fe6975`
- Phase: Pre-release hardening
- Task: إصلاح المشتريات، دفع الرواتب، Dashboard، وحماية أرصدة الترحيل
- Pull Request: [#54](https://github.com/rabea0169/garment-factory-erp/pull/54)

## Completed
- تم تسلسل استلامات الشراء ومرتجعات المورد بقفل صف أمر الشراء وإعادة التحقق من الكميات داخل transaction.
- تم جعل مفتاح الاستلام legacy يعكس الكمية المتبقية، وإضافة حماية replay لمرتجع المورد.
- تم ربط مرتجع المورد بعكس قيد حسابات الموردين/المخزون داخل نفس transaction.
- أُضيف `POST /hr/payrolls/:id/pay` لدفع كشف معتمد من خزينة نشطة، بقيد `GENERAL_EXPENSE → CASH` وتحديث خزينة ذري وidempotency.
- أُضيف `GET /dashboard/stats` بمبيعات آخر 6 أشهر وإنتاج آخر 6 أيام وأفضل العمال من PostgreSQL دون mock fallback.
- أُضيف قفل صفوف الخزائن والموردين والتحقق من الرصيد السالب داخل FinancialPostingService.
- تم تصحيح عقد الشحن ليؤكد أن صرف المنتج التام وCOGS يحدثان عند تأكيد البيع، لا عند انتقال الشحنة إلى SHIPPED.
- أُضيف `workflow_dispatch` إلى CI لإتاحة تحقق يدوي متكرر على فروع الإصلاح.

## Files Changed
- `backend/src/modules/purchasing/purchasing.service.ts`
- `backend/src/modules/purchasing/purchasing.service.spec.ts`
- `backend/src/modules/purchasing/purchasing.service.audit.spec.ts`
- `backend/test/purchasing.integration-spec.ts`
- `backend/test/inventory-warehouse.integration-spec.ts`
- `backend/src/modules/hr/hr.service.ts`
- `backend/src/modules/hr/hr.controller.ts`
- `backend/src/modules/hr/hr.module.ts`
- `backend/src/modules/hr/dto/pay-payroll.dto.ts`
- HR unit/controller/integration tests
- `backend/src/modules/dashboard/*`
- `backend/src/core/financial/financial-posting.service.ts` and spec
- `backend/test/auth-guard.e2e-spec.ts`
- `backend/test/helpers/prisma-mock.ts`
- `backend/src/app.module.ts`
- `.github/workflows/ci.yml`
- `docs/API_CONTRACT.md`
- `docs/PROJECT_STATE.md`

## Database/API Impact
- لا توجد migration جديدة؛ التغييرات تستخدم الجداول الحالية.
- API جديد: `GET /dashboard/stats` محمي بـJWT.
- API جديد: `POST /hr/payrolls/:id/pay` محمي بـ`HR_MANAGER` و`GENERAL_MANAGER` ويحتاج `treasuryId`.
- لا يُسمح بدفع كشف غير معتمد أو مدفوع أو بصافي مبلغ غير موجب.
- لا تُرسل المبالغ أو الهوية من العميل؛ الخادم يعيد الحساب ويستخرج actor من JWT.

## Checks
| Check | Result | Notes |
|---|---|---|
| Format | PASS | CI run `32949124244` |
| Typecheck | PASS | CI run `32949124244` |
| Lint | PASS | CI run `32949124244` |
| Build | PASS | CI run `32949124244` |
| Backend unit | PASS — 31 suites / 195 tests | CI run `32949124244` |
| Backend E2E | PASS — 3 suites / 61 tests | CI run `32949124244` |
| PostgreSQL integration | PASS — 7 suites / 32 tests | CI run `32949124244`, `skipped = 0` |
| Flutter tests | PASS | CI run `32949124244` |
| Secret scan | PASS | CI run `32949124244` |
| Prisma Compute Deploy | FAIL | External check; requires separate Prisma Compute decision/configuration |
| npm audit production | FAIL | 3 High findings through Prisma 7.9.1/deepmerge-ts; no downgrade applied |

## Known Issues
- PR #54 is not merged into `main`; PR #52 remains open and is included as its base lineage.
- Prisma Compute Deploy external check is failing and must be investigated or formally removed/accepted before release.
- `npm audit --omit=dev` still reports 3 High findings. Downgrading Prisma from 7.9.1 to 6.12.0 is a major compatibility decision and was not performed automatically.
- Local Docker was unavailable; PostgreSQL integration was verified in GitHub CI rather than locally.
- Backup/restore drill, production monitoring, UAT signatures, and real-device field verification remain release gates.
- Accounting chart semantics and payroll expense-account policy require accountant approval before production posting.

## Not Done
- لم يتم دمج PRs أو نشر Production.
- لم يتم تشغيل بيانات حقيقية.
- لم يتم اعتبار النظام Production Ready.
- لم تتم معالجة Prisma Compute أو npm audit بترقية/خفض major غير معتمد.

## Next Exact Task
- Review PR #54 semantically, resolve the external Prisma Compute failure, obtain accountant approval for payroll posting accounts, then merge only with explicit authorization and rerun CI on `main`.
- After that, execute backup/restore drill and UAT Go/No-Go checklist.

## Rollback
- قبل الدمج: إغلاق PR #54 أو إعادة الفرع إلى `origin/main`.
- بعد الدمج: `git revert 4fe6975 906b527 c876503 00d48ed` بترتيب عكسي حسب commits الفعلية، ثم تشغيل migrations/checks؛ لا تُحذف بيانات تشغيلية أو مالية يدويًا.
