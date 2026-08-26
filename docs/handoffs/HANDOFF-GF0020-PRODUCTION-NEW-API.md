# HANDOFF — GF-0020 Production New API Binding

## الحالة

| البند | القيمة |
|---|---|
| المهمة | GF-0020 — ربط وحدة الإنتاج في Flutter بـ GF-0013 API الجديد |
| الحالة | جاهزة للمراجعة، غير مدمجة |
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع | `refactor/gf-0020-production-new-api` |
| Base commit | `d15b2ef514d5af95ddb297654853c05db6f957b0` — main بعد دمج PR #19 |
| Head commit | `e67542dc20bbf81120ff0cf41a6bb66768188dbb` |
| Pull Request | [PR #21](https://github.com/rabea0169/garment-factory-erp/pull/21) |
| CI run | [Run 32921221660](https://github.com/rabea0169/garment-factory-erp/actions/runs/32921221660) — جميع البوابات ناجحة |
| Database migration | لا توجد |
| Backend changes | لا توجد؛ يعتمد على API المدمج في PR #12 |

## ما تم تنفيذه

استُبدل adapter الـ legacy الذي كان يستدعي `PATCH /production/work-orders/:id/status` بربط API الإنتاج الجديد:

```text
POST /production/work-orders/:id/stage-transitions
POST /production/work-orders/:id/stage-output
POST /production/work-orders/:id/material-consumptions
POST /production/work-orders/:id/cost/finalize
```

أضيفت أوامر وكيانات Domain typed لمخرجات المرحلة، استهلاك الخام، ولقطة التكلفة. كما أضيفت نماذج Data لتحويل استجابات transition/output/consumption/cost، مع دعم Decimal القادم من Prisma سواء ظهر كرقم أو كسلسلة نصية.

تم تحديث `ProductionRepository`, Use Cases, و`ProductionCubit` لتمرير العمليات الجديدة. وتُرسل `Idempotency-Key` صراحة لمساري stage transition واستهلاك الخامة، بينما يواصل `ApiClient` إدارة التوكن و401 وretry العام.

## الملفات الرئيسية

```text
mobile_app/lib/features/production/data/datasources/production_remote_data_source.dart
mobile_app/lib/features/production/data/models/production_models.dart
mobile_app/lib/features/production/data/repositories/production_repository_impl.dart
mobile_app/lib/features/production/domain/entities/production_commands.dart
mobile_app/lib/features/production/domain/entities/stage_transition.dart
mobile_app/lib/features/production/domain/repositories/production_repository.dart
mobile_app/lib/features/production/domain/usecases/production_usecases.dart
mobile_app/lib/features/production/presentation/cubit/production_cubit.dart
mobile_app/test/features/production/data/work_order_model_test.dart
mobile_app/test/features/production/presentation/production_cubit_test.dart
```

## التحقق

| الفحص | النتيجة |
|---|---|
| `git diff --check` | ناجح |
| Flutter Analyze | ناجح في CI |
| Flutter Test | ناجح في CI |
| Backend Prisma/Lint/Build/Unit/E2E/Integration | ناجح |
| Secret Scan | ناجح |
| الفرع | نظيف بعد commit |
| الاختبار المحلي | Flutter/Dart غير مثبتين في sandbox؛ تم الاعتماد على CI |

حدث فشل أولي في Flutter بسبب عدم حقن Use Cases الجديدة داخل Fake Repository في الاختبار؛ تم تصحيحه وإعادة تشغيل CI بنجاح.

## حدود معروفة

الربط البرمجي بالمسارات الجديدة مكتمل، لكن واجهة الإنتاج الحالية تعرض انتقال المرحلة فقط. لم تُضف بعد نماذج إدخال UI لـ stage output أو material consumption لأن ذلك يتطلب اختيار المرحلة و`stageRunId` والخامة والمخزن والكمية من بيانات فعلية.

لم يُحذف مسار `PATCH /status` من Backend؛ بقي كمسار legacy مستقل حتى يعتمد مالك المشروع قرار إيقافه. لا توجد migration قاعدة بيانات أو تغييرات Backend في هذا PR.

## الخطوة التالية

مراجعة ودمج PR #21 بعد موافقة مالك المستودع، ثم إضافة واجهات إدخال آمنة لمخرجات المرحلة واستهلاك الخامات وتثبيت التكلفة، مع اختبار HTTP يثبت path/payload/headers. بعد ذلك تبدأ شريحة ترحيل `Inventory` إلى Repository وDomain على نفس النمط.

لم يتم دمج PR #21 تلقائيًا.
