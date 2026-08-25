# Handoff 004

## Status
- Branch: `stabilization/baseline-and-security`
- Commit: af48d93
- Phase: 1 — Security & Stabilization
- Task ID: GF-0004
- Date: 2026-08-25

## Completed
- **13 DTO مع class-validator** لكل مسار كتابة (12 endpoint + DTO بند أمر البيع المتداخل):
  - products `CreateProductDto` · inventory `AddStockDto` · production `CreateWorkOrderDto` + `UpdateWorkOrderStatusDto` · quality `CreateQualityCheckDto` · hr `RecordProductionDto` + `CreateAdvanceDto` · sales `CreateCustomerDto` + `CreateSalesOrderDto` + `CreateSalesOrderItemDto` · shipping `CreateShipmentDto` · accounting `CreateAccountDto` + `CreateVoucherDto`
- **قواعد التحقق المفعّلة**: forbidNonWhitelisted (حقول غير معروفة → 400 — يشمل حقول الهوية المزورة، تعزيز P0-04)، @IsEnum لكل الـ enums، @IsPositive/@Min(0) للكميات والأسعار حسب المجال، @IsInt للكميات الصحيحة، @IsUUID لكل المعرفات + ParseUUIDPipe على معاملي مسار الكتابة (add-stock وupdate-status)، تاريخ ISO مع @Transform آمن (القيم غير الصالحة تُترك ليرفضها @IsDate بدل الحفر كـ Invalid Date)، بنود أمر البيع متحققة nested عبر @ValidateNested + @Type + @ArrayMinSize(1).
- **19 اختبار 400 سلوكيًا** في `test/auth-guard.e2e-spec.ts` (describe مستقل يستخدم SUPER_ADMIN لعزل الـ validation عن 401/403): حقول غير معروفة (×2)، enums غير صالحة (×5)، كميات/أسعار غير موجبة (×6)، UUID غير صالح (×2)، تاريخ غير صالح (×1)، + اختبار سلامة (طلب صالح كامل → 201 — لا 400 كاذبة).
- إعادة صياغة اختبار الهوية (P0-04): أقوى الآن — الحقل المزور يُرفض على الباب بـ 400، والهوية تُستخرج من الجلسة (201 بدون الحقل + تحقق المحفوظ).
- تحديث 4 controller specs (enum values + حقول DTO المطلوبة) للحفاظ على التوافق مع الأنواع.
- تحديث `API_CONTRACT.md` (قواعد التحقق الموحدة + أمثلة payloads) و`SECURITY_BASELINE.md` (إغلاق P0-05) و`PROJECT_STATE.md`.

## Files Changed
- **جديدة (13):** DTOs في `src/modules/{products,inventory,production,quality,hr,sales,shipping,accounting}/dto/`
- **معدّلة (13):** 8 controllers (استبدال inline types بالـ DTOs + ParseUUIDPipe×2) + 4 controller specs + `test/auth-guard.e2e-spec.ts` (workerAdvance mock + اختبارات 400) + 3 docs
- كلها ضمن Allowed Files في بطاقة GF-0004.

## Database/API Impact
- **Database:** لا شيء.
- **API (تغيير عقد مقصود وموثق):** 
  1. المدخلات غير الصالحة → **400** برسائل عربية واضحة (كانت تمر إلى Prisma وتفشل بـ 500).
  2. **الحقول غير المعروفة → 400** بدل التجاهل الصامت — بما فيها `userId/createdById/creatorId` في body (تعزيز أمني).
  3. معامل مسار غير UUID في add-stock/update-status → 400.
  4. لا تغيير في الاستجابات الناجحة (2xx) — نفس البنية.

