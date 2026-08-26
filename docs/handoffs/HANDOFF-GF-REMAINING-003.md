# Handoff — GF-REMAINING-003: Stage-output idempotency

## 1. Scope and verdict

- **Task ID:** GF-REMAINING-003
- **Verdict:** complete on branch; ready for PR review, but not merge-ready until remote PostgreSQL integration and all required CI checks pass.
- **In scope:** جعل `POST /production/work-orders/:id/stage-output` آمناً عند إعادة الإرسال والتزامن، تمرير `Idempotency-Key` من HTTP، ربط المفتاح بالـ`ProductionStageRun`، ورفض payload أو scope المخالف.
- **Out of scope:** تغيير انتقالات المراحل، استهلاك الخامات، حساب تكلفة الإنتاج، مخزون المنتج التام، أو تطبيق الهاتف.
- **Base:** `origin/main@c18a2aa` بعد دمج PR #49 ونجاح CI.

## 2. Repository state

| Item | Value |
|---|---|
| Working branch | `fix/gf-remaining-003-production-idempotency` |
| Base SHA | `c18a2aa30163f94eccf45d53d1ee52aa83d3da92` |
| Implementation commit | `d5e374b` — stage-output idempotency and additive migration |
| Pull Request | [#50](https://github.com/rabea0169/garment-factory-erp/pull/50) |
| Merge status | not merged |
| Local database | unavailable; PostgreSQL integration is CI-only |

## 3. Implementation summary

تمت إضافة `idempotencyKeyId` nullable وunique إلى `ProductionStageRun` مع العلاقة إلى `IdempotencyKey`. migration `20260830060000_gf_remaining_003_stage_output_idempotency` additive فقط: تضيف العمود والفهرس الفريد وFK، ولا تنفذ backfill أو حذفاً.

يحسب `recordStageOutput` hash للطلب ويجري pre-check قبل transaction. داخل transaction يُنشأ مفتاح scope=`production.stage-output`، ثم يُربط بـ`ProductionStageRun` عند إغلاق المرحلة. replay بالمفتاح والمحتوى نفسه يعيد `replayed=true` و`stageRunId` دون update أو activity log أو side effect ثانٍ. سباق الطلبين يعالج P2002 بإعادة قراءة النتيجة الملتزمة، بينما payload المختلف أو scope المختلف يرد بـ409.

يمرر `ProductionController` رأس `Idempotency-Key` إلى الخدمة، ويعيد الحقول السابقة `workOrderId`, `stage`, `status` مع `replayed` و`stageRunId`. لا يتم إرسال المفتاح في body.

## 4. Tests added or updated

- `backend/test/production-workflow.integration-spec.ts`: replay مطابق، mismatch بـ409، وreplay متزامن على PostgreSQL حقيقية.
- `backend/test/production-workflow-api.e2e-spec.ts`: header passthrough واستجابة replay على HTTP.
- `backend/src/modules/production/production.controller.spec.ts`: تمرير المفتاح للـworkflow service.
- `docs/API_CONTRACT.md`: توثيق header والحقول ودلالة 409.
- `docs/DATA_AND_MIGRATIONS.md`: توثيق migration وسلامة rollback.

## 5. Verification evidence

| Gate | Command or run | Result | Notes |
|---|---|---|---|
| Prisma format | `npx prisma format` | PASS | schema formatted |
| Prisma generate | `npx prisma generate` | PASS | Prisma Client 7.9.1 |
| Prisma validate | `npx prisma validate` | PASS | schema valid |
| Format check | `npm run format:check` | PASS | all backend files formatted |
| Typecheck | `npm run typecheck` | PASS | no TypeScript errors |
| Lint | `npm run lint` | PASS | no lint errors |
| Build | `npm run build` | PASS | Nest build successful |
| Unit tests | `npm test -- --runInBand` | PASS | 30 suites / 188 tests |
| E2E tests | `npm run test:e2e -- --runInBand` | PASS | 3 suites / 60 tests |
| Integration tests | `npm run test:integration -- --runInBand` | SKIPPED LOCALLY | 7 suites / 29 tests; no `GF_INTEGRATION_DATABASE_URL` |
| PostgreSQL migration + workflow | CI run `32942770760` | PASS | migration deploy and stage-output replay/mismatch/concurrency tests passed on PostgreSQL |
| Secret scan | CI run `32942770760` | PASS | no hardcoded secret detected |
| Diff check | `git diff --check` | PASS | no whitespace errors before commit |

## 6. Risks and limitations

لا يمكن إثبات التزامن أو migration محلياً لعدم توفر PostgreSQL/Docker، لذلك لا يُعتبر الإصلاح مكتمل الإطلاق قبل CI. migration تحفظ stage runs القديمة بلا مفتاح؛ هذه السجلات لا يمكن replay لها بمفتاح جديد إلا من خلال الطلبات الجديدة التي تحمل مفتاحاً.

الـidempotency الحالي يربط المفتاح بالـstage run ولا يخزن response JSON داخل `IdempotencyKey`; هذا مقصود لأن النتيجة قابلة لإعادة البناء من `ProductionStageRun`. إذا أضيفت حقول استجابة مشتقة لاحقاً فيجب تحديث replay contract واختبار equivalence.

تحذير GitHub حول إجبار actions على Node.js 24 بدلاً من Node.js 20 ليس فشلاً في هذه المهمة، لكنه يحتاج صيانة مستقلة.

## 7. Next agent instructions

بعد دمج هذا الفرع والتحقق من CI على `main`, المهمة التالية هي `GF-REMAINING-004`: Dashboard/Reports حقيقي من قاعدة البيانات، مع تعريف KPIs وفترة زمنية ومصدر كل رقم قبل ربط Flutter. يجب البدء من `docs/PROJECT_STATE.md`, `docs/MASTER_BACKLOG.md`, `docs/API_CONTRACT.md`, وفحص أي dashboard/mock fallback في backend وFlutter.
