# Handoff 015 — Scope Review

## Status

- Branch: `docs/reconcile-gf0015-0018`
- Base: `main@9ed97f7` بعد إغلاق GF-0014
- Phase: مراجعة وتثبيت النطاق قبل التنفيذ
- Task ID: `GF-0015-RECONCILE`
- Date: 2026-08-26

## Verified findings

| Area | Current verified state | Gap for implementation |
|---|---|---|
| Attendance | PR #24 مدمج في `main@90c37f6`، ويضيف `POST /hr/attendance` مع unique `(workerId, date)` و409 للتكرار | لا يُعاد تنفيذ endpoint؛ تُراجع هوية actor/idempotency فقط إذا احتاجها المسار |
| Workers | `Worker` يحتوي `pieceRate` وبيانات أساسية | لا توجد سياسة راتب ثابت أو daily absence rate |
| Daily production | `DailyProduction` يخزن `pieceRate` و`totalAmount`، والخادم يحسبهما من العامل | لا توجد idempotency أو actor أو قواعد ربط كافية بالـwork order |
| Advances | `WorkerAdvance` موجود و`POST /hr/advances` يسمح بسلفة موجبة | لا يوجد تحقق عامل/فاعل/تكرار/تدقيق مكتمل |
| Payroll | نموذج `Payroll` legacy موجود فقط | لا endpoints أو draft/approval state أو period uniqueness أو server-side calculation service |
| Accounting | الدفع والترحيل خارج HR الحالي | لا يوسم payroll كمدفوع ولا ينشئ journal في GF-0015؛ ذلك مؤجل لـGF-0018 |
| Backlog | القائمة القديمة كانت GF-REMAINING فقط | أضيف تسلسل GF-0014→GF-0018 إلى MASTER_BACKLOG مع إبقاء أعمال السلامة الداعمة |

## Accepted baseline

وفق ADR-0015، يحسب GF-0015 `grossAmount` من مجموع `DailyProduction.totalAmount` داخل الفترة، ويخصم السلف داخل الفترة بحد أقصى gross، ويترك `absenceDeduct = 0` في MVP لغياب سياسة راتب ثابت معتمدة. `netAmount = grossAmount - advanceDeduct - absenceDeduct`، ولا تقبل الخدمة gross/net من العميل. ينشأ payroll كـ`DRAFT`، ثم يعتمد بلا تعديل مباشر؛ الدفع والقيد المالي خارج المرحلة.

كل كتابة payroll يجب أن تكون داخل transaction، مع actor من JWT، idempotency للإنشاء/الاعتماد، وقيد worker-period يمنع سجلين لنفس العامل والفترة. يجب أن تعالج الخدمة التكرار المتزامن بـ409، وأن تغطي اختبارات PostgreSQL الحساب وإعادة الإرسال والاعتماد وعدم التعديل والrollback.

## Documentation changes

- `docs/MASTER_BACKLOG.md` — إضافة التسلسل GF-0014 إلى GF-0018 وربطه بالاعتماديات ومعايير القبول.
- `docs/DOMAIN_GLOSSARY.md` — تصحيح تعريف Quality/Waste/Payroll وقواعد الحساب.
- `docs/adr/ADR-0015-hr-payroll-scope-and-calculation.md` — قرار نطاق وحساب payroll وسلامة الدفع المرحلي.
- `docs/handoffs/HANDOFF-015-REVIEW.md` — هذه البطاقة.

## Checks and constraints

لا توجد تغييرات application أو schema في هذه المراجعة. لا يبدأ `GF-0015-IMPL` إلا فوق main بعد دمج توثيق هذه المراجعة، وبعد قراءة ADR-0015 وPR #24 وملفات HR. عناصر `GF-REMAINING-001..009` تبقى قائمة مستقلة؛ إذا عرقلت مسارًا محددًا تُنفذ في PR منفصل أو تُضمّن صراحة داخل نطاق GF-0015.

## Next exact task

```text
TASK_ID: GF-0015-IMPL
TITLE: Add auditable server-side payroll draft and approval
OBJECTIVE: تنفيذ payroll MVP على فرع مستقل فوق main: إنشاء draft محسوب من DailyProduction وWorkerAdvance، اعتماد غير قابل للتعديل، actor/idempotency، وقيد worker-period، دون إعادة تنفيذ attendance أو posting مالي.
ALLOWED FILES: backend/prisma/schema.prisma؛ backend/prisma/migrations/<new-gf0015-migration>/migration.sql؛ backend/src/modules/hr/**؛ backend/test/** المرتبط بـHR/payroll؛ docs/API_CONTRACT.md؛ docs/DATA_AND_MIGRATIONS.md؛ docs/PROJECT_STATE.md؛ docs/handoffs/HANDOFF-015-IMPL.md؛ docs/adr عند الحاجة.
ACCEPTANCE CRITERIA:
1. gross/net لا يأتيان من العميل؛ الخادم يحسبهما من snapshots الموجودة.
2. السلف داخل الفترة تخصم بحد أقصى gross، وabsenceDeduct يظل صفرًا وفق ADR-0015.
3. worker-period uniqueness وidempotency يمنعان الأثر المكرر، مع 409 للتكرار/التعارض.
4. DRAFT ثم APPROVED فقط بحسب الصلاحية؛ لا تعديل أو دفع لفحص approved عبر هذا المسار.
5. actor من JWT، DTO validation، 401/403/400، واختبارات unit وHTTP وPostgreSQL للنجاح والفشل والrollback.
6. migration additive وقابلة للتطبيق على PostgreSQL نظيفة، وCI كامل قبل فتح/دمج PR.
```

## Rollback

هذه المراجعة توثيقية فقط. للتراجع استخدم `git revert` لcommit التوثيق. عند تنفيذ schema لاحقًا، لا تستخدم `db push` ولا تحذف سجلات payroll؛ استخدم backup/restore أو migration عكسية معتمدة.