## Checks
| Check | Result | Notes |
|---|---|---|
| Build (`npm run build`) | ✅ PASS | |
| Unit tests (`npm test -- --runInBand`) | ✅ **22/22 suites — 89/89 tests** | دون تغيير عددها |
| E2E (`npm run test:e2e -- --runInBand`) | ✅ **2/2 — 36/36** (كانت 17؛ +19 اختبار 400) | حتى بلا ملف `.env` |
| Lint (`npm run lint` — فحص نقي) | ✅ **صفر أخطاء وصفر تحذيرات** | |
| Prisma validate | ✅ PASS | |
| Flutter analyze/test | ⚠️ غير مشغّلة | لا SDK — موثق في CI |
| git diff review | ✅ | نطاق ملتزم، لا أسرار، لا سلوك خارج التحقق |

## Known Issues
- **التعارض القديم القائم:** تعليقات YAML في `docker-compose.yml` قديمة — تنظف في GF-0006.
- CI secret-scan يبقى أحمر (GF-0006) — backend job متوقع أخضر.
- Flutter سيرفض حقول الهوية والمدخلات غير الصالحة عند ربطه (GF-0010 يجب أن يرسل payloads مطابقة للتوثيق أعلاه).

## Not Done
- GF-0005 (CurrentUser توسيع) دُمج عمليًا في GF-0002/0004 — يُغلق رقمها في backlog مع ملاحظة.
- قاعدة `checked = passed + rejected` (قاعدة مجال) — GF-0014.
- pagination — GF-0012. rate limiting — GF-0021.

## Next Exact Task
```text
TASK_ID: GF-0006
TITLE: تنظيف docker-compose وREADME وseed + ضبط secret-scan — CI أخضر بالكامل
PHASE: 1
OBJECTIVE: إغلاق آخر الأحمر في CI: إزالة كل الأسرار المنشورة، إصلاح healthcheck،
          ربط الخدمات داخليًا، README صادق يطابق الواقع، وضبط secret-scan
          (استثناء false positives الموثقة في .agents/.claude/.windsurf).

ALLOWED FILES:
- docker-compose.yml (المتغيرات من .env، إصلاح healthcheck pg_isready، expose بدل ports لغير الضروري، إزالة أو تقييد pgAdmin)
- README.md (إزالة بيانات الدخول، وصف صادق للحالة الحالية بعد GF-0002..0004)
- backend/prisma/seed.ts (كلمة مرور admin من البيئة أو قيمة واضحة للتطوير فقط بلا نشرها في README)
- backend/src/modules/auth/dto/login.dto.ts (إزالة example بكلمة المرور المنشورة)
- .github/workflows/ci.yml (ضبط secret-scan: استثناءات موثقة أو أنماط أدق)
- .env.example بجذر المستودع إذا لزم لـ docker-compose
- docs/SECURITY_BASELINE.md، docs/PROJECT_STATE.md، docs/DECISIONS.md (ADR للقرارات)، docs/handoffs/HANDOFF-005.md

ACCEPTANCE CRITERIA:
1. `git grep -nE "erp_password_2024|Admin@123"` لا يجد شيئًا في الملفات المتتبعة (عدا توثيق DECISIONS/SECURITY_BASELINE التاريخي الموثق).
2. healthcheck لـ postgres يعمل فعليًا (pg_isready بالمستخدم الصحيح من env).
3. لا كلمة مرور ثابتة في docker-compose — من متغيرات البيئة مع .env.example.
4. CI secret-scan يمر (مع استثناءات false positives موثقة بتعليق يشرح السبب).
5. README يطابق الواقع: 9 وحدات، الحماية الحالية، متطلبات .env، لا ادعاءات events غير منفذة، لا بيانات دخول.
6. كل الاختبارات (89 + 36) وlint وbuild تبقى خضراء.
7. CI بالكامل أخضر (الوظيفتان معًا) على GitHub — دليل Run #.
```

## Rollback
- `git revert af48d93` — DTOs واختبارات فقط، لا schema ولا بيانات.
- أي عميل يعتمد على إرسال حقول هوية في body سيتوقف عن العمل — هذا مقصود (تعزيز أمني) وليس حالة تراجع.
