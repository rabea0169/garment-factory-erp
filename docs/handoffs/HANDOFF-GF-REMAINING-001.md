# Handoff — GF-REMAINING-001: ProductsController RBAC

## 1. Scope and verdict

- **Task ID:** GF-REMAINING-001
- **Verdict:** complete on branch; unsafe to merge until remote CI and PR review pass.
- **In scope:** حماية كل مسارات الكتابة الحساسة في `ProductsController`، التحقق من UUID لمعرفات المنتج وBOM، اختبارات metadata وE2E لحالات 401/403/201/400، وتحديث عقد API وحالة المشروع.
- **Out of scope:** منطق المخزون، دفتر الأستاذ، المهاجرات، واجهة الهاتف، وتغيير قاعدة البيانات.
- **Dependencies:** خط الأساس `origin/main@ab8f87ddc2f4e54cc4846720f89eb0f54f577400`، ووجود الحارس العالمي JWT/Roles وDTO validation القائمين.

## 2. Repository state

| Item | Value |
|---|---|
| Base branch | `origin/main` |
| Base SHA | `ab8f87ddc2f4e54cc4846720f89eb0f54f577400` |
| Working branch | `fix/gf-remaining-001-products-rbac` |
| Head SHA | `eb1e39374edd1cc7fe7fb7a273caeb828fab1058` |
| Pull Request | pending push and PR creation |
| Merge status | not merged |
| CI run | local gates pass; remote CI pending |

## 3. Implementation

تم تعديل `backend/src/modules/products/products.controller.ts` لإضافة `ParseUUIDPipe` إلى تفاصيل المنتج، إنشاء المتغير، إضافة BOM، وحذف BOM. بقيت أدوار `GENERAL_MANAGER` و`PRODUCTION_MANAGER` مفروضة على كل مسارات الكتابة الحساسة، مع استمرار حماية JWT العالمية لمسارات القراءة والكتابة.

تم توسيع `backend/src/modules/products/products.controller.spec.ts` ليغطي metadata للأدوار الأربعة، وتفويض العمليات الثلاث الجديدة إلى الخدمة. وتم توسيع `backend/test/auth-guard.e2e-spec.ts` ليغطي غياب التوكن، منع VIEWER، نجاح `PRODUCTION_MANAGER`، معرفات UUID غير الصالحة، ومدخلات المنتج والمتغير وBOM غير الصالحة.

تم تحديث `docs/API_CONTRACT.md` لإضافة مسارات المتغيرات وBOM والحذف وتوثيق شرط UUID. وتم تحديث `docs/PROJECT_STATE.md` و`docs/MASTER_BACKLOG.md` لحفظ حالة المهمة والاعتماد على الدمج والتحقق قبل GF-REMAINING-002.

لا توجد migration ولا تغييرات على قاعدة البيانات.

## 4. Contract changes

| Method | Path | Protection | Validation |
|---|---|---|---|
| POST | `/products` | JWT + GENERAL_MANAGER/PRODUCTION_MANAGER | CreateProductDto |
| POST | `/products/:id/variants` | JWT + GENERAL_MANAGER/PRODUCTION_MANAGER | `:id` UUID + CreateProductVariantDto |
| POST | `/products/:id/bom` | JWT + GENERAL_MANAGER/PRODUCTION_MANAGER | `:id` UUID + CreateBomLineDto |
| POST | `/products/bom/:bomId/delete` | JWT + GENERAL_MANAGER/PRODUCTION_MANAGER | `:bomId` UUID |

المعرف غير الصالح يرد `400` قبل استدعاء الخدمة. الطلب بلا توكن يرد `401`. المستخدم الموثق بدور غير مصرح به يرد `403`. الدور المصرح به يمر إلى الخدمة ويعيد `201` عند نجاحها. لا يوجد تغيير في شكل الاستجابة الناجحة.

## 5. Verification evidence

| Gate | Command or run | Result | Notes |
|---|---|---|---|
| Install | `npm ci --no-audit --no-fund` | PASS | 884 packages installed من lockfile؛ ظهرت تحذيرات deprecated غير مرتبطة بهذه المهمة |
| Prisma generate/validate | `npx prisma generate` | PASS | Prisma Client 7.9.1؛ لم تتغير schema |
| Format | `npx prettier --check ...` | PASS | الملفات المعدلة منسقة |
| Typecheck | `npm run typecheck` | PASS | بعد توليد Prisma Client |
| Lint | `npm run lint` | PASS | لا أخطاء |
| Build | `npm run build` | PASS | Nest build |
| Unit tests | `npm test -- --runInBand` | PASS | 30 suites / 186 tests |
| Targeted controller unit | `npx jest src/modules/products/products.controller.spec.ts --runInBand` | PASS | 1 suite / 9 tests |
| E2E tests | `npm run test:e2e -- --runInBand auth-guard.e2e-spec.ts` | PASS | شملت مسارات المنتجات الجديدة وحالات 401/403/201/400 |
| Client analyze/tests | not applicable | NOT RUN | لا تغيير في العميل |
| Secret scan | repository CI | PENDING | يجب انتظار CI على PR |
| Migration/runtime test | not applicable | NOT RUN | لا migration ولا تغيير runtime database |
| Diff check | `git diff --check` | PASS | لا whitespace errors |

## 6. Known limitations and risks

هذا الإصلاح يثبت التفويض والتحقق على مستوى المسارات، لكنه لا يثبت سلامة منطق الخدمة أو قاعدة البيانات أو صلاحيات الأدوار في كل الوحدات. اختبارات E2E الحالية mock-backed؛ لا تُعامل كبديل عن PostgreSQL integration.

تم إنشاء commit `eb1e39374edd1cc7fe7fb7a273caeb828fab1058` بعد مراجعة diff ونجاح البوابات المحلية. لم يُرفع الفرع ولم يُفتح PR بعد في هذه اللحظة؛ يجب رفعه ثم انتظار CI. لا يُدمج الفرع دون نجاح كل البوابات المطلوبة.

## 7. Next agent instructions

المهمة التالية بعد دمج هذا الفرع والتحقق من CI هي `GF-REMAINING-002`: مراجعة رصيد المستودع في القراءة والـledger، مع البدء من `docs/PROJECT_STATE.md` و`docs/MASTER_BACKLOG.md` و`docs/DATA_AND_MIGRATIONS.md` و`backend/src/modules/inventory/**`.

يجب أولاً التحقق من merge commit وCI على `main`. لا تضف `companyId` أو migration جديدة بلا ADR وخطة backfill/rollback، ولا تكتب رصيداً مباشراً خارج ledger أو تتجاوز حدود transaction. يجب أن تشمل المهمة حركات في مستودعين واختبار PostgreSQL حقيقياً على CI.
