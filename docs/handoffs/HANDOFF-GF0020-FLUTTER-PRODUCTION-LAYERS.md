# HANDOFF — GF-0020 Flutter Production Layers

## الحالة

| البند | القيمة |
|---|---|
| المهمة | GF-0020 — شريحة معمارية: ترحيل وحدة الإنتاج إلى Data/Domain/Presentation |
| الحالة | جاهزة للمراجعة، غير مدمجة |
| المستودع | `rabea0169/garment-factory-erp` |
| الفرع | `refactor/gf-0020-flutter-production-layers` |
| Base commit | `033ae6fd8bc700b1ddea93d6373c78008cf233f4` |
| Head commit | `dd48500de01ef35a9921df0192f1b6a656b1bfc9` |
| Pull Request | [PR #19](https://github.com/rabea0169/garment-factory-erp/pull/19) |
| CI run | [Run 32920246449](https://github.com/rabea0169/garment-factory-erp/actions/runs/32920246449) — جميع البوابات ناجحة |
| Database migration | لا توجد |
| Backend changes | لا توجد |

> ملاحظة النطاق: هذه الشريحة لا تعيد تنفيذ GF-0013 Backend API/RBAC الموجودة في PR #12. استخدمت adapter داخل Data للتعامل مؤقتًا مع عقد `PATCH /production/work-orders/:id/status` الحالية على `main`.

## ما تم تنفيذه

أضيفت طبقة Domain مستقلة تحتوي على `WorkOrder`, `StageTransition`, enums، أخطاء الإنتاج، عقد `ProductionRepository`، وUse Cases لجلب أوامر التشغيل وانتقال المرحلة.

أضيفت طبقة Data تحتوي على `ProductionRemoteDataSource`, `WorkOrderModel`, و`ProductionRepositoryImpl`. جميع تفاصيل Dio وJSON والتحويل بين `PACKING` و`PACKAGING` محصورة هنا، بحيث يمكن تبديل endpoint عند دمج GF-0013 دون تعديل الشاشة أو Domain.

أعيدت كتابة `ProductionCubit` ليعتمد على Use Cases ويصدر حالات typed تشمل `Loading`, `Loaded`, `Empty`, `Offline`, `Unauthorized`, و`Failure`. وأعيدت كتابة شاشة الإنتاج لتستخدم Entities typed وحالات UX واضحة، مع إزالة direct Dio وraw JSON من Presentation.

أضيفت اختبارات model للتحويل من JSON ورفض status غير معروف، واختبارات Cubit لحالتي النجاح والاتصال غير المتاح.

## الملفات الرئيسية

```text
mobile_app/lib/features/production/data/datasources/production_remote_data_source.dart
mobile_app/lib/features/production/data/models/work_order_model.dart
mobile_app/lib/features/production/data/repositories/production_repository_impl.dart
mobile_app/lib/features/production/domain/entities/stage_transition.dart
mobile_app/lib/features/production/domain/entities/work_order.dart
mobile_app/lib/features/production/domain/failures/production_failure.dart
mobile_app/lib/features/production/domain/repositories/production_repository.dart
mobile_app/lib/features/production/domain/usecases/production_usecases.dart
mobile_app/lib/features/production/production_module.dart
mobile_app/lib/features/production/presentation/cubit/production_cubit.dart
mobile_app/lib/features/production/presentation/cubit/production_state.dart
mobile_app/lib/features/production/presentation/screens/production_screen.dart
mobile_app/test/features/production/data/work_order_model_test.dart
mobile_app/test/features/production/presentation/production_cubit_test.dart
```

## التحقق

| الفحص | النتيجة |
|---|---|
| `git diff --check` | ناجح |
| Flutter analyze على CI | ناجح |
| Flutter test على CI | ناجح — 5 اختبارات |
| Backend Prisma/Lint/Build/Unit/E2E/Integration | ناجح |
| Secret Scan | ناجح |
| Flutter محليًا في sandbox | غير متاح؛ Flutter/Dart غير مثبتين محليًا |

تم تصحيح فشلين في CI أثناء التنفيذ: تعارض اسم `ProductionFailure` في الاختبار، ثم توقيت الاستماع إلى Cubit stream. بعد التصحيح أصبح CI أخضر بالكامل.

## المخاطر والحدود

الانتقال الحالي لا يفعّل بعد ProductionWorkflow API الجديد؛ إنه يحسن حدود Flutter مع الحفاظ على API الموجود على `main`. لذلك لا ينبغي اعتبار هذه الشريحة تنفيذًا لمراحل output أو consumption أو finished-good posting.

ما زالت شاشة إنشاء أمر جديد غير منفذة، كما أن الانتقال إلى التغليف لا يعني استلام المنتج التام لأن endpoint الحالي لا ينفذ هذا الأثر. أزيلت رسالة الطباعة غير المثبتة من الشاشة بدل الادعاء بتنفيذ طباعة barcode.

يجب مراجعة adapter بعد دمج GF-0013 API/RBAC، وإضافة Use Cases وDTOs لـ output/consumption/cost بدل توسيع status endpoint legacy.

## المهمة التالية

بعد مراجعة PR #19، تُنفذ الخطوة التالية بترتيب آمن:

1. مراجعة ودمج مسار GF-0013 Backend API/RBAC وفق حالة PR #12 أو فرع محدث غير متعارض.
2. تحديث `ProductionRemoteDataSource` فقط ليتعامل مع transition/output/consumption/cost الجديدة.
3. إضافة اختبارات HTTP وintegration للمسارات الجديدة مع 401/403/validation/idempotency.
4. توسيع Production Domain/Cubit/Screen تدريجيًا لعرض مخرجات المرحلة واستهلاك الخام والتكلفة.
5. بعد ثبات الإنتاج، تكرار النمط على Inventory.

## قرار الدمج

لم يتم دمج PR #19 تلقائيًا. يتطلب الدمج مراجعة مالك المستودع والتأكد من ترتيب الدمج مع GF-0013، لأن PR #12 الحالي كان متعارضًا مع `main` عند إنشاء هذه الشريحة.
