-- QLT-2 (P2 — GF-IMP-W3): تحويل عمود المرحلة في فحوص الجودة من النوع التراثي
-- WorkOrderStatus إلى النوع الدلالي الصحيح ProductionStage (GF-0013).
-- الخدمة كانت تُترجم عبر خريطة LEGACY_STAGE (ProductionStage → WorkOrderStatus)
-- قبل كل كتابة/قراءة — هذه الهجرة تنقل البيانات إلى النوع الصحيح فتُحذف الخريطة.

-- خريطة الترجمة نفسها المطبقة في الخدمة (quality.service LEGACY_STAGE):
--   CUTTING  → CUTTING
--   SEWING   → SEWING
--   IRONING  → IRONING
--   PACKAGING→ PACKING
-- القيم غير الموجودة في ProductionStage تُقص إلى أقرب صالح:
--   FINISHING → IRONING   (أقرب مرحلة تشطيب/كي — لا وجود لـ FINISHING في ProductionStage)
--   حالات دورة الحياة (PLANNED/IN_PROGRESS/COMPLETED/CANCELLED) → CUTTING
--   (DEFAULT محافظ: أول مرحلة إنتاج — القيم الدفاعية فقط؛ البيانات الحقيقية
--   لا تُكتب إلا من addQualityCheck بالقيم الأربع الأولى).
--   ملاحظة: البيانات المكتوبة فعليًا عبر addQualityCheck لا تحتوي سوى القيم الأربع
--   الأولى (خريطة LEGACY)، فالفرعان الأخيران تحصين للسجل القديم النظري فقط.

-- الفهرس المركب (workOrderId, stage, checkedAt) مبني على العمود — يُبنى من جديد
-- بالنوع الجديد بعد التحويل (إعادة بناء صريحة لا نعتمد على إعادة البناء الضمني
-- من ALTER TYPE لفهارس enum).
DROP INDEX IF EXISTS "quality_checks_workOrderId_stage_checkedAt_idx";

ALTER TABLE "quality_checks"
  ALTER COLUMN "stage" TYPE "ProductionStage"
  USING (
    CASE "stage"::text
      WHEN 'CUTTING' THEN 'CUTTING'
      WHEN 'SEWING' THEN 'SEWING'
      WHEN 'FINISHING' THEN 'IRONING'
      WHEN 'IRONING' THEN 'IRONING'
      WHEN 'PACKAGING' THEN 'PACKING'
      ELSE 'CUTTING'
    END::"ProductionStage"
  );

-- إعادة بناء الفهرس المركب بالنوع الجديد (نفس تعريف GF-0014).
CREATE INDEX "quality_checks_workOrderId_stage_checkedAt_idx"
  ON "quality_checks"("workOrderId", "stage", "checkedAt");
